"""Project insight tools, dispatched through the loop like the real thing."""

import json

import pytest

from app.agent.llm.base import ToolCallRequest
from app.agent.loop import _dispatch_tool
from app.agent.tools.registry import ALL_TOOLS
from app.core.config import get_settings

TOOLS_BY_NAME = {tool.name: tool for tool in ALL_TOOLS}


@pytest.fixture
def settings(tmp_path):
    return get_settings().model_copy(update={"workspace_root": tmp_path})


async def dispatch(name, arguments, settings):
    return await _dispatch_tool(
        ToolCallRequest(id="c1", name=name, arguments=arguments), settings, TOOLS_BY_NAME
    )


def write_package_json(tmp_path, **overrides):
    data = {
        "name": "demo-app",
        "version": "1.2.3",
        "scripts": {"dev": "next dev", "test": "vitest run"},
        "dependencies": {"next": "16.3.2", "react": "19.2.8"},
        "devDependencies": {"typescript": "5.9.0"},
    }
    data.update(overrides)
    (tmp_path / "package.json").write_text(json.dumps(data), encoding="utf-8")


# ------------------------------------------------------------ project_overview


async def test_overview_reports_package_scripts_verbatim(settings, tmp_path):
    write_package_json(tmp_path)

    result = await dispatch("project_overview", {}, settings)

    assert not result.is_error
    assert "demo-app" in result.content
    assert "next dev" in result.content
    assert "vitest run" in result.content


async def test_overview_reports_unconfigured_commands(settings, tmp_path):
    """The line that saves a turn: which checks exist, before calling one."""
    write_package_json(tmp_path)

    result = await dispatch("project_overview", {}, settings)

    assert "run_typecheck  (not configured)" in result.content


async def test_overview_reports_a_configured_command(tmp_path):
    """Proves the setting reaches the tool through _dispatch_tool's injection."""
    settings = get_settings().model_copy(
        update={"workspace_root": tmp_path, "test_command": "pytest -q"}
    )
    write_package_json(tmp_path)

    result = await dispatch("project_overview", {}, settings)

    assert "run_tests      pytest -q" in result.content


async def test_overview_on_an_empty_directory_is_not_an_error(settings, tmp_path):
    result = await dispatch("project_overview", {}, settings)

    assert not result.is_error
    assert "No package manifest found" in result.content


async def test_overview_detects_python_and_ci(settings, tmp_path):
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "svc"\nrequires-python = ">=3.12"\n', encoding="utf-8"
    )
    (tmp_path / "pytest.ini").write_text("[pytest]\n", encoding="utf-8")
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "ci.yml").write_text("on: push\n", encoding="utf-8")

    result = await dispatch("project_overview", {}, settings)

    assert "svc" in result.content
    assert ">=3.12" in result.content
    assert "pytest.ini" in result.content
    assert "ci.yml" in result.content


async def test_overview_refuses_a_path_outside_the_sandbox(settings, tmp_path):
    result = await dispatch("project_overview", {"path": "../elsewhere"}, settings)

    assert result.is_error


# ----------------------------------------------------------- list_dependencies


async def test_list_dependencies_reads_package_json(settings, tmp_path):
    write_package_json(tmp_path)

    result = await dispatch("list_dependencies", {}, settings)

    assert not result.is_error
    assert "next" in result.content
    assert "typescript" in result.content


async def test_include_dev_false_omits_dev_dependencies(settings, tmp_path):
    write_package_json(tmp_path)

    result = await dispatch("list_dependencies", {"include_dev": False}, settings)

    assert "react" in result.content
    assert "typescript" not in result.content


async def test_list_dependencies_reads_requirements_txt(settings, tmp_path):
    (tmp_path / "requirements.txt").write_text(
        "# a comment\n\nfastapi==0.115.0\nhttpx>=0.28\n-r other.txt\n", encoding="utf-8"
    )

    result = await dispatch("list_dependencies", {}, settings)

    assert "fastapi==0.115.0" in result.content
    assert "httpx>=0.28" in result.content
    assert "a comment" not in result.content
    # An include is reported but deliberately not followed.
    assert "not followed" in result.content


async def test_malformed_manifest_names_the_file(settings, tmp_path):
    (tmp_path / "package.json").write_text("{not json", encoding="utf-8")

    result = await dispatch("list_dependencies", {}, settings)

    assert result.is_error
    assert "package.json" in result.content


async def test_list_dependencies_says_so_when_there_is_no_manifest(settings, tmp_path):
    result = await dispatch("list_dependencies", {}, settings)

    assert not result.is_error
    assert "No dependency manifest" in result.content


async def test_list_dependencies_disclaims_lockfiles(settings, tmp_path):
    write_package_json(tmp_path)

    result = await dispatch("list_dependencies", {}, settings)

    assert "not resolved ones" in result.content


# ------------------------------------------------------------------ file_stats


async def test_file_stats_counts_lines_on_a_file(settings, tmp_path):
    (tmp_path / "a.py").write_text("# note\nx = 1\n\ny = 2\n", encoding="utf-8")

    result = await dispatch("file_stats", {"path": "a.py"}, settings)

    assert not result.is_error
    assert "4 total" in result.content
    assert "3 non-blank" in result.content
    assert "line comments: 1" in result.content


async def test_file_stats_aggregates_a_directory_by_extension(settings, tmp_path):
    (tmp_path / "a.py").write_text("x = 1\n", encoding="utf-8")
    (tmp_path / "b.py").write_text("y = 2\n", encoding="utf-8")
    (tmp_path / "c.ts").write_text("const z = 3;\n", encoding="utf-8")

    result = await dispatch("file_stats", {}, settings)

    assert "3 files" in result.content
    assert ".py" in result.content
    assert ".ts" in result.content


async def test_file_stats_flags_files_over_the_read_limit(tmp_path):
    """The whole point: point at read_symbol before read_file refuses."""
    settings = get_settings().model_copy(
        update={"workspace_root": tmp_path, "max_file_bytes": 50}
    )
    (tmp_path / "big.py").write_text("x = 1\n" * 200, encoding="utf-8")

    result = await dispatch("file_stats", {}, settings)

    assert "exceed the 50-byte read limit" in result.content
    assert "read_symbol" in result.content


async def test_file_stats_flags_an_oversized_single_file(tmp_path):
    settings = get_settings().model_copy(
        update={"workspace_root": tmp_path, "max_file_bytes": 50}
    )
    (tmp_path / "big.py").write_text("x = 1\n" * 200, encoding="utf-8")

    result = await dispatch("file_stats", {"path": "big.py"}, settings)

    assert not result.is_error
    assert "read_file will refuse" in result.content


async def test_file_stats_honours_a_glob_pattern(settings, tmp_path):
    (tmp_path / "a.py").write_text("x = 1\n", encoding="utf-8")
    (tmp_path / "b.ts").write_text("const y = 2;\n", encoding="utf-8")

    result = await dispatch("file_stats", {"pattern": "**/*.py"}, settings)

    assert "1 files" in result.content
    assert ".ts" not in result.content
