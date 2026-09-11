"""Pick tools from the index instead of asking a model to.

The router narrows a turn's toolset by describing every tool to an LLM and
reading back a list. That is worth doing -- the schemas it avoids sending cost
several times what the catalog costs -- but the catalog itself is still ~2,900
billed tokens on every single message, spent before the answer starts.

Most messages do not need a model to route them. "what github repos do I have"
names its domain outright; "thanks" needs no tools at all. This module answers
those from `tool_index` rows, which costs nothing billable: the comparison
happens in Python and the rows never enter a prompt.

It is deliberately conservative. `select_from_index` returns None whenever the
evidence is thin, and None means "ask the model" -- so the accuracy floor is
the LLM router's, not this module's. The savings come from the easy majority,
never from guessing at the hard ones.

Nothing here calls an LLM, touches the network, or raises: it is a pure
function over rows the caller already has.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.db.tool_index_repo import ToolIndexRow

#: A term must clear this to count. Mirrors the indexer's own floor, so a word
#: that was never worth storing is never worth matching either.
_MIN_TERM_LEN = 3

_WORD_RE = re.compile(r"[^a-z0-9]+")

#: Verbs and nouns that mean "do something to the workspace". Their absence is
#: most of what makes a message conversational.
#:
#: Only used to decide whether a NO-MATCH message is safe to answer with the
#: core floor, never to pick a tool -- so a missing word here costs a fallback
#: to the LLM router, not a wrong toolset.
_ACTION_WORDS = frozenset(
    """
    add analyse analyze branch build bug change check clean commit compile
    convert create debug delete deploy diff document edit execute explain
    export find fix format generate implement import inspect install lint list
    log look make merge migrate move open patch print pull push read refactor
    remove rename repo repos repository run search set show start stash status
    stop test update upgrade verify write
    """.split()
)

#: Words that appear in tool names but carry almost no intent on their own.
#:
#: "make it nicer" brushes make_directory on "make" and means nothing of
#: the sort; "commit these changes" brushes git_commit on "commit" and
#: means exactly that. The difference is not the score -- both are a single
#: name word -- it is that "make" is a generic English verb and "commit" is
#: a domain term. A lone hit on one of these defers to the model; a lone
#: hit on any other word is taken as real evidence.
_WEAK_NAME_WORDS = frozenset(
    """
    make get set new add put run use list show find open call
    """.split()
)

#: How far below the best score a tool can be and still be taken. A single
#: dominant hit should not drag in every distant relative.
_SCORE_RATIO = 0.5


@dataclass(frozen=True)
class IndexSelection:
    """A confident answer from the index. `None` is returned instead when unsure."""

    #: Tool names to advertise, before the caller adds the core floor.
    names: set[str] = field(default_factory=set)
    #: MCP servers named by the request that this turn cannot reach. Parks the
    #: turn on a consent card, exactly as the LLM path does.
    needs_servers: list[str] = field(default_factory=list)
    #: Shown in the transcript, in place of the router's sentence.
    reason: str = ""


def terms_in(message: str) -> set[str]:
    """The words worth matching on, from a user's message."""
    return {
        word
        for word in _WORD_RE.split(message.lower())
        if len(word) >= _MIN_TERM_LEN
    }


def _server_of(row: ToolIndexRow) -> str:
    """The MCP server a row belongs to, or "" for a harness built-in.

    Read off the namespaced name rather than the group label: the name is what
    the model calls and what `namespaced` in app/mcp/tools.py builds, so it
    stays correct even if group formatting changes.
    """
    if row.server_id is None or not row.tool_name.startswith("mcp__"):
        return ""
    parts = row.tool_name.split("__")
    return parts[1] if len(parts) >= 3 else ""


