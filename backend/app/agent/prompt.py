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
    """Structural type so this module does not import app.db.memory_repo.

    `scoped_session_id` is read with getattr rather than declared here: a
    workflow node composes prompts from its own row shape, and requiring a new
    attribute would break every such caller for a marker they cannot set.
    """

    kind: str
    slug: str
    title: str
    content: str


TRUNCATION_NOTE = "\n[skill content truncated]"

#: Appended when no project is open (the global chat) and propose_create_project
#: is on offer. A two-state boolean rather than per-request text, so it stays as
#: cacheable-prefix-friendly as the rest of this module.
NO_PROJECT_OPEN_BLOCK = """## No project is open right now
This is the global chat: there is no project associated with this conversation yet. If the user describes a new idea or project they want to build, call propose_create_project(name, description, template) to suggest starting one, instead of building it directly in this general-purpose scratch workspace.

When you propose one, say plainly what it means: the work is saved as its own project with its own git repository and editor container, they can connect it to GitHub afterwards, and they push their changes when the work is done. Pick the scaffold that best fits what they described.

It creates nothing by itself -- a human must approve it in the UI, and they can change the scaffold before they do -- so call it once per idea and then wait; do not call it again unless they describe a different idea, and do not retry it if they decline.

If instead the work continues a project that already exists, call list_projects to see them, then propose_attach_project(target_project_id, reason) with an id copied from that list, to offer filing this conversation under it. Never invent an id. Prefer this over propose_create_project whenever an existing project already covers the work -- a second project for the same thing is worse than no project. It moves nothing by itself either; the same confirm-then-wait rule applies."""


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
    # Only the narrowest tier is marked. The other two are the default and
    # would spend tokens saying so on every row; "this one is just for this
    # conversation" is the part the model cannot infer and might act on.
    if getattr(memory, "scoped_session_id", None):
        attrs += ' scope="conversation"'
    parts = [f"<memory {attrs}>"]
    if memory.title:
        parts.append(f"<title>{_escape(memory.title, 'memory')}</title>")
    if memory.content:
        parts.append(_escape(memory.content, "memory"))
    parts.append("</memory>")
    return "\n".join(parts)


#: Appended when a project IS open. Gated on its own flag rather than on
#: `not no_project_open`: that default also covers callers with no project
#: concept at all -- workflow nodes, the memory preview -- and they must keep
#: composing to the base prompt byte for byte.
#:
#: The mirror of NO_PROJECT_OPEN_BLOCK, and a
#: two-state boolean for the same cacheable-prefix reason: the sibling chat ids
#: belong in the tool's own output, never interpolated into the prompt.
PROJECT_OPEN_BLOCK = """## Other conversations in this project
A project can hold several chats, each with its own history. If the user refers to work you have no record of, or this conversation plainly lacks context that another one would have, call list_project_chats to see what else is here and read_project_chat to open one. Prefer that over asking the user to repeat themselves."""


#: Appended when at least one MCP server is attached to the turn, naming the
#: servers whose tools are in the request.
#:
#: This is the one block in this file that interpolates per-request text rather
#: than being a two-state boolean, and it breaks the discipline the module
#: docstring describes on purpose. The fact that has to reach the model is
#: *which* servers are attached: without it, a model handed thirty tools named
#: `mcp__github__*` has nothing saying they are already authenticated, and asks
#: the user for a username and a token instead of calling one. That was the
#: actual observed failure. The cost is bounded -- the block lands after the
#: base prompt, so the longest shared prefix in the deployment is untouched, and
#: the text is stable for a given set of attached servers.
def _mcp_block(server_names: Sequence[str]) -> str:
    listed = ", ".join(f"`{name}`" for name in server_names)
    many = len(server_names) > 1
    plural = "servers" if many else "server"
    these = "these servers" if many else "this server"
    s = "" if many else "s"
    return f"""## Connected MCP {plural}: {listed}
Tools named `mcp__<server>__<tool>` come from {these}. **They are already authenticated as the user.** The operator configured the credentials in this harness, and every call you make through them acts as the user's own account.

So never ask the user for a username, account name, email, API key, token, or password for {these} -- you already have access, and asking makes it look as though you do not. If a call needs to know who the user is, call that server's own identity tool (`get_me`, `whoami`, `get_authenticated_user`, or whatever it is named here) and read the answer from the result.

When a question is about a service {these} cover{s}, call its tool rather than guessing, answering from memory, or reaching for a generic web fetch. If a call fails, say what failed and what the error was -- do not fall back to asking the user for credentials."""


def compose_system_prompt(
    *,
    base: str,
    agent_name: str | None = None,
    agent_prompt: str | None = None,
    skills: Sequence[SkillLike] = (),
    memories: Sequence[MemoryLike] = (),
    no_project_open: bool = False,
    project_open: bool = False,
    mcp_servers: Sequence[str] = (),
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

    `mcp_servers` names the MCP servers whose tools are in this turn's request.
    It sits with the project block, among the environment facts, rather than
    with the operator config below it. An empty sequence appends nothing, so
    every caller with no MCP concept -- workflow nodes, the memory preview --
    keeps composing to `base` byte for byte.

    Memories come last, after skills: skills are static, operator-authored
    config, while memories are dynamic and learned -- often from this very
    project's own conversations -- so they read as the most specific, most
    recent layer of instruction.
    """
    sections: list[str] = [base.strip()]

    if no_project_open:
        sections.append(NO_PROJECT_OPEN_BLOCK)
    elif project_open:
        sections.append(PROJECT_OPEN_BLOCK)

    # Sorted and deduped for the same reason skills are: attaching A-then-B and
    # B-then-A must produce identical bytes.
    attached = sorted({name.strip() for name in mcp_servers if name and name.strip()})
    if attached:
        sections.append(_mcp_block(attached))

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
        # One block, not two. A second <memories-for-this-conversation> section
        # would turn one total order into two lists, so a chat's first
        # conversation memory would insert a whole new section rather than a
        # row; with a per-entry marker the ordering stays deterministic and two
        # chats holding the same memories compose identical bytes.
        #
        # Conversation rows sort last -- narrowest scope nearest the message.
        # This does mean two chats in one project no longer share a byte
        # identical system prompt once either has a conversation memory. That
        # is the unavoidable cost of the tier; the prefix up to <memories> is
        # untouched, and memories were already the final section.
        ordered_memories = sorted(
            usable_memories,
            key=lambda m: (bool(getattr(m, "scoped_session_id", None)), m.kind, m.slug),
        )
        memory_blocks = "\n".join(_memory_block(memory) for memory in ordered_memories)
        sections.append(f"<memories>\n{memory_blocks}\n</memories>")

    composed = "\n\n".join(sections)

    if max_chars is not None and len(composed) > max_chars:
        composed = composed[: max(0, max_chars - len(TRUNCATION_NOTE))] + TRUNCATION_NOTE

    return composed
