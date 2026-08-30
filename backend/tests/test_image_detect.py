"""Pure filename-based image detection -- no Docker, no git, no network."""

from pathlib import Path

from app.projects.image_detect import detect_image

DEFAULT = "node:22-bookworm-slim"


def test_no_manifest_falls_back_to_default(tmp_path: Path) -> None:
    assert detect_image(tmp_path, default=DEFAULT) == DEFAULT


def test_package_json_is_node(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text("{}")
    assert detect_image(tmp_path, default=DEFAULT) == "node:22-bookworm-slim"


def test_requirements_txt_is_python(tmp_path: Path) -> None:
    (tmp_path / "requirements.txt").write_text("flask\n")
    assert detect_image(tmp_path, default=DEFAULT) == "python:3.12-slim-bookworm"


def test_pyproject_toml_is_python(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text("[project]\nname = 'x'\n")
    assert detect_image(tmp_path, default=DEFAULT) == "python:3.12-slim-bookworm"


def test_go_mod_is_go(tmp_path: Path) -> None:
    (tmp_path / "go.mod").write_text("module example.com/x\n")
    assert detect_image(tmp_path, default=DEFAULT) == "golang:1.23-bookworm"


def test_cargo_toml_is_rust(tmp_path: Path) -> None:
    (tmp_path / "Cargo.toml").write_text("[package]\nname = 'x'\n")
    assert detect_image(tmp_path, default=DEFAULT) == "rust:1.80-slim-bookworm"


def test_pom_xml_is_java(tmp_path: Path) -> None:
    (tmp_path / "pom.xml").write_text("<project></project>\n")
    assert detect_image(tmp_path, default=DEFAULT) == "eclipse-temurin:21-jdk-jammy"


def test_gemfile_is_ruby(tmp_path: Path) -> None:
    (tmp_path / "Gemfile").write_text("source 'https://rubygems.org'\n")
    assert detect_image(tmp_path, default=DEFAULT) == "ruby:3.3-slim-bookworm"


def test_composer_json_is_php(tmp_path: Path) -> None:
    (tmp_path / "composer.json").write_text("{}")
    assert detect_image(tmp_path, default=DEFAULT) == "php:8.3-cli-bookworm"


def test_first_matching_rule_wins(tmp_path: Path) -> None:
    """A Node app with a Python build script still gets the Node image."""
    (tmp_path / "package.json").write_text("{}")
    (tmp_path / "requirements.txt").write_text("build-helper\n")
    assert detect_image(tmp_path, default=DEFAULT) == "node:22-bookworm-slim"


def test_nested_manifest_is_ignored(tmp_path: Path) -> None:
    """Only the repo root is checked -- a manifest in a subdirectory doesn't count."""
    nested = tmp_path / "packages" / "sub"
    nested.mkdir(parents=True)
    (nested / "package.json").write_text("{}")
    assert detect_image(tmp_path, default=DEFAULT) == DEFAULT
