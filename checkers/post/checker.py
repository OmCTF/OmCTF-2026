#!/usr/bin/env python3
"""Сценарии ForcAD для «Связи». Работа с API вынесена в svyaz_lib.py."""

import json
import secrets
import sys
import time
from contextlib import contextmanager

from svyaz_lib import (
    ApiError,
    FLAG_RE,
    SvyazClient,
    TransportError,
    make_png,
    make_wave,
    new_id,
    read_png_flag,
    read_wave_flag,
)


OK, CORRUPT, MUMBLE, DOWN, CHECKER_ERROR = 101, 102, 103, 104, 110
STORES = {1: "media", 2: "search", 3: "sound"}
PUBLIC_ERROR = {
    CORRUPT: "Previously stored data is unavailable",
    MUMBLE: "Service response is inconsistent",
    DOWN: "Cannot connect to service",
    CHECKER_ERROR: "Checker error",
}


class Failure(Exception):
    def __init__(self, status, diagnostic, public=None):
        super().__init__(diagnostic)
        self.status = status
        self.public = public or PUBLIC_ERROR[status]


def require(condition, message, status=MUMBLE):
    if not condition:
        raise Failure(status, message)


@contextmanager
def stage(public, missing_is_corrupt=False):
    """Показываем участникам область сбоя, а точную причину оставляем организаторам."""
    try:
        yield
    except Failure as exc:
        if exc.status in (MUMBLE, CORRUPT):
            exc.public = public
        raise
    except TransportError as exc:
        raise Failure(DOWN, str(exc)) from exc
    except ApiError as exc:
        status = CORRUPT if missing_is_corrupt and exc.status_code in (401, 403, 404) else MUMBLE
        raise Failure(status, str(exc), public) from exc
    except (KeyError, IndexError, TypeError, ValueError, StopIteration) as exc:
        raise Failure(MUMBLE, "%s: %s" % (type(exc).__name__, exc), public) from exc


def finish(status, public="", private=""):
    # При успешном PUT stdout содержит attack_data, stderr содержит приватный receipt.
    # При ошибке stdout содержит общий вектор, stderr содержит подробности для организаторов.
    print(public, file=sys.stdout)
    print(private, file=sys.stderr)
    raise SystemExit(status)


def create_guild(owner):
    guild_id = owner.create_guild("City workspace")["id"]
    general = owner.list_channels(guild_id)[0]["id"]
    everyone = next(role["id"] for role in owner.list_roles(guild_id)
                    if role.get("is_default"))
    return guild_id, general, everyone


def create_private_room(owner, guild_id, everyone_id, kind):
    category_id = owner.create_category(guild_id, "Private dispatch")["id"]
    # Запрет для общей роли скрывает канал от приглашённого участника сервера.
    owner.deny_category_role(guild_id, category_id, everyone_id)
    name = "briefing" if kind == "VOICE" else "records"
    return owner.create_channel(guild_id, name, kind, category_id=category_id)["id"]


def check_message_lifecycle(owner, reader, room):
    # Проверяем редактирование, защиту от устаревшей ревизии и tombstone после удаления.
    sent = owner.post_channel_message(room, "Before edit")
    edited = owner.edit_message(room, sent["id"], sent["revision"], "After edit")
    require(edited["content"] == "After edit" and edited["revision"] > sent["revision"],
            "message edit did not persist")
    stale = owner.edit_message(room, sent["id"], sent["revision"], "Stale edit", expected=409)
    require(stale.get("code") == "version_conflict", "stale message edit accepted")
    denied = reader.edit_message(room, sent["id"], edited["revision"], "Guest edit", expected=403)
    require(denied.get("code"), "member edited another user's message")
    stale_delete = owner.delete_message(room, sent["id"], sent["revision"], expected=409)
    require(stale_delete.get("code") == "version_conflict",
            "stale message deletion was accepted")
    removed = owner.delete_message(room, sent["id"], edited["revision"])
    require(removed.get("deleted") is True, "deleted message is not a tombstone")
    require(reader.get_message(room, sent["id"]).get("deleted") is True,
            "message deletion is not visible to readers")
    guest_message = reader.post_channel_message(room, "Needs moderation")
    moderated = owner.edit_message(room, guest_message["id"],
                                   guest_message["revision"], "Moderated")
    require(moderated["content"] == "Moderated", "moderator cannot edit a message")
    require(owner.delete_message(room, guest_message["id"],
                                 moderated["revision"])["deleted"],
            "moderator cannot delete a message")


