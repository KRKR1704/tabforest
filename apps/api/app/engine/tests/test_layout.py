"""Test layout: no test module may be importable under two names (it would run its module-level code twice,
with two copies of its fixtures and fakes)."""

import sys
from pathlib import Path

import app.engine.tests as tests_pkg


def test_every_test_module_is_loaded_under_exactly_one_name() -> None:
    here = Path(tests_pkg.__file__).resolve().parent
    names: dict[str, list[str]] = {}
    for name, module in list(sys.modules.items()):
        file = getattr(module, "__file__", None)
        if file and Path(file).resolve().parent == here and Path(file).name.startswith(("test_", "conftest")):
            names.setdefault(str(Path(file).resolve()), []).append(name)
    twice = {path: found for path, found in names.items() if len(found) > 1}
    assert not twice, f"loaded under more than one name: {twice}"
    assert all(found[0].startswith("app.engine.tests.") for found in names.values())
