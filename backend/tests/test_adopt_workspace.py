"""Adopting a global chat's scratch files into a project.

`paths` arrives from the client, so most of this file is about what must NOT be
copied. The happy path is a file copy; the interesting cases are escapes.
"""

import pytest

from app.core.config import get_settings
from app.projects.adopt import adopt_paths
from app.projects.workspaces import project_workspace

PROJECT_ID = "11111111-1111-1111-1111-111111111111"
OTHER_ID = "22222222-2222-2222-2222-222222222222"


@pytest.fixture
def settings(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    return get_settings().model_copy(update={"workspace_root": root})


@pytest.fixture
def project_repo(settings):
    """An initialised-looking checkout for the project being adopted into."""
    destination = project_workspace(settings, PROJECT_ID)
    destination.mkdir(parents=True, exist_ok=True)
    return destination


def scratch(settings, name: str, body: str = "hello") -> None:
    path = settings.workspace_root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8", newline="")


def test_copies_a_scratch_file_into_the_project(settings, project_repo):
    scratch(settings, "index.html", "<h1>hi</h1>")

    result = adopt_paths(settings, PROJECT_ID, ["index.html"])

    assert result.copied == ["index.html"]
    assert (project_repo / "index.html").read_text(encoding="utf-8") == "<h1>hi</h1>"
    # The source survives: until this is committed it is the only copy.
    assert (settings.workspace_root / "index.html").is_file()


def test_copies_into_nested_directories(settings, project_repo):
    scratch(settings, "static/css/style.css", "body{}")

    result = adopt_paths(settings, PROJECT_ID, ["static/css/style.css"])

    assert result.copied == ["static/css/style.css"]
    assert (project_repo / "static" / "css" / "style.css").is_file()


@pytest.mark.parametrize(
    "path",
    [
        "../outside.txt",
        "../../etc/passwd",
        "/etc/passwd",
        r"C:\Windows\System32\drivers\etc\hosts",
        "",
    ],
)
def test_rejects_paths_that_escape_the_scratch_root(settings, project_repo, path):
    result = adopt_paths(settings, PROJECT_ID, [path])

    assert result.copied == []
    assert len(result.skipped) == 1


def test_refuses_to_read_out_of_another_projects_checkout(settings, project_repo):
    """`projects/` is where other checkouts live; it is never scratch space."""
    victim = project_workspace(settings, OTHER_ID)
    victim.mkdir(parents=True, exist_ok=True)
    (victim / "secret.env").write_text("TOKEN=abc", encoding="utf-8", newline="")

    relative = f"projects/{OTHER_ID}/repo/secret.env"
    result = adopt_paths(settings, PROJECT_ID, [relative])

    assert result.copied == []
    assert result.skipped == [(relative, "not a scratch-workspace file")]
    assert not (project_repo / "secret.env").exists()


def test_never_overwrites_an_existing_project_file(settings, project_repo):
    """A scaffolded README is a likely collision and must survive."""
    (project_repo / "README.md").write_text("# scaffolded", encoding="utf-8", newline="")
    scratch(settings, "README.md", "# from chat")

    result = adopt_paths(settings, PROJECT_ID, ["README.md"])

    assert result.copied == []
    assert result.skipped == [("README.md", "already exists in the project")]
    assert (project_repo / "README.md").read_text(encoding="utf-8") == "# scaffolded"


def test_skips_a_file_the_agent_later_deleted(settings, project_repo):
    result = adopt_paths(settings, PROJECT_ID, ["gone.txt"])

    assert result.copied == []
    assert result.skipped == [("gone.txt", "no longer exists")]


def test_skips_directories(settings, project_repo):
    (settings.workspace_root / "assets").mkdir()

    result = adopt_paths(settings, PROJECT_ID, ["assets"])

    assert result.copied == []
    assert result.skipped == [("assets", "is a directory")]


def test_one_bad_path_does_not_stop_the_others(settings, project_repo):
    scratch(settings, "good.txt")

    result = adopt_paths(settings, PROJECT_ID, ["../escape", "good.txt"])

    assert result.copied == ["good.txt"]
    assert len(result.skipped) == 1


def test_empty_input_is_not_an_error(settings, project_repo):
    result = adopt_paths(settings, PROJECT_ID, [])
    assert result.copied == [] and result.skipped == []