def check_admin_and_roles(owner, reader, guild_id):
    # Управление сервером, ролями, подтверждением передачи владельца и удалением.
    require(reader._guild_write(guild_id, "PATCH", "/guilds/%s" % guild_id,
                                {"name": "Unapproved"}, expected=403).get("code"),
            "ordinary member could rename the guild")
    require(owner.update_guild(guild_id, "City dispatch")["name"] == "City dispatch",
            "guild rename did not persist")
    require(owner.guild_audit(guild_id), "guild audit is empty")
    role = owner.create_role(guild_id, "Dispatcher", permissions=["READ_HISTORY"])
    role_id = role["id"]
    require(reader._guild_write(guild_id, "POST", "/guilds/%s/roles" % guild_id,
                                {"name": "Unauthorized", "position": 2,
                                 "permissions": ["READ_HISTORY"]},
                                expected=403).get("code"),
            "ordinary member could create a role")
    require(any(item["id"] == role_id for item in owner.list_roles(guild_id)),
            "new role is not listed")
    owner.set_member_role(guild_id, reader.user_id, role_id, True)
    member = next(item for item in owner.list_members(guild_id)
                  if item["user"]["id"] == reader.user_id)
    require(role_id in member["role_ids"], "role assignment did not persist")
    require(owner.update_role(guild_id, role_id, "Coordinator", ["READ_HISTORY"])["name"] ==
            "Coordinator", "role update did not persist")
    ordered = owner.reorder_roles(guild_id, [role_id])
    require(any(item["id"] == role_id for item in ordered["items"]),
            "role ordering failed")
    owner.set_member_role(guild_id, reader.user_id, role_id, False)
    owner.delete_role(guild_id, role_id)
    require(all(item["id"] != role_id for item in owner.list_roles(guild_id)),
            "deleted role remains listed")

    scratch, scratch_room, scratch_everyone = create_guild(owner)
    invite = owner.create_invite(scratch, scratch_room)["code"]
    require(owner.invite_preview(invite)["guild_id"] == scratch,
            "invite preview returned another guild")
    reader.accept_invite(invite)
    category = owner.create_category(scratch, "Operations")["id"]
    owner.rename_category(scratch, category, "Dispatch")
    require(any(item["id"] == category and item["name"] == "Dispatch"
                for item in owner.list_categories(scratch)), "category edit did not persist")
    subject = "role:" + scratch_everyone
    owner.set_overwrite(scratch, "categories", category, subject, ["SEND_MESSAGES"])
    require(any(item["subject_id"] == scratch_everyone
                for item in owner.list_overwrites("categories", category)),
            "category overwrite is missing")
    owner.delete_overwrite(scratch, "categories", category, subject)
    require(not owner.list_overwrites("categories", category),
            "deleted category overwrite remains listed")
    spare = owner.create_channel(scratch, "scratch", "TEXT", category_id=category)["id"]
    owner.reorder_channels(scratch, spare, 8)
    require(any(item["id"] == spare and item["position"] == 8
                for item in owner.list_channels(scratch)), "channel order did not persist")
    owner.set_overwrite(scratch, "channels", spare, subject, ["SEND_MESSAGES"])
    require(any(item["subject_id"] == scratch_everyone
                for item in owner.list_overwrites("channels", spare)),
            "channel overwrite is missing")
    owner.delete_overwrite(scratch, "channels", spare, subject)
    require(not owner.list_overwrites("channels", spare),
            "deleted channel overwrite remains listed")
    owner.delete_channel(scratch, spare)
    require(owner.get_channel(spare, expected=404).get("code"),
            "archived channel remains accessible")
    owner.delete_category(scratch, category)
    require(all(item["id"] != category for item in owner.list_categories(scratch)),
            "archived category remains listed")
    temporary_invite = owner.create_invite(scratch, scratch_room)["invite"]["id"]
    require(any(item["id"] == temporary_invite for item in owner.list_invites(scratch)),
            "created invite is not listed")
    owner.revoke_invite(scratch, temporary_invite)
    require(any(item["id"] == temporary_invite and item["revoked"]
                for item in owner.list_invites(scratch)), "revoked invite remains active")
    require(owner.invite_preview(invite)["guild_id"] == scratch,
            "active invitation became unavailable")
    owner.remove_member(scratch, reader.user_id)
    require(reader._request("GET", "/guilds/" + scratch, expected=404).get("code"),
            "removed member retained guild access")
    reader.accept_invite(invite)
    proof = owner.confirm_guild_action(scratch, "TRANSFER_OWNER", reader.user_id)
    owner.complete_guild_action(scratch, "TRANSFER_OWNER", proof)
    require(reader.get_guild(scratch)["owner_id"] == reader.user_id,
            "ownership transfer did not persist")
    proof = reader.confirm_guild_action(scratch, "DELETE_GUILD")
    reader.complete_guild_action(scratch, "DELETE_GUILD", proof)
    require(reader._request("GET", "/guilds/" + scratch, expected=404).get("code"),
            "deleted guild remains accessible")


