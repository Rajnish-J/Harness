"""apply_patch and multi_edit -- the mutating tools.

The load-bearing assertions here are the atomicity ones, and they check the
bytes on disk rather than only the error message. "Nothing was applied" is a
promise the failure text makes to the model, and a model that believes it will
not re-apply the half it thinks got through. If that promise is ever wrong,
these are the tests that say so.
"""

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


# ------------------------------------------------------------------ apply_patch


async def test_applies_a_single_hunk(settings, tmp_path):
    (tmp_path / "a.txt").write_text("one\ntwo\nthree\n", encoding="utf-8")
    patch = (
        "--- a/a.txt\n"
        "+++ b/a.txt\n"
        "@@ -1,3 +1,3 @@\n"
        " one\n"
        "-two\n"
        "+TWO\n"
        " three\n"
    )

    result = await dispatch("apply_patch", {"patch": patch}, settings)

    assert not result.is_error
    assert (tmp_path / "a.txt").read_text(encoding="utf-8") == "one\nTWO\nthree\n"


async def test_applies_across_two_files(settings, tmp_path):
    (tmp_path / "a.txt").write_text("alpha\n", encoding="utf-8")
    (tmp_path / "b.txt").write_text("beta\n", encoding="utf-8")
    patch = (
        "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-alpha\n+ALPHA\n"
        "--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-beta\n+BETA\n"
    )

    result = await dispatch("apply_patch", {"patch": patch}, settings)

    assert not result.is_error
    assert (tmp_path / "a.txt").read_text(encoding="utf-8") == "ALPHA\n"
    assert (tmp_path / "b.txt").read_text(encoding="utf-8") == "BETA\n"


async def test_a_failure_in_file_two_leaves_file_one_untouched(settings, tmp_path):
    """The core guarantee. Assert the bytes, not just the error."""
    (tmp_path / "a.txt").write_text("alpha\n", encoding="utf-8")
    (tmp_path / "b.txt").write_text("beta\n", encoding="utf-8")
    patch = (
        "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-alpha\n+ALPHA\n"
        "--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-NOT WHAT IS THERE\n+BETA\n"
    )

    result = await dispatch("apply_patch", {"patch": patch}, settings)

    assert result.is_error
    assert "Nothing was applied" in result.content
    assert (tmp_path / "a.txt").read_text(encoding="utf-8") == "alpha\n"
    assert (tmp_path / "b.txt").read_text(encoding="utf-8") == "beta\n"


async def test_creates_a_new_file_from_dev_null(settings, tmp_path):
    patch = "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+hello\n+world\n"

    result = await dispatch("apply_patch", {"patch": patch}, settings)

    assert not result.is_error
    # Ends with a newline, like any other text file a tool writes.
    assert (tmp_path / "new.txt").read_text(encoding="utf-8") == "hello\nworld\n"


async def test_refuses_to_create_a_file_that_already_exists(settings, tmp_path):
    (tmp_path / "new.txt").write_text("mine\n", encoding="utf-8")
    patch = "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+theirs\n"

    result = await dispatch("apply_patch", {"patch": patch}, settings)

    assert result.is_error
    assert (tmp_path / "new.txt").read_text(encoding="utf-8") == "mine\n"


async def test_deletes_a_file(settings, tmp_path):
    (tmp_path / "gone.txt").write_text("bye\n", encoding="utf-8")
    patch = "--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n"

    result = await dispatch("apply_patch", {"patch": patch}, settings)

    assert not result.is_error
    assert not (tmp_path / "gone.txt").exists()


async def test_tolerates_line_number_drift(settings, tmp_path):
    """Model-generated line numbers are routinely a few lines stale."""
    (tmp_path / "a.txt").write_text("pad\n" * 5 + "target\ntail\n", encoding="utf-8")
    # Claims line 2; the context actually sits at line 6.
    patch = "--- a/a.txt\n+++ b/a.txt\n@@ -2,2 +2,2 @@\n-target\n+CHANGED\n tail\n"

    result = await dispatch("apply_patch", {"patch": patch}, settings)

    assert not result.is_error
    assert "CHANGED" in (tmp_path / "a.txt").read_text(encoding="utf-8")


async def test_reports_what_it_expected_and_what_it_found(settings, tmp_path):
    (tmp_path / "a.txt").write_text("actual\n", encoding="utf-8")
    patch = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-expected\n+new\n"

    result = await dispatch("apply_patch", {"patch": patch}, settings)

    assert result.is_error
    assert "expected" in result.content
    assert "actual" in result.content


async def test_refuses_a_path_outside_the_sandbox(settings, tmp_path):
    patch = "--- a/../escape.txt\n+++ b/../escape.txt\n@@ -1 +1 @@\n-x\n+y\n"

    result = await dispatch("apply_patch", {"patch": patch}, settings)

    assert result.is_error
    assert not (tmp_path.parent / "escape.txt").exists()


async def test_rejects_garbage_input(settings, tmp_path):
    result = await dispatch("apply_patch", {"patch": "this is not a diff"}, settings)

    assert result.is_error
    assert "No hunks found" in result.content


async def test_rejects_an_empty_patch(settings, tmp_path):
    result = await dispatch("apply_patch", {"patch": "   "}, settings)

    assert result.is_error


async def test_patching_a_missing_file_changes_nothing(settings, tmp_path):
    patch = "--- a/nope.txt\n+++ b/nope.txt\n@@ -1 +1 @@\n-x\n+y\n"

    result = await dispatch("apply_patch", {"patch": patch}, settings)

    assert result.is_error
    assert "Nothing was applied" in result.content


