"""Exercise the packaged engine with real compiled programs."""

import argparse
import base64
import json
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("token_file", type=Path)
    parser.add_argument("--digest", default="")
    parser.add_argument("--executor-exhausted", action="store_true",
                        help="check temporary failures on a warm referee with no available process slots")
    args = parser.parse_args()
    token = args.token_file.read_text().strip()

    def call(path, body=None, status=200, *, authenticated=True, digest=args.digest):
        headers = {"Accept": "application/json"}
        if authenticated:
            headers["Authorization"] = "Bearer " + token
        if digest:
            headers["X-Arena-Package-Digest"] = digest
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(args.url.rstrip("/") + path, data=data, headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=45)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            result = json.load(response)
            assert response.code == status, (path, response.code, result)
            return result

    health = call("/health", authenticated=False)
    assert health["status"] == "ok" and health["api_version"] == "arena/v1"
    assert health["version"] == "1.0.0"
    assert health.get("package_digest", "") == args.digest

    rule_request = {"epoch": 0, "seed": str(2**64 - 1), "first_round": 1}
    call("/v1/rules", rule_request, status=403, authenticated=False)
    if args.digest:
        call("/v1/rules", rule_request, status=409, digest="")
    rule_response = call("/v1/rules", rule_request)
    assert rule_response == call("/v1/rules", dict(rule_request, config={}))
    call("/v1/rules", dict(rule_request, config={"turns": 1}), status=422)
    assert rule_response == call("/v1/rules", rule_request)
    assert call("/v1/rules", dict(rule_request, epoch=1, first_round=4))["rules"]["weather"] == 1
    rules = rule_response["rules"]
    # Legacy rule generator with the selected decimal seed as key and task
    # context 0. The generic controller supplies the per-task context itself.
    assert rules == {
        "cost": [6, 9, 8, 12, 11, 6, 8, 11, 10, 10, 14, 10],
        "damage": [5, 1, 4, 5, 3, 1, 3, 5, 2, 2, 3, 1],
        "guard_budget": 113,
        "health": [13, 19, 10, 12, 10, 8, 12, 10, 8, 13, 7, 10],
        "raider_budget": 132,
        "speed": [2, 2, 2, 2, 3, 2, 1, 1, 3, 3, 3, 2],
        "supply": 13,
        "terrain_seed": 13682152477762554866,
        "thresholds": [25, 50, 75],
        "turns": 18,
        "vault_armor": 1,
        "weather": 0,
    }

    def encoded(data):
        return base64.b64encode(data).decode()

    source = (ROOT / "sdk/examples/raider.cpp").read_bytes()
    validate = {"rules": rules, "role": "raider", "program": encoded(source)}
    request = {
        "match_id": "contract-match-1",
        "round": 1,
        "seed": str(2**64 - 1),
        "rules": rules,
        "players": [{"role": "raider", "program": encoded(source)}, {"role": "guard"}],
    }
    if args.executor_exhausted:
        call("/v1/validate", validate, status=503)
        call("/v1/match", request, status=503)
        assert call("/health", authenticated=False) == health
        print("Arena referee reported temporary executor exhaustion")
        return

    valid = call("/v1/validate", validate)
    assert valid["valid"] is True and valid["recruits"] > 0 and valid["spent"] > 0
    bad = call("/v1/validate", dict(validate, program=encoded(b"invalid C++ input")))
    assert bad["valid"] is False and bad["diagnostic"]
    call("/v1/validate", dict(validate, program="bad!"), status=422)

    # Detect accidental inheritance of service settings or access to a secret
    # file from a compiled player program.
    private = b'''#include "kazna.hpp"
#include <cstdlib>
#include <fstream>
namespace kazna::sdk {
std::vector<Recruit> deploy(const DeploymentContext &) {
  if (std::getenv("ARENA_TOKEN_FILE") || std::getenv("ARENA_PACKAGE_DIGEST") ||
      std::ifstream("/run/secrets/arena-token").good()) std::abort();
  return {{Kind::Blade, 0}};
}
std::vector<Command> decide(const Observation &) { return {}; }
}
'''
    assert call("/v1/validate", dict(validate, program=encoded(private)))["valid"] is True

    result = call("/v1/match", request)
    assert result == call("/v1/match", request)
    assert result["replay"]["round"] == 1
    assert result["captures"] == [result["replay"]["grade"], 0]
    assert sum(result["points"]) == 3
    swapped = call("/v1/match", dict(request, players=request["players"][::-1]))
    assert swapped["captures"] == result["captures"][::-1]
    assert swapped["points"] == result["points"][::-1]

    absent = call("/v1/match", dict(request, players=[{"role": "raider"}, {"role": "guard"}]))
    assert absent["winner"] == 1 and absent["captures"] == [0, 0]
    # A build which cannot be reproduced during a match is a retryable failure,
    # not a scored forfeit.
    call("/v1/match", dict(request, players=[{"role": "raider", "program": encoded(b"invalid C++")},
                                            {"role": "guard"}]), status=500)
    print("Arena referee contract passed")


if __name__ == "__main__":
    main()
