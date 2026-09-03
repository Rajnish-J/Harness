"""Compose the per-turn system prompt from an agent preset and its skills.

Pure and side-effect free, so it can be tested without a model or a database.

Two properties this file exists to guarantee:

1. **A stable prefix.** The base prompt is a constant and comes first, so the
   longest possible shared prefix across every request in the deployment is
   identical bytes. The agent block is stable per agent, the skills block per
   skill *set*. Everything variable is pushed rightward. Same discipline as the
   tool ordering in app/agent/tools/toolsets.py, applied to the prompt.

2. **Order independence.** Skills are sorted here rather than kept in the order
   the user attached them. Attaching A-then-B and B-then-A must produce byte
   identical output, or the prefix cache misses for no reason at all.
"""

from collections.abc import Sequence
from typing import Protocol


class SkillLike(Protocol):
    """Structural type so this module does not import the API models."""

    name: str
    slug: str
    description: str | None
    content: str


class MemoryLike(Protocol):
    """Structural type so this module does not import app.db.memory_repo."""

    kind: str
    slug: str
    title: str
    content: str


TRUNCATION_NOTE = "\n[skill content truncated]"

#: Appended when no project is open (the global chat) and propose_create_project
#: is on offer. A two-state boolean rather than per-request text, so it stays as
#: cacheable-prefix-friendly as the rest of this module.
NO_PROJECT_OPEN_BLOCK = """## No project is open right now
This is the global chat: there is no project associated with this conversation \
yet. If the user describes a new idea or project they want to build, call \
propose_create_project(name, description) to suggest starting a blank one, \
instead of building it directly in this general-purpose scratch workspace. It \
creates nothing by itself -- a human must approve it in the UI -- so call it \
once per idea and then wait; do not call it again unless they describe a \
different idea, and do not retry it if they decline."""


def _escape(text: str, tag: str = "skill") -> str:
    """Keep a block's body from closing the tag that delimits it.

    Skill and memory content is markdown authored outside this file (by an
    operator, or by the agent's own `remember` tool). A stray closing tag
    would end the block early and let the rest of the body read as
    instructions outside it, which is the whole reason for delimiting in the
    first place.
    """
    return text.replace(f"</{tag}>", f"<\\/{tag}>")


def _skill_block(skill: SkillLike) -> str:
    attrs = f'name="{_escape(skill.name)}"'
    if skill.slug:
        attrs += f' slug="{_escape(skill.slug)}"'

    parts = [f"<skill {attrs}>"]
    if skill.description:
        parts.append(f"<description>{_escape(skill.description)}</description>")
    if skill.content:
        parts.append(_escape(skill.content))
    parts.append("</skill>")
    return "\n".join(parts)


def _memory_block(memory: MemoryLike) -> str:
    attrs = f'kind="{_escape(memory.kind, "memory")}" slug="{_escape(memory.slug, "memory")}"'
    parts = [f"<memory {attrs}>"]
    if memory.title:
        parts.append(f"<title>{_escape(memory.title, 'memory')}</title>")
    if memory.content:
        parts.append(_escape(memory.content, "memory"))
    parts.append("</memory>")
    return "\n".join(parts)


def compose_system_prompt(
    *,
    base: str,
    agent_name: str | None = None,
    agent_prompt: str | None = None,
    skills: Sequence[SkillLike] = (),
    memories: Sequence[MemoryLike] = (),
    no_project_open: bool = False,
    max_chars: int | None = None,
) -> str:
    """Build the system prompt for one turn.

    With no agent, no skills and no memories the result is `base`, byte for
    byte — which is what keeps the un-preset chat path identical to how it
    behaved before presets existed.

    Skills and memories are delimited with XML-ish tags rather than markdown
    headings because their bodies are themselves markdown, full of `#`
    headings. Nesting operator markdown under more markdown makes the boundary
    ambiguous; a tag does not.

    Memories come last, after skills: skills are static, operator-authored
    config, while memories are dynamic and learned -- often from this very
    project's own conversations -- so they read as the most specific, most
    recent layer of instruction.
    """
    sections: list[str] = [base.strip()]

    if no_project_open:
        sections.append(NO_PROJECT_OPEN_BLOCK)

    agent_prompt = (agent_prompt or "").strip()
    if agent_prompt:
        header = f"## Agent: {agent_name.strip()}" if agent_name else "## Agent"
        sections.append(f"{header}\n\n{agent_prompt}")

    usable = [s for s in skills if (s.content or "").strip() or (s.description or "").strip()]
    if usable:
        ordered = sorted(usable, key=lambda s: ((s.slug or s.name).lower(), s.name))
        blocks = "\n".join(_skill_block(skill) for skill in ordered)
        sections.append(f"<skills>\n{blocks}\n</skills>")

    usable_memories = [m for m in memories if (m.content or "").strip()]
    if usable_memories:
        ordered_memories = sorted(usable_memories, key=lambda m: (m.kind, m.slug))
        memory_blocks = "\n".join(_memory_block(memory) for memory in ordered_memories)
        sections.append(f"<memories>\n{memory_blocks}\n</memories>")

    composed = "\n\n".join(sections)

    if max_chars is not None and len(composed) > max_chars:
        composed = composed[: max(0, max_chars - len(TRUNCATION_NOTE))] + TRUNCATION_NOTE

    return composed
