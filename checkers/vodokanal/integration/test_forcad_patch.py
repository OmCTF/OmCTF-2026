#!/usr/bin/env python3
import argparse
import ast
import copy
from pathlib import Path
from types import SimpleNamespace


def function_at(path, name, namespace):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name)
    function = copy.deepcopy(function)
    function.decorator_list = []
    function.returns = None
    for argument in list(function.args.args) + list(function.args.kwonlyargs):
        argument.annotation = None
    try:
        module = ast.Module(body=[function], type_ignores=[])
    except TypeError:
        module = ast.Module(body=[function])
    ast.fix_missing_locations(module)
    exec(compile(module, str(path), "exec"), namespace)
    return namespace[name]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--forcad", type=Path, required=True)
    args = parser.parse_args()
    root = args.forcad.resolve()
    utils_file = root / "backend/services/ticker/hooks/utils.py"
    actions_file = root / "backend/services/tasks/actions.py"
    class FakeApp:
        def signature(self, name, kwargs, **params):
            return {"name": name, "kwargs": kwargs, "params": params}
    namespace = {
        "group": lambda *items: items,
        "JobNames": SimpleNamespace(put_action="put_action"),
    }
    get_puts_group = function_at(utils_file, "get_puts_group", namespace)
    balanced = SimpleNamespace(puts=2, places=2, checker_tags=["pfr", "balanced"], name="vodokanal", id=1,
                               set_flag_data=lambda flag, verdict: flag)
    signatures = get_puts_group(FakeApp(), balanced, {"team": "test"}, {})
    assert [item["kwargs"]["put_index"] for item in signatures] == [0, 1]
    assert all(item["name"] == "put_action" for item in signatures)
    added = []
    namespace = {
        "logger": SimpleNamespace(info=lambda *args: None),
        "secrets": SimpleNamespace(token_hex=lambda size: "a" * (size * 2), choice=lambda values: values[-1]),
        "models": SimpleNamespace(Flag=SimpleNamespace(generate=lambda **kwargs: SimpleNamespace())),
        "checkers": SimpleNamespace(CheckerRunner=lambda **kwargs: SimpleNamespace(
            put=lambda: SimpleNamespace(status=101))),
        "TaskStatus": SimpleNamespace(UP=101),
        "storage": SimpleNamespace(flags=SimpleNamespace(add_flag=added.append)),
    }
    put_action = function_at(actions_file, "put_action", namespace)
    team = SimpleNamespace(id=1)
    for index in (0, 1):
        put_action(None, team, balanced, 1, index)
    assert [flag.vuln_number for flag in added] == [1, 2]
    random_task = SimpleNamespace(puts=2, places=2, checker_tags=["pfr"], name="other", id=2,
                                  set_flag_data=lambda flag, verdict: flag)
    for index in (0, 1):
        put_action(None, team, random_task, 1, index)
    assert [flag.vuln_number for flag in added[2:]] == [2, 2]
    print("BALANCED_PATCH_OK: places 1,2; untagged task keeps random selection")


if __name__ == "__main__":
    main()