async def test_crlf_file_matches_an_lf_patch(settings, tmp_path):
    """A patch generated on Linux must still apply to a CRLF checkout."""
    (tmp_path / "crlf.txt").write_bytes(b"one\r\ntwo\r\nthree\r\n")
    patch = "--- a/crlf.txt\n+++ b/crlf.txt\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n"

    result = await dispatch("apply_patch", {"patch": patch}, settings)

    assert not result.is_error
    written = (tmp_path / "crlf.txt").read_bytes()
    assert b"TWO" in written
    # The file's own line endings survive the round trip.
    assert b"\r\n" in written


# ------------------------------------------------------------------- multi_edit


async def test_applies_edits_in_sequence(settings, tmp_path):
    (tmp_path / "a.py").write_text("a = 1\nb = 2\nc = 3\n", encoding="utf-8")

    result = await dispatch(
        "multi_edit",
        {
            "path": "a.py",
            "edits": [
                {"old_string": "a = 1", "new_string": "a = 10"},
                {"old_string": "b = 2", "new_string": "b = 20"},
            ],
        },
        settings,
    )

    assert not result.is_error
    assert (tmp_path / "a.py").read_text(encoding="utf-8") == "a = 10\nb = 20\nc = 3\n"


async def test_a_later_edit_sees_an_earlier_one(settings, tmp_path):
    """Sequential-on-result semantics, which the description promises."""
    (tmp_path / "a.py").write_text("value = 1\n", encoding="utf-8")

    result = await dispatch(
        "multi_edit",
        {
            "path": "a.py",
            "edits": [
                {"old_string": "value = 1", "new_string": "value = 2"},
                {"old_string": "value = 2", "new_string": "value = 3"},
            ],
        },
        settings,
    )

    assert not result.is_error
    assert (tmp_path / "a.py").read_text(encoding="utf-8") == "value = 3\n"


async def test_a_failing_edit_leaves_the_file_untouched(settings, tmp_path):
    """The other core guarantee, again checked on disk."""
    original = "a = 1\nb = 2\n"
    (tmp_path / "a.py").write_text(original, encoding="utf-8")

    result = await dispatch(
        "multi_edit",
        {
            "path": "a.py",
            "edits": [
                {"old_string": "a = 1", "new_string": "a = 10"},
                {"old_string": "b = 2", "new_string": "b = 20"},
                {"old_string": "NOT PRESENT", "new_string": "x"},
            ],
        },
        settings,
    )

    assert result.is_error
    assert "Edit 3 of 3" in result.content
    assert "No edits were applied." in result.content
    assert (tmp_path / "a.py").read_text(encoding="utf-8") == original


async def test_ambiguous_old_string_is_refused(settings, tmp_path):
    (tmp_path / "a.py").write_text("x = 1\nx = 1\n", encoding="utf-8")

    result = await dispatch(
        "multi_edit",
        {"path": "a.py", "edits": [{"old_string": "x = 1", "new_string": "x = 2"}]},
        settings,
    )

    assert result.is_error
    assert "appears 2 times" in result.content
    assert (tmp_path / "a.py").read_text(encoding="utf-8") == "x = 1\nx = 1\n"


async def test_replace_all_permits_multiple_matches(settings, tmp_path):
    (tmp_path / "a.py").write_text("x = 1\nx = 1\n", encoding="utf-8")

    result = await dispatch(
        "multi_edit",
        {
            "path": "a.py",
            "edits": [{"old_string": "x = 1", "new_string": "x = 2", "replace_all": True}],
        },
        settings,
    )

    assert not result.is_error
    assert (tmp_path / "a.py").read_text(encoding="utf-8") == "x = 2\nx = 2\n"


async def test_a_no_op_edit_is_refused(settings, tmp_path):
    (tmp_path / "a.py").write_text("x = 1\n", encoding="utf-8")

    result = await dispatch(
        "multi_edit",
        {"path": "a.py", "edits": [{"old_string": "x = 1", "new_string": "x = 1"}]},
        settings,
    )

    assert result.is_error
    assert "would do nothing" in result.content


async def test_malformed_edits_give_a_clear_message(settings, tmp_path):
    (tmp_path / "a.py").write_text("x = 1\n", encoding="utf-8")

    result = await dispatch("multi_edit", {"path": "a.py", "edits": ["nope"]}, settings)

    assert result.is_error
    assert "No edits were applied" in result.content


async def test_empty_edits_list_is_refused(settings, tmp_path):
    (tmp_path / "a.py").write_text("x = 1\n", encoding="utf-8")

    result = await dispatch("multi_edit", {"path": "a.py", "edits": []}, settings)

    assert result.is_error


async def test_result_over_the_size_limit_is_refused(tmp_path):
    settings = get_settings().model_copy(
        update={"workspace_root": tmp_path, "max_file_bytes": 40}
    )
    (tmp_path / "a.py").write_text("x = 1\n", encoding="utf-8")

    result = await dispatch(
        "multi_edit",
        {"path": "a.py", "edits": [{"old_string": "x = 1", "new_string": "y = " + "9" * 100}]},
        settings,
    )

    assert result.is_error
    assert (tmp_path / "a.py").read_text(encoding="utf-8") == "x = 1\n"


async def test_multi_edit_refuses_outside_the_sandbox(settings, tmp_path):
    result = await dispatch(
        "multi_edit",
        {"path": "../escape.py", "edits": [{"old_string": "a", "new_string": "b"}]},
        settings,
    )

    assert result.is_error
