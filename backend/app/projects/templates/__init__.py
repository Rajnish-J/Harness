"""The starter scaffolds a new project can be created from.

Two halves on purpose. This module is the registry -- pure, declarative data
that the API, the agent's tool schema and the tests can all read cheaply. The
file bodies live on disk under `files/<source>/`, because a tsconfig.json
embedded in a Python triple-quote is unreadable and its braces fight f-strings.

Adding a template: drop a tree under files/, add a Template here, and give it a
row in test_scaffold.py's expectations. Nothing else needs to know.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

TEMPLATES_DIR = Path(__file__).parent / "files"


@dataclass(frozen=True)
class Template:
    """One starter scaffold, as offered to a human and to the model."""

    #: Stable, filesystem- and URL-safe. Stored nowhere, so it is free to
    #: rename -- but it appears in the tool schema's enum, so treat it as API.
    id: str
    #: Shown on the picker chip.
    name: str
    #: One line under the name. Kept short; the chips are small.
    description: str
    #: Directory under TEMPLATES_DIR holding the tree, copied verbatim.
    source: str


BLANK = Template(
    id="blank",
    name="Blank",
    description="An empty git repository with a README. Bring your own stack.",
    source="blank",
)

NEXTJS = Template(
    id="nextjs",
    name="Next.js app",
    description="React app router, TypeScript and Tailwind, ready to npm install.",
    source="nextjs",
)

FASTAPI = Template(
    id="fastapi",
    name="FastAPI service",
    description="An async HTTP service with a health route and a passing test.",
    source="fastapi",
)

PYTHON_CLI = Template(
    id="python-cli",
    name="Python CLI",
    description="An argparse entry point laid out as an installable package.",
    source="python-cli",
)

#: Order is the order the picker renders. Blank leads because it is the default
#: and the least surprising thing to land on.
TEMPLATES: tuple[Template, ...] = (BLANK, NEXTJS, FASTAPI, PYTHON_CLI)
TEMPLATES_BY_ID: dict[str, Template] = {t.id: t for t in TEMPLATES}
DEFAULT_TEMPLATE_ID = BLANK.id


class UnknownTemplateError(ValueError):
    """A template id that is not in the registry."""

    def __init__(self, template_id: str) -> None:
        self.template_id = template_id
        known = ", ".join(sorted(TEMPLATES_BY_ID))
        super().__init__(f"Unknown template {template_id!r}. Known templates: {known}.")


def get_template(template_id: str | None) -> Template:
    """Resolve an id to a Template. None and "" mean the default, not an error.

    Callers pass a value straight off the wire, where "the field was omitted"
    is ordinary -- an older client, or a model that did not pick one.
    """
    if not template_id:
        return TEMPLATES_BY_ID[DEFAULT_TEMPLATE_ID]
    try:
        return TEMPLATES_BY_ID[template_id]
    except KeyError as exc:
        raise UnknownTemplateError(template_id) from exc
