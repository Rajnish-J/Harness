"""A project id becomes a directory name, so it is validated, not trusted.

Mirrors tests/test_validation.py in spirit: the interesting cases are all the
ways a caller could try to walk out of the workspace.
"""

import stat
from pathlib import Path

import pytest

from app.core.config import Settings
from app.projects.workspaces import (
    InvalidProjectIdError,
    project_root,
    project_workspace,
    remove_project_workspace,
    settings_for_project,
)

VALID_ID = "6f1b2c9e-0000-4a11-9f2c-abc123456789"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(anthropic_api_key="test-key", workspace_root=tmp_path)


@pytest.mark.parametrize(
    "project_id",
    [
        "",
        ".",
        "..",
        "../escape",
        "..\\escape",
        "nested/id",
        "nested\\id",
        "/absolute",
        "C:\\Windows",
        "has space",
        "has:colon",
        "a" * 65,
        "null\x00byte",
    ],
)
def test_unsafe_ids_are_rejected(settings: Settings, project_id: str) -> None:
    with pytest.raises(InvalidProjectIdError):
        project_workspace(settings, project_id)


def test_valid_id_resolves_inside_the_workspace(settings: Settings) -> None:
    path = project_workspace(settings, VALID_ID)
    assert path.is_relative_to(settings.workspace_root.resolve())
    assert path.name == "repo"
    assert path.parent.name == VALID_ID


def test_workspace_is_created(settings: Settings) -> None:
    assert project_workspace(settings, VALID_ID).is_dir()


def test_repo_is_nested_below_the_project_root(settings: Settings) -> None:
    """Non-repo project state needs somewhere git will never see it."""
    root = project_root(settings, VALID_ID)
    assert project_workspace(settings, VALID_ID).parent == root


def test_settings_for_project_reanchors_the_sandbox(settings: Settings) -> None:
    scoped = settings_for_project(settings, VALID_ID)
    assert scoped.workspace_root == project_workspace(settings, VALID_ID)
    # The original is untouched — model_copy, not mutation.
    assert settings.workspace_root != scoped.workspace_root


def test_scoped_settings_keep_every_other_field(settings: Settings) -> None:
    scoped = settings_for_project(settings, VALID_ID)
    assert scoped.max_file_bytes == settings.max_file_bytes
    assert scoped.llm_provider == settings.llm_provider


def test_two_projects_do_not_share_a_directory(settings: Settings) -> None:
    other = "1111aaaa-2222-4bbb-8ccc-333344445555"
    assert project_workspace(settings, VALID_ID) != project_workspace(settings, other)


def test_remove_deletes_read_only_files(settings: Settings) -> None:
    """git marks .git/objects read-only, and Windows then refuses to unlink.

    Regression: cleanup after a failed clone raised PermissionError and left a
    partial checkout behind — which is worse than no checkout, because
    everything downstream treats it as a working one.
    """
    repo = project_workspace(settings, VALID_ID)
    objects = repo / ".git" / "objects" / "pack"
    objects.mkdir(parents=True)
    pack = objects / "pack-abc.idx"
    pack.write_bytes(b"binary index")
    pack.chmod(stat.S_IREAD)

    remove_project_workspace(settings, VALID_ID)

    assert not project_root(settings, VALID_ID).exists()


def test_remove_is_a_noop_when_nothing_was_cloned(settings: Settings) -> None:
    """A clone that failed before creating anything still runs cleanup."""
    remove_project_workspace(settings, VALID_ID)  # must not raise


def test_remove_rejects_an_unsafe_id(settings: Settings) -> None:
    """Deletion is recursive, so the id guard matters most here."""
    with pytest.raises(InvalidProjectIdError):
        remove_project_workspace(settings, "../..")
