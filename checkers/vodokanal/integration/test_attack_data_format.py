#!/usr/bin/env python3
import argparse
import ast
import json
import re
from pathlib import Path


def load_formatter(path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    function = next(node for node in tree.body
                    if isinstance(node, ast.FunctionDef)
                    and node.name == "flatten_vodokanal_hints")
    module = ast.Module(body=[function], type_ignores=[])
    namespace = {
        "json": json,
        "uuid_pattern": re.compile(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"),
    }
    exec(compile(ast.fix_missing_locations(module), str(path), "exec"), namespace)
    return namespace["flatten_vodokanal_hints"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--forcad", type=Path, required=True)
    args = parser.parse_args()
    formatter = load_formatter(
        args.forcad / "backend/services/api/views.py")
    first = "11111111-1111-1111-1111-111111111111"
    second = "22222222-2222-2222-2222-222222222222"
    data = {
        "vodokanal": {
            "10.0.0.1": [
                json.dumps({"type": "summary", "id": first}),
                json.dumps({"type": "attachment", "id": second,
                            "request": first, "login": "user",
                            "password": "secret"}),
            ],
        },
        "other": {"10.0.0.2": ["opaque"]},
    }
    result = formatter(data)
    assert result == {
        "vodokanal": {
            "10.0.0.1": [first, second],
        },
        "other": {"10.0.0.2": ["opaque"]},
    }
    assert "secret" not in json.dumps(result)
    assert formatter(None) is None
    print("ATTACK_DATA_FORMAT_OK")


if __name__ == "__main__":
    main()