def check_webhook(owner, reader, guild_id, room):
    # Жизненный цикл webhook: создать, отправить, сменить секрет, отозвать.
    require(reader._guild_write(guild_id, "POST", "/guilds/%s/webhooks" % guild_id,
                                {"channel_id": room, "name": "Unauthorized",
                                 "avatar": "sky"}, expected=403).get("code"),
            "ordinary member could create a webhook")
    created = owner.create_webhook(guild_id, room)
    hook_id, secret = created["webhook"]["id"], created["secret"]
    require(any(item["id"] == hook_id for item in owner.list_webhooks(guild_id)),
            "webhook is not listed")
    sent = owner.send_webhook(hook_id, secret, "Webhook probe")
    require(any(item["id"] == sent["id"] and item["content"] == "Webhook probe"
                for item in reader.channel_messages(room)), "webhook message missing")
    rotated = owner.rotate_webhook(guild_id, hook_id)
    require(rotated["secret"] != secret, "webhook secret did not rotate")
    owner.send_webhook(hook_id, secret, "Old secret", expected=404)
    owner.send_webhook(hook_id, rotated["secret"], "Rotated webhook")
    owner.delete_webhook(guild_id, hook_id)
    owner.send_webhook(hook_id, rotated["secret"], "Revoked webhook", expected=404)


def check_notifications(owner, reader, guild_id, room):
    # Настройки, правило канала, доставка inbox, claim и отметка о прочтении.
    reader.set_community_settings(True)
    require(reader.community_settings()["browser_notifications"] is True,
            "notification settings did not persist")
    reader.set_notification_rule("user", "", "mentions")
    reader.set_notification_rule("guild", guild_id, "mentions")
    reader.set_notification_rule("channel", room, "all")
    rules = reader.notification_rules()
    require(any(item["scope"] == "user" for item in rules) and
            any(item["scope"] == "guild" and item["scope_id"] == guild_id
                for item in rules) and
            any(item["scope"] == "channel" and item["scope_id"] == room
                for item in rules), "notification rule missing")
    message = owner.post_channel_message(room, "Inbox " + secrets.token_hex(5))
    deadline = time.monotonic() + 3
    item = None
    while time.monotonic() < deadline:
        item = next((entry for entry in reader.inbox()
                     if entry["message_id"] == message["id"]), None)
        if item:
            break
        time.sleep(0.1)
    require(item is not None, "notification was not delivered")
    require(reader.claim_notification(item["id"])["claimed"] is True,
            "notification claim failed")
    reader.read_notification(item["id"])
    require(any(entry["id"] == item["id"] and entry["read"] is True
                for entry in reader.inbox()), "notification read state did not persist")
    reader.delete_notification_rule("channel", room)
    reader.delete_notification_rule("guild", guild_id)
    reader.delete_notification_rule("user", "")
    require(not reader.notification_rules(),
            "deleted notification rule remains listed")


