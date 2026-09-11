"""Choosing tools from rows instead of from a model.

The router explains every tool to an LLM on each message -- ~2,900 billed
tokens with a couple of MCP servers connected, spent before the answer starts.
Matching the same message against `tool_index` rows costs nothing billable.

What these pin is the trade that makes that safe: the index answers only when
the evidence is strong, and returns None -- "ask the model" -- whenever it is
not. So the accuracy floor stays the LLM router's, and the saving comes from
the easy majority of messages rather than from guessing at the hard ones.
"""

import pytest

from app.agent.tools.intent import select_from_index, terms_in
from app.db.tool_index_repo import ToolIndexRow, keywords_for


def mcp_row(server: str, raw: str, description: str) -> ToolIndexRow:
    name = f"mcp__{server}__{raw}"
    return ToolIndexRow(
        raw_name=raw,
        tool_name=name,
        description=description,
        group=f"MCP · {server}",
        keywords=keywords_for(name, description, [server]),
        server_id=f"id-{server}",
    )


def builtin(name: str, description: str, group: str = "File Operations") -> ToolIndexRow:
    return ToolIndexRow(
        raw_name=name,
        tool_name=name,
        description=description,
        group=group,
        keywords=keywords_for(name, description),
        server_id=None,
    )


ROWS = [
    mcp_row("github", "search_repositories", "[github] Search for repositories."),
    mcp_row("github", "list_commits", "[github] List commits on a branch."),
    builtin("read_file", "Read a UTF-8 text file from the workspace."),
    builtin("write_file", "Write text to a file in the workspace."),
    builtin("git_commit", "Create a git commit with a message.", "Version Control"),
    builtin("run_tests", "Run the project test suite.", "Execution"),
]

REACHABLE = {row.tool_name for row in ROWS}


def pick(message: str, *, reachable=None, candidates=None, rows=None):
    return select_from_index(
        message,
        rows if rows is not None else ROWS,
        reachable_names=REACHABLE if reachable is None else reachable,
        candidate_names=candidates or set(),
        max_tools=12,
    )


# ------------------------------------------------------- the confident cases


def test_naming_a_server_selects_that_server_s_tools():
    """The exact message from the bug report, answered for zero tokens."""
    picked = pick("hey can you tell what all are the github repo I have")
    assert picked is not None
    assert "mcp__github__search_repositories" in picked.names
    # And nothing from an unrelated domain.
    assert "run_tests" not in picked.names


def test_a_conversational_message_needs_no_tools():
    """Today "thanks" costs a full round trip to be told "no tools needed"."""
    picked = pick("thanks, that worked")
    assert picked is not None
    assert picked.names == set()


def test_naming_a_tool_outright_selects_it():
    picked = pick("use read_file on the config")
    assert picked is not None
    assert "read_file" in picked.names


# --------------------------------------------------- deferring to the model


def test_a_vague_request_defers_to_the_router():
    """None is the safety valve: an unreadable message costs what it costs
    today, rather than being answered with a guess."""
    assert pick("make the thing better somehow") is None


def test_an_unmatched_but_actionable_message_defers():
    """No keyword hit, but the message clearly asks for work. Answering with
    the core floor would strand a turn that needed a tool it never saw."""
    assert pick("deploy the release") is None


def test_an_empty_message_defers():
    assert pick("   ") is None


def test_a_single_weak_keyword_brush_is_not_enough():
    """One shared word with a description matches half the registry, and would
    pick a toolset by coincidence."""
    rows = [builtin("read_file", "Read a UTF-8 text file from the workspace.")]
    assert pick("workspace", rows=rows, reachable={"read_file"}) is None


# ------------------------------------------------------------ consent, kept


def test_an_unattached_server_parks_instead_of_selecting():
    """A candidate tool must never become executable. Naming one asks the user
    for permission -- the same contract the LLM path has."""
    picked = pick(
        "what github repos do I have",
        reachable=set(),
        candidates={"mcp__github__search_repositories", "mcp__github__list_commits"},
    )
    assert picked is not None
    assert picked.names == set()
    assert picked.needs_servers == ["github"]


