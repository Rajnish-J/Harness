"""The starter scaffolds, exercised without git, Docker or a network.

Modelled on test_devcontainer.py: everything lands in tmp_path, so these stay
fast and can assert on exact bytes.
"""

import json
import re
import tomllib

import pytest

from app.core.workspace import WorkspaceSecurityError
from app.projects.image_detect import detect_image
from app.projects.scaffold import apply_template
from app.projects.templates import (
    TEMPLATES,
    TEMPLATES_BY_ID,
    DEFAULT_TEMPLATE_ID,
    UnknownTemplateError,
    get_template,
)

_SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def scaffold(tmp_path, template_id, *, name="Demo App", slug="demo-app"):
    destination = tmp_path / "repo"
    destination.mkdir(exist_ok=True)
    written = apply_template(
        destination, get_template(template_id), project_name=name, project_slug=slug
    )
    return destination, written


# --- registry integrity -------------------------------------------------


def test_every_template_has_a_source_directory():
    from app.projects.templates import TEMPLATES_DIR

    for template in TEMPLATES:
        assert (TEMPLATES_DIR / template.source).is_dir(), template.id


@pytest.mark.parametrize("template", TEMPLATES, ids=lambda t: t.id)
def test_template_ids_are_filesystem_safe(template):
    assert _SAFE_ID.match(template.id), template.id


def test_default_template_is_registered():
    assert DEFAULT_TEMPLATE_ID in TEMPLATES_BY_ID


def test_get_template_treats_missing_as_the_default():
    assert get_template(None).id == DEFAULT_TEMPLATE_ID
    assert get_template("").id == DEFAULT_TEMPLATE_ID


def test_unknown_template_id_raises_and_names_the_known_ones():
    with pytest.raises(UnknownTemplateError) as caught:
        get_template("nope")
    assert "nextjs" in str(caught.value)


# --- writing ------------------------------------------------------------


@pytest.mark.parametrize("template", TEMPLATES, ids=lambda t: t.id)
def test_every_template_writes_a_readme_and_a_gitignore(tmp_path, template):
    destination, written = scaffold(tmp_path, template.id)
    assert (destination / "README.md").is_file()
    # The dotfile un-masking: shipped as dot_gitignore, written as .gitignore.
    assert (destination / ".gitignore").is_file()
    assert not (destination / "dot_gitignore").exists()
    assert "README.md" in written and ".gitignore" in written


@pytest.mark.parametrize("template", TEMPLATES, ids=lambda t: t.id)
def test_written_paths_all_land_inside_the_destination(tmp_path, template):
    destination, written = scaffold(tmp_path, template.id)
    for relative in written:
        resolved = (destination / relative).resolve()
        assert resolved.is_relative_to(destination.resolve())
        assert resolved.is_file()


def test_project_name_is_substituted(tmp_path):
    destination, _ = scaffold(tmp_path, "blank", name="Expense Tracker")
    assert "# Expense Tracker" in (destination / "README.md").read_text(encoding="utf-8")
    assert "{{project_name}}" not in (destination / "README.md").read_text(
        encoding="utf-8"
    )


@pytest.mark.parametrize("template", TEMPLATES, ids=lambda t: t.id)
def test_no_placeholder_survives_into_the_written_tree(tmp_path, template):
    destination, written = scaffold(tmp_path, template.id)
    for relative in written:
        body = (destination / relative).read_bytes()
        assert b"{{project_" not in body, f"{relative} kept a placeholder"
        assert "{{project_" not in relative, f"{relative} kept a placeholder in its path"


def test_slug_becomes_an_importable_package_name(tmp_path):
    """Hyphens are legal in a slug and illegal in a Python package."""
    destination, _ = scaffold(tmp_path, "python-cli", slug="expense-tracker")
    assert (destination / "src" / "expense_tracker" / "__main__.py").is_file()
    assert not (destination / "src" / "expense-tracker").exists()
    # ...while npm keeps the hyphen, which is why the two placeholders differ.
    manifest = tomllib.loads(
        (destination / "pyproject.toml").read_text(encoding="utf-8")
    )
    assert manifest["project"]["name"] == "expense_tracker"


def test_dunder_filenames_survive_the_dotfile_convention(tmp_path):
    """Regression: a bare "_" prefix turned __init__.py into ._init__.py.

    Silent, too -- the package simply had no __init__ and nothing complained
    until an import failed. The marker is "dot_", which a dunder cannot match.
    """
    destination, written = scaffold(tmp_path, "python-cli", slug="demo")
    assert (destination / "src" / "demo" / "__init__.py").is_file()
    assert (destination / "src" / "demo" / "__main__.py").is_file()
    assert not any(name.startswith(".") for name in written if "/" in name)


def test_existing_files_are_never_overwritten(tmp_path):
    destination = tmp_path / "repo"
    destination.mkdir()
    (destination / "README.md").write_text("mine", encoding="utf-8")

    written = apply_template(
        destination, get_template("blank"), project_name="X", project_slug="x"
    )
    assert (destination / "README.md").read_text(encoding="utf-8") == "mine"
    assert "README.md" not in written
    assert ".gitignore" in written


def test_scaffolding_is_idempotent(tmp_path):
    destination, first = scaffold(tmp_path, "fastapi")
    _, second = scaffold(tmp_path, "fastapi")
    assert first and not second


# --- the files have to be real ------------------------------------------


def test_nextjs_package_json_parses_and_names_the_project(tmp_path):
    destination, _ = scaffold(tmp_path, "nextjs", name="Demo App", slug="demo-app")
    manifest = json.loads((destination / "package.json").read_text(encoding="utf-8"))
    assert manifest["name"] == "demo-app"
    assert "next" in manifest["dependencies"]


def test_python_cli_pyproject_parses_and_declares_its_script(tmp_path):
    destination, _ = scaffold(tmp_path, "python-cli", slug="demo-app")
    manifest = tomllib.loads((destination / "pyproject.toml").read_text(encoding="utf-8"))
    assert manifest["project"]["name"] == "demo_app"
    assert "demo_app" in manifest["project"]["scripts"]


def test_fastapi_template_ships_a_requirements_file(tmp_path):
    destination, _ = scaffold(tmp_path, "fastapi")
    assert "fastapi" in (destination / "requirements.txt").read_text(encoding="utf-8")
    assert (destination / "app" / "main.py").is_file()


@pytest.mark.parametrize("template", TEMPLATES, ids=lambda t: t.id)
def test_written_files_use_lf_endings(tmp_path, template):
    """Guards the newline="" rule; a CRLF template makes the first diff noise."""
    destination, written = scaffold(tmp_path, template.id)
    for relative in written:
        assert b"\r\n" not in (destination / relative).read_bytes(), relative


# --- the integration that matters ---------------------------------------


@pytest.mark.parametrize(
    ("template_id", "expected"),
    [
        ("nextjs", "node:22-bookworm-slim"),
        ("fastapi", "python:3.12-slim-bookworm"),
        ("python-cli", "python:3.12-slim-bookworm"),
    ],
)
def test_scaffolding_before_devcontainer_picks_the_right_base_image(
    tmp_path, template_id, expected
):
    """Pins the ordering in init_project: scaffold first, ensure_devcontainer after.

    detect_image only sees a manifest that already exists, so reversing those
    two calls would silently give every project the generic default.
    """
    destination, _ = scaffold(tmp_path, template_id)
    assert detect_image(destination, default="generic:latest") == expected


def test_blank_template_leaves_the_default_image_alone(tmp_path):
    destination, _ = scaffold(tmp_path, "blank")
    assert detect_image(destination, default="generic:latest") == "generic:latest"