def check_moderation(host, owner, guild_id, room, voice_id):
    # Отдельный аккаунт-цель не нарушает остальные сценарии CHECK.
    target = SvyazClient(host).register()
    target.accept_invite(owner.create_invite(guild_id, room)["code"])
    require(target._guild_write(guild_id, "POST", "/guilds/%s/moderation" % guild_id,
                                {"user_id": owner.user_id, "kind": "BAN",
                                 "reason": "Unauthorized", "duration_seconds": 0},
                                expected=403).get("code"),
            "ordinary member could moderate the owner")
    for kind in ("MUTE_TEXT", "MUTE_VOICE"):
        owner.moderate(guild_id, target.user_id, kind, "Routine moderation", 30)
        active = next(item for item in owner.moderation_records(guild_id)
                      if item["user_id"] == target.user_id and item["kind"] == kind
                      and item["active"])
        if kind == "MUTE_TEXT":
            denied = target._request("POST", "/channels/%s/messages" % room,
                                     {"client_id": new_id(), "content": "Muted",
                                      "mentions": []}, expected=403)
            require(denied.get("code"), "text mute did not deny message send")
        else:
            claims = target.voice_capabilities(voice_id)
            require(claims["can_speak"] is False and claims["can_stream"] is False,
                    "voice mute retained speak or stream permission")
        owner.revoke_sanction(guild_id, active["id"], "Appeal accepted")
        if kind == "MUTE_VOICE":
            require(target.voice_capabilities(voice_id)["can_speak"] is True,
                    "revoked voice mute still denies speaking")
    owner.moderate(guild_id, target.user_id, "BAN", "Routine moderation")
    require(target.get_channel(room, expected=404).get("code") in
            ("not_found", "access_denied"), "banned member retained channel access")
    ban = next(item for item in owner.moderation_records(guild_id)
               if item["user_id"] == target.user_id and item["kind"] == "BAN"
               and item["active"])
    owner.revoke_sanction(guild_id, ban["id"], "Appeal accepted")
    target.accept_invite(owner.create_invite(guild_id, room)["code"])
    require(target.get_channel(room)["id"] == room, "unbanned member cannot rejoin")
    owner.moderate(guild_id, target.user_id, "KICK", "Routine moderation")
    require(target.get_channel(room, expected=404).get("code") in
            ("not_found", "access_denied"), "kicked member retained channel access")