def _score(row: ToolIndexRow, terms: set[str]) -> int:
    """How well one indexed tool answers a message.

    Three signals, weighted by how much each one actually tells us:

    - the tool named outright ("call read_file") is as certain as it gets;
    - its server named ("github", "notion") is nearly as good, because a user
      who names a server is asking for that server;
    - shared keywords are ordinary evidence, and are counted rather than
      capped so a tool matching three terms outranks one matching a single
      term.
    """
    score = 0

    if row.tool_name.lower() in terms or row.raw_name.lower() in terms:
        score += 10

    server = _server_of(row)
    if server and server.lower() in terms:
        score += 6

    # A tool's OWN name outweighs its prose. "commit these changes" should
    # reach git_commit, not git_stash -- both talk about changes, but only
    # one is named for the thing being asked for.
    name_words = {
        word
        for word in _WORD_RE.split(row.raw_name.lower())
        if len(word) >= _MIN_TERM_LEN
    }
    matched_name = name_words & terms
    score += 3 * len(matched_name)

    # Keywords derived from the name are already counted above. Scoring
    # them again would turn one coincidental word ("make" against
    # make_directory) into what looks like two independent signals.
    score += sum(
        1
        for keyword in row.keywords
        if keyword in terms and keyword not in matched_name
    )
    return score


def select_from_index(
    user_message: str,
    rows: list[ToolIndexRow],
    *,
    reachable_names: set[str],
    candidate_names: set[str],
    max_tools: int,
) -> IndexSelection | None:
    """Choose this turn's tools from the index, or None to ask the model.

    `reachable_names` is what the turn can actually run; `candidate_names` are
    tools from registered-but-unattached MCP servers, which must never be
    advertised -- naming one asks the user for permission instead. Rows outside
    both are ignored: the index is global, a turn's pool is not, and the
    selection may only ever shrink what it was given.

    Returns None on thin evidence, which is the whole safety story here. The
    caller reads None as "fall through to the LLM router", so a message this
    module cannot read confidently costs exactly what it costs today.
    """
    terms = terms_in(user_message)
    if not terms:
        return None

    scored = [(row, _score(row, terms)) for row in rows]
    hits = [(row, score) for row, score in scored if score > 0]

    if not hits:
        # Nothing matched at all. That is only safe to act on when the message
        # also asks for nothing -- "thanks", "that worked". A message with real
        # verbs in it that simply missed the index is exactly the case the LLM
        # router is better at, so hand it over.
        if terms & _ACTION_WORDS:
            return None
        return IndexSelection(
            names=set(), reason="Conversational; no tools needed."
        )

    # A named-but-unreachable server is a consent question, not a selection.
    # Checked before the score cut so a single strong candidate hit still
    # parks the turn rather than being trimmed away and silently ignored.
    needs: list[str] = []
    for row, score in hits:
        if row.tool_name in candidate_names and score >= 6:
            server = _server_of(row)
            if server and server not in needs:
                needs.append(server)
    if needs:
        return IndexSelection(
            names=set(),
            needs_servers=needs,
            reason=f"The request names the {', '.join(needs)} server.",
        )

    usable = [(row, score) for row, score in hits if row.tool_name in reachable_names]
    if not usable:
        return None

    best = max(score for _, score in usable)

    # One shared word with a tool NAME is not confidence -- it is a
    # coincidence. "make it nicer" brushes make_directory on "make" and
    # nothing else; picking a toolset from that is worse than paying for
    # the model, which can read the sentence. Demand either corroboration
    # (a second matching tool) or a decisive hit (an exact tool or server
    # name, which score 10 and 6).
    decisive = best >= 6
    corroborated = sum(1 for _, score in usable if score >= best) > 1
    if not decisive and not corroborated and best <= 3:
        # The single hit is only worth acting on if the word that produced
        # it actually names a domain.
        top = max(usable, key=lambda pair: pair[1])[0]
        top_words = {
            word
            for word in _WORD_RE.split(top.raw_name.lower())
            if len(word) >= _MIN_TERM_LEN
        }
        if not (top_words & terms) - _WEAK_NAME_WORDS:
            return None
    # A bare keyword brush is not enough on its own: one shared word with a
    # description ("file", "list") matches half the registry and would pick a
    # toolset by coincidence. Two terms, or one strong name/server hit.
    if best < 2:
        return None

    cutoff = max(2, best * _SCORE_RATIO)
    kept = sorted(
        (row for row, score in usable if score >= cutoff),
        key=lambda row: -_score(row, terms),
    )[:max_tools]

    servers = sorted({_server_of(row) for row in kept} - {""})
    if servers:
        reason = f"Matched the {', '.join(servers)} server's tools."
    else:
        reason = "Matched on what the request asks for."

    return IndexSelection(names={row.tool_name for row in kept}, reason=reason)
