"""`{{ ref }}` interpolation for agent node prompts.

Deliberately not Jinja2. A prompt template is authored in the canvas and stored
in the database; a full template engine there means arbitrary attribute access
and, with some configurations, code execution. This resolves a fixed, tiny set
of references against workflow state and nothing else.

Supported references:
    {{ input }}            the run's user input
    {{ nodeId.output }}    a prior node's (truncated) final text
    {{ nodeId.status }}    "ok" | "error" | "skipped" | "cancelled"

Pure module: no I/O, no LangGraph, no LLM.
"""

import re
from typing import Any

# A reference is at most two dotted segments of [A-Za-z0-9_-].
_REF_PATTERN = re.compile(r"\{\{\s*([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?)\s*\}\}")

_NODE_FIELDS = {"output", "status", "error", "branch"}


class TemplateError(ValueError):
    """A template references something that cannot exist."""


def extract_refs(template: str) -> list[str]:
    """Every `{{ ref }}` in the template, in order, deduplicated."""
    seen: dict[str, None] = {}
    for match in _REF_PATTERN.finditer(template or ""):
        seen.setdefault(match.group(1), None)
    return list(seen)


def referenced_node_ids(template: str) -> list[str]:
    """The node ids a template depends on (i.e. refs other than `input`)."""
    ids: list[str] = []
    for ref in extract_refs(template):
        if ref == "input":
            continue
        node_id = ref.split(".", 1)[0]
        if node_id not in ids:
            ids.append(node_id)
    return ids


def validate_template(template: str, known_node_ids: set[str]) -> list[str]:
    """Return human-readable problems with a template. Empty list means fine."""
    problems: list[str] = []
    for ref in extract_refs(template):
        if ref == "input":
            continue
        if "." not in ref:
            problems.append(
                f"{{{{ {ref} }}}} is ambiguous — use {{{{ {ref}.output }}}}"
            )
            continue
        node_id, field = ref.split(".", 1)
        if node_id not in known_node_ids:
            problems.append(f"{{{{ {ref} }}}} refers to unknown node {node_id!r}")
        elif field not in _NODE_FIELDS:
            problems.append(
                f"{{{{ {ref} }}}} — unknown field {field!r}. "
                f"Allowed: {', '.join(sorted(_NODE_FIELDS))}"
            )
    return problems


def render(template: str, state: dict[str, Any], *, max_chars: int) -> str:
    """Substitute references from state.

    An unresolvable reference renders as an empty string rather than raising —
    by the time a run is executing, refusing to render is worse than rendering
    a gap. `validate_template` is what catches these at edit time.

    Each substitution is capped at `max_chars`: a prior node can produce a large
    output, and three references to it would otherwise blow up the prompt.
    """
    outputs = state.get("outputs") or {}

    def substitute(match: re.Match[str]) -> str:
        ref = match.group(1)
        if ref == "input":
            value: Any = state.get("input", "")
        elif "." in ref:
            node_id, field = ref.split(".", 1)
            node = outputs.get(node_id) or {}
            value = node.get("text" if field == "output" else field, "")
        else:
            value = ""

        text = "" if value is None else str(value)
        if len(text) > max_chars:
            text = text[:max_chars] + f"\n… [truncated {len(text) - max_chars} chars]"
        return text

    return _REF_PATTERN.sub(substitute, template or "")