def check(host):
    with stage("Registration or login is not working"):
        owner = SvyazClient(host).register()
        reader = SvyazClient(host).register()

    # Фронтенд: корневой URL должен отдавать HTML приложения, а не только healthcheck.
    with stage("Web interface is unavailable"):
        require(b"<html" in owner.frontend_html().lower(), "frontend HTML missing")

    # Авторизация и приглашения: второй аккаунт должен войти на новый сервер.
    with stage("Guilds or invitations are not working"):
        guild_id, general, everyone = create_guild(owner)
        require(any(item["id"] == guild_id for item in owner.list_guilds()),
                "created guild is not listed")
        invitation = owner.create_invite(guild_id, general)
        reader.accept_invite(invitation["code"])
        access = reader.channel_access(general, "VIEW_CHANNEL", "realtime")
        require(access["allowed"] is True and access.get("capability"),
                "member did not receive channel access")

    # Чат и поиск: второму участнику видны новое сообщение и результат поиска по нему.
    with stage("Messages or search are not working"):
        text = "dispatch" + secrets.token_hex(8)
        message = owner.post_channel_message(general, text)
        history = reader.channel_messages(general)
        require(any(item.get("id") == message["id"] and item.get("content") == text
                    for item in history), "public chat history missing")
        deadline = time.monotonic() + 3
        while True:
            results = reader.search_guild_messages(guild_id, text)
            if any(item.get("message_id") == message["id"] for item in results):
                break
            require(time.monotonic() < deadline, "new message not searchable")
            time.sleep(0.15)
        reader.chat_replay(general, text)

    # Права доступа: членство на сервере не открывает закрытую категорию.
    with stage("Channel permissions are not working"):
        private_room = create_private_room(owner, guild_id, everyone, "TEXT")
        hidden = reader.get_channel(private_room, expected=404)
        require(hidden.get("code") in ("not_found", "access_denied"),
                "private room exposed")

    # Медиа: проверяем загрузку, обработку воркером, хранение и скачивание.
    with stage("Attachments are not working"):
        image = make_png(new_id())
        upload_id = owner.upload(general, image, "probe.png")
        owner.post_channel_message(general, "Image", [upload_id])
        require(reader.attachment_content(general, upload_id) == image,
                "media bytes changed")

    # Голос: проверяем сохранение soundboard и подключение к Rust WebSocket.
    with stage("Voice channels are not working"):
        voice_id = owner.create_channel(guild_id, "lobby", "VOICE", position=3)["id"]
        sound = make_wave()
        clip = owner.create_sound(guild_id, voice_id, "Bell", sound)
        require(owner.sound_content(voice_id, clip["id"]) == sound,
                "soundboard audio changed")
        owner.voice_join(voice_id)

    # Социальные функции: дружба, личный чат и чтение сообщения собеседником.
    with stage("Contacts or direct messages are not working"):
        request = reader.send_friend_request(owner.user_id)
        owner.accept_friend_request(request["id"])
        dm_id = owner.create_dm(reader.user_id)["id"]
        private_text = "private" + secrets.token_hex(8)
        dm_message = owner.post_dm_message(dm_id, private_text)
        require(any(item.get("content") == private_text
                    for item in reader.dm_messages(dm_id)), "DM message missing")
        dm_edited = owner.edit_message(dm_id, dm_message["id"], dm_message["revision"],
                                       "Updated DM", room_kind="conversation")
        require(any(item.get("content") == "Updated DM"
                    for item in reader.dm_messages(dm_id)), "DM edit missing")
        owner.delete_message(dm_id, dm_message["id"], dm_edited["revision"],
                             room_kind="conversation")
        require(reader.get_message(dm_id, dm_message["id"], "conversation")["deleted"],
                "DM deletion missing")

    with stage("Message management is not working"):
        check_message_lifecycle(owner, reader, general)
    with stage("Guild management or roles are not working"):
        check_admin_and_roles(owner, reader, guild_id)
    with stage("Webhooks are not working"):
        check_webhook(owner, reader, guild_id, general)
    with stage("Notifications are not working"):
        check_notifications(owner, reader, guild_id, general)
    with stage("Moderation is not working"):
        check_moderation(host, owner, guild_id, general, voice_id)


def put_media(owner, general, private_room, flag):
    seed = new_id()
    attachment_id = owner.upload(private_room, make_png(seed, flag), "dispatch.png")
    owner.post_channel_message(private_room, "Dispatch image", [attachment_id])
    # Параметр изображения остаётся доступен после входа по приглашению.
    owner.post_channel_message(general, "Visual preset: " + seed)
    return {"attachment_id": attachment_id, "seed": seed}


def put_search(owner, private_room, flag):
    attachment_id = owner.upload(private_room, make_png(new_id()), flag)
    message = owner.post_channel_message(private_room, "Dispatch record", [attachment_id])
    return {"attachment_id": attachment_id, "message_id": message["id"]}


def put_sound(owner, guild_id, private_room, flag):
    public_room = owner.create_channel(guild_id, "lobby", "VOICE", position=2,
                                       category_id="")["id"]
    private_clip = owner.create_sound(guild_id, private_room, "Notification",
                                      make_wave(flag))
    public_clip = owner.create_sound(guild_id, public_room, "Bell", make_wave())
    require(private_clip["slot"] == public_clip["slot"], "soundboard slots differ")
    owner.rename_channel(guild_id, public_room, "briefing")
    return {"private_sound_id": private_clip["id"]}


