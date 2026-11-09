#!/usr/bin/env python3
import json
import os
import secrets
import sys
import time
from base64 import b64encode
from urllib.parse import quote

import requests
from checklib import BaseChecker, Status, cquit


class Checker(BaseChecker):
    vulns = 2
    timeout = 20
    uses_attack_data = True

    def __init__(self, host):
        super().__init__(host)
        self.host = host
        port = int(os.environ.get("KPP_SERVICE_PORT", "7777"))
        self.base_url = f"http://{host}:{port}"

    def request(
        self, method, path, *, payload=None, token=None,
        missing=Status.MUMBLE, expected_statuses=(),
    ):
        headers = {"X-Token": token} if token else {}
        try:
            response = requests.request(
                method, self.base_url + path, headers=headers,
                json=payload, timeout=7,
            )
        except (requests.ConnectionError, requests.Timeout) as exc:
            self.cquit(Status.DOWN, "Cannot connect to service", str(exc))
        except requests.RequestException as exc:
            self.cquit(Status.MUMBLE, "Service response is inconsistent", str(exc))
        if response.status_code in expected_statuses:
            return response
        if response.status_code == 404:
            self.cquit(missing, "Service response is inconsistent", f"{path}: HTTP 404")
        if response.status_code >= 500:
            self.cquit(Status.MUMBLE, "Service response is inconsistent", f"{path}: HTTP {response.status_code}")
        if response.status_code >= 400:
            self.cquit(
                Status.MUMBLE, "Service response is inconsistent",
                f"{path}: HTTP {response.status_code}: {response.text[:200]}",
            )
        return response

    def check_dispatch_access(self, token, own_pass, foreign_pass, own_record, own_content, foreign_record):
        denied = self.request(
            "POST", "/dispatches/access", token=token,
            payload={"document": foreign_pass}, expected_statuses=(403,),
        )
        if denied.status_code != 403:
            self.cquit(
                Status.MUMBLE, "Service response is inconsistent",
                f"/dispatches/access with another inspector's guest pass: HTTP {denied.status_code}",
            )

        response = self.request(
            "POST", "/dispatches/access", token=token,
            payload={"document": own_pass},
        )
        if response.status_code != 200:
            self.cquit(
                Status.MUMBLE, "Service response is inconsistent",
                f"/dispatches/access: expected HTTP 200, got {response.status_code}",
            )
        try:
            items = response.json()
        except ValueError:
            self.cquit(Status.MUMBLE, "Service response is inconsistent", response.text[:200])
        if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
            self.cquit(Status.MUMBLE, "Service response is inconsistent", "Expected a list")
        own_items = [item for item in items if item.get("id") == own_record]
        if (
            {item.get("id") for item in items} != {own_record}
            or len(own_items) != 1
            or own_items[0].get("content") != own_content
            or foreign_record in {item.get("id") for item in items}
            or any(not isinstance(item.get("created_at"), str) or not item.get("created_at") for item in items)
        ):
            self.cquit(
                Status.MUMBLE, "Service response is inconsistent",
                f"expected own id={own_record} and no foreign id={foreign_record}",
            )

    def wait_for_corroboration_note(self, incident_id, flag, filename, token):
        expected = (
            f"Сверка межведомственного источника: {flag} "
            f"Приложен документ: {filename}."
        )
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            incident = self.request(
                "GET", f"/incidents/{quote(str(incident_id), safe='')}",
                token=token,
            ).json()
            if any(note.get("content") == expected for note in incident.get("notes", [])):
                return
            time.sleep(0.2)
        self.cquit(
            Status.MUMBLE, "Service response is inconsistent",
            f"incident={incident_id}",
        )

    @staticmethod
    def store(vuln):
        stores = {"1": 1, "2": 2}
        try:
            return stores[str(vuln)]
        except KeyError as exc:
            raise ValueError(f"unknown vuln {vuln!r}") from exc

    def register(self):
        callsign = secrets.token_hex(6)
        password = secrets.token_urlsafe(18)
        account = self.request(
            "POST", "/inspectors/register",
            payload={"callsign": callsign, "password": password},
        ).json()
        if not account.get("token") or not account.get("transit_pass"):
            self.cquit(Status.MUMBLE, "Service response is inconsistent", "Missing session data")
        return callsign, password, account["token"], account["transit_pass"]

    def login(self, callsign, password):
        account = self.request(
            "POST", "/inspectors/login",
            payload={"callsign": callsign, "password": password},
        ).json()
        if not account.get("token") or not account.get("transit_pass"):
            self.cquit(Status.MUMBLE, "Service response is inconsistent", "Missing session data")
        return account["token"], account["transit_pass"]

    def check_owner_transit_pass(self, token, transit_pass, record_id, flag):
        response = self.request(
            "POST", "/dispatches/access", token=token,
            payload={"document": transit_pass},
        )
        try:
            items = response.json()
        except ValueError:
            self.cquit(Status.MUMBLE, "Service response is inconsistent", response.text[:200])
        if not isinstance(items, list) or not any(
            isinstance(item, dict)
            and item.get("id") == record_id
            and item.get("content") == flag
            for item in items
        ):
            self.cquit(
                Status.MUMBLE, "Service response is inconsistent",
                f"expected own id={record_id}",
            )

    def read_record(self, store, record_id, token, transit_pass):
        record_key = quote(str(record_id), safe="")
        path = f"/dispatches/{record_key}"
        if store == 2:
            path = f"/briefings/access/{record_key}"
            response = self.request(
                "POST", path, token=token,
                payload={"document": transit_pass},
            )
            try:
                report = json.loads(response.json()["content"])
                return report["summary"]
            except (ValueError, KeyError, TypeError):
                self.cquit(Status.MUMBLE, "Service response is inconsistent", record_id)
        response = self.request("GET", path, token=token)
        try:
            return response.json()["content"]
        except (ValueError, KeyError, TypeError):
            self.cquit(Status.MUMBLE, "Service response is inconsistent", record_id)

    def check(self):
        callsign, _, token, _ = self.register()
        profile = self.request("GET", "/inspectors/me", token=token).json()
        if profile.get("callsign") != callsign or profile.get("rank") != "inspector":
            self.cquit(Status.MUMBLE, "Service response is inconsistent", json.dumps(profile))
        self.cquit(Status.OK)

    def put(self, flag_id, flag, vuln):
        store = self.store(vuln)
        callsign, password, token, transit_pass = self.register()

        if store == 1:
            _, _, foreign_token, foreign_pass = self.register()
            foreign_record = self.request(
                "POST", "/dispatches", token=foreign_token,
                payload={"content": "checker-decoy-" + secrets.token_hex(8)},
            ).json().get("id")
            if (
                isinstance(foreign_record, bool)
                or not isinstance(foreign_record, int)
                or foreign_record < 1
            ):
                self.cquit(Status.MUMBLE, "Service response is inconsistent", "Missing resource ID")
            record = self.request(
                "POST", "/dispatches", token=token,
                payload={"content": flag},
            ).json()
            record_id = record.get("id")
            self.check_dispatch_access(
                token, transit_pass, foreign_pass, record_id, flag, foreign_record,
            )
        else:
            incident = self.request(
                "POST", "/incidents", token=token,
                payload={
                    "title": "Сверка дежурной записи",
                    "description": "Проверка штатного канала оперативной сверки.",
                    "priority": "normal",
                },
            ).json()
            incident_id = incident.get("id")
            if not isinstance(incident_id, str) or not incident_id:
                self.cquit(Status.MUMBLE, "Service response is inconsistent", json.dumps(incident))
            request_id = secrets.token_hex(12)
            attachment_name = f"checker-{request_id[:8]}.txt"
            attachment = {
                "filename": attachment_name,
                "content_type": "text/plain",
                "data_base64": b64encode(b"checker evidence").decode("ascii"),
            }
            result = self.request(
                "POST",
                f"/incidents/{quote(incident_id, safe='')}/request-corroboration",
                token=token,
                payload={
                    "summary": flag,
                    "request_id": request_id,
                    "attachment": attachment,
                },
            ).json()
            if (
                result.get("queued") is not True
                or result.get("status") != 200
                or result.get("request_id") != request_id
                or result.get("incident_id") != incident_id
            ):
                self.cquit(Status.MUMBLE, "Service response is inconsistent", json.dumps(result))
            snapshot = self.request(
                "POST", "/briefings/access", token=token,
                payload={"document": transit_pass},
            ).json()
            record_id = None
            for key, value in snapshot.get("items", {}).items():
                try:
                    content = json.loads(value)
                except (TypeError, ValueError):
                    continue
                if (
                    isinstance(content, dict)
                    and content.get("summary") == flag
                    and content.get("request_id") == request_id
                ):
                    record_id = int(key)
                    break

        if isinstance(record_id, bool) or not isinstance(record_id, int) or record_id < 1:
            self.cquit(Status.MUMBLE, "Service response is inconsistent", "Missing resource ID")
        if self.read_record(store, record_id, token, transit_pass) != flag:
            self.cquit(Status.MUMBLE, "Service response is inconsistent", f"store={store}")
        if store == 2:
            self.wait_for_corroboration_note(
                incident_id, flag, attachment_name, token,
            )

        private = json.dumps(
            {"a": record_id, "c": callsign, "p": password},
            separators=(",", ":"),
        )
        public = json.dumps({"a": record_id, "store": store})
        self.cquit(Status.OK, public=public, private=private)

    def get(self, flag_id, flag, vuln):
        store = self.store(vuln)
        try:
            private = json.loads(flag_id)
            record_id = private["a"]
            if all(key in private for key in ("c", "p")):
                token, transit_pass = self.login(private["c"], private["p"])
            else:
                token = private["token"]
                transit_pass = private["transit_pass"]
        except (TypeError, ValueError, KeyError):
            self.cquit(Status.MUMBLE, "Service response is inconsistent", "Missing account session")
        if isinstance(record_id, bool) or not isinstance(record_id, int):
            self.cquit(Status.MUMBLE, "Service response is inconsistent", "Resource ID is not numeric")
        if not isinstance(token, str) or not isinstance(transit_pass, str):
            self.cquit(Status.MUMBLE, "Service response is inconsistent", "Invalid account session")
        if store == 1:
            self.check_owner_transit_pass(token, transit_pass, record_id, flag)
        content = self.read_record(store, record_id, token, transit_pass)
        if content != flag:
            self.cquit(Status.CORRUPT, "Previously stored data is unavailable", f"store={store}, id={record_id}")
        self.cquit(Status.OK)


if __name__ == "__main__":
    checker = Checker(sys.argv[2])
    try:
        checker.action(sys.argv[1], *sys.argv[3:])
    except checker.get_check_finished_exception():
        cquit(Status(checker.status), checker.public, checker.private)
    except Exception as exc:
        cquit(Status.ERROR, "Checker error", f"{type(exc).__name__}: {exc}")