def test_a_reachable_server_does_not_park():
    picked = pick("what github repos do I have")
    assert picked is not None
    assert picked.needs_servers == []


# ------------------------------------------------------------- shrink only


def test_selection_never_invents_a_tool_outside_the_pool():
    """The router may only ever shrink what it was given. An index row for a
    tool this turn cannot reach must not be selected."""
    picked = pick("what github repos do I have", reachable={"read_file"})
    if picked is not None:
        assert picked.names <= {"read_file"}


def test_respects_the_max_tools_cap():
    rows = [
        builtin(f"tool_{i}", "Search files in the workspace for text.")
        for i in range(40)
    ]
    picked = select_from_index(
        "search files for text",
        rows,
        reachable_names={row.tool_name for row in rows},
        candidate_names=set(),
        max_tools=5,
    )
    assert picked is not None
    assert len(picked.names) <= 5


# ------------------------------------------------------------------- units


def test_keywords_come_from_the_name_and_description():
    words = keywords_for(
        "mcp__github__search_repositories",
        "[github] Search for repositories.",
        ["github"],
    )
    assert "github" in words
    assert "search" in words
    assert "repositories" in words
    # "mcp" is on every namespaced tool, so it separates nothing.
    assert "mcp" not in words


@pytest.mark.parametrize("stopword", ["the", "and", "from", "with"])
def test_stopwords_are_dropped(stopword):
    assert stopword not in keywords_for("x", f"Read {stopword} file.")


def test_terms_ignore_punctuation_and_case():
    assert "github" in terms_in("What GitHub repos, exactly?")


# ------------------------------------------- real phrasings, real registry
#
# Cases measured against the live index during development. Each one is here
# because it was wrong at some point: the scoring below is tuned to them, and
# a change that breaks one is a regression in the thing users actually type.

REAL_ROWS = [
    builtin("read_file", "Read a UTF-8 text file from the workspace."),
    builtin("write_file", "Write text to a file in the workspace."),
    builtin("edit_file", "Replace an exact substring within a file."),
    builtin("make_directory", "Create a directory, including missing parents."),
    builtin("git_commit", "Commit whatever is currently staged.", "Version Control"),
    builtin("git_stash", "Shelve or restore uncommitted changes.", "Version Control"),
    builtin("git_diff", "Show what changed in the working tree.", "Version Control"),
    builtin("run_tests", "Run the project test suite.", "Execution"),
    builtin("search_files", "Search the workspace for text.", "Validation"),
]
REAL_REACHABLE = {row.tool_name for row in REAL_ROWS}


def real(message: str):
    return select_from_index(
        message,
        REAL_ROWS,
        reachable_names=REAL_REACHABLE,
        candidate_names=set(),
        max_tools=12,
    )


def test_commit_reaches_git_commit_not_git_stash():
    """Both mention "changes"; only one is named for what was asked.

    git_stash won this on description keywords before tool names were
    weighted above prose.
    """
    picked = real("commit these changes with a message")
    assert picked is not None
    assert "git_commit" in picked.names
    assert "git_stash" not in picked.names


def test_a_generic_verb_alone_defers():
    """"make it nicer" brushes make_directory on "make" and means nothing of
    the sort. A lone generic verb is a coincidence, not a selection."""
    assert real("make it nicer") is None


def test_a_domain_verb_alone_is_enough():
    """The counterpart: "commit" is a domain term, so one hit is real evidence.
    This is the distinction _WEAK_NAME_WORDS draws, and the pair of tests is
    what stops it being tuned away."""
    assert real("commit these changes with a message") is not None


@pytest.mark.parametrize(
    "message,expected",
    [
        ("run the tests", "run_tests"),
        ("search the codebase for the retry logic", "search_files"),
        ("show me the git diff", "git_diff"),
    ],
)
def test_ordinary_requests_find_their_tool(message, expected):
    picked = real(message)
    assert picked is not None, message
    assert expected in picked.names