def put(host, flag, place):
    require(bool(FLAG_RE.fullmatch(flag)), "invalid flag argument", CHECKER_ERROR)
    require(place in STORES, "invalid place argument", CHECKER_ERROR)
    with stage("Could not prepare storage"):
        owner = SvyazClient(host).register()
        guild_id, general, everyone = create_guild(owner)
        invite_code = owner.create_invite(guild_id, general)["code"]
        private_room = create_private_room(owner, guild_id, everyone,
                                           "VOICE" if place == 3 else "TEXT")
    with stage("Could not store data"):
        if place == 1:
            extra = put_media(owner, general, private_room, flag)
        elif place == 2:
            extra = put_search(owner, private_room, flag)
        else:
            extra = put_sound(owner, guild_id, private_room, flag)
    private = {"version": 1, "store": STORES[place], "owner": owner.account,
               "private_room": private_room, **extra}
    finish(OK, invite_code,
           json.dumps(private, separators=(",", ":")))


def get(host, raw_receipt, flag, place):
    require(bool(FLAG_RE.fullmatch(flag)), "invalid flag argument", CHECKER_ERROR)
    try:
        receipt = json.loads(raw_receipt)
        require(receipt["version"] == 1 and receipt["store"] == STORES[place],
                "receipt/store mismatch", CHECKER_ERROR)
        account = receipt["owner"]
        room = receipt["private_room"]
        require(isinstance(account["login"], str) and
                isinstance(account["password"], str) and isinstance(room, str),
                "invalid private receipt", CHECKER_ERROR)
        key = {1: "attachment_id", 2: "attachment_id", 3: "private_sound_id"}[place]
        receipt[key]
        if place == 1:
            require(isinstance(receipt["seed"], str), "invalid media receipt", CHECKER_ERROR)
        if place == 2:
            receipt["message_id"]
    except (KeyError, TypeError, IndexError, ValueError) as exc:
        raise Failure(CHECKER_ERROR, "invalid private receipt") from exc
    with stage("Could not read previously stored data", missing_is_corrupt=True):
        owner = SvyazClient(host).login(account)
        try:
            if place == 1:
                data = owner.attachment_content(room, receipt["attachment_id"])
                actual = read_png_flag(data, receipt["seed"])
            elif place == 2:
                message = owner.get_message(room, receipt["message_id"])
                upload = owner.get_upload(room, receipt["attachment_id"])
                require(message.get("content") == "Dispatch record", "search message changed", CORRUPT)
                actual = upload.get("filename")
            else:
                data = owner.sound_content(room, receipt["private_sound_id"])
                actual = read_wave_flag(data)
            require(actual == flag, "flag differs", CORRUPT)
        except ValueError as exc:
            raise Failure(CORRUPT, "invalid flag data: %s" % exc) from exc


def main(argv):
    require(len(argv) >= 3, "usage: checker.py <check|put|get> <host> ...", CHECKER_ERROR)
    action, host = argv[1:3]
    if action == "info":
        finish(OK, json.dumps({"vulns": 3, "timeout": 25, "attack_data": True}))
    if action == "check":
        check(host)
        finish(OK)
    if action in ("put", "get"):
        require(len(argv) == 6, "PUT/GET arguments missing", CHECKER_ERROR)
        try:
            place = int(argv[5])
        except ValueError as exc:
            raise Failure(CHECKER_ERROR, "invalid place argument") from exc
        if action == "put":
            put(host, argv[4], place)
        else:
            get(host, argv[3], argv[4], place)
            finish(OK)
    raise Failure(CHECKER_ERROR, "unknown checker action")


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        main(sys.argv)
    except Failure as exc:
        finish(exc.status, exc.public, str(exc))
    except TransportError as exc:
        finish(DOWN, PUBLIC_ERROR[DOWN], str(exc))
    except ApiError as exc:
        status = CORRUPT if action == "get" and exc.status_code in (401, 403, 404) else MUMBLE
        finish(status, PUBLIC_ERROR[status], str(exc))
    except (KeyError, IndexError, TypeError, ValueError, StopIteration) as exc:
        finish(MUMBLE, PUBLIC_ERROR[MUMBLE], "%s: %s" % (type(exc).__name__, exc))
    except Exception as exc:
        # Непредвиденная ошибка кода или схемы не должна снижать SLA команды.
        finish(CHECKER_ERROR, PUBLIC_ERROR[CHECKER_ERROR],
               "%s: %s" % (type(exc).__name__, exc))
