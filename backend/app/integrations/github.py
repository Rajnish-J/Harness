"""A small GitHub REST client.

**This is not a tool.** Nothing here is registered in `ALL_TOOLS` and the model
cannot reach it. `app/agent/tools/git_tools.py` is deliberately non-destructive —
it withholds clone, checkout, push and reset from the LLM — and that boundary
only holds if the destructive operations live somewhere the agent loop cannot
call. This module is that somewhere: every function is invoked from a route
handler, behind a button the operator pressed.

Scope is kept to what the UI actually needs. There is no general-purpose GitHub
wrapper here to grow into one.
"""

import logging
from dataclasses import dataclass, field

import httpx

logger = logging.getLogger(__name__)

API_ROOT = "https://api.github.com"

# GitHub asks for an explicit API version; without it the default drifts.
_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "harness-agent",
}

_TIMEOUT = httpx.Timeout(15.0, connect=10.0)


class GitHubError(Exception):
    """An API call failed in a way worth showing the operator."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


@dataclass
class Repo:
    """One repository, reduced to what the picker and the clone need."""

    id: str
    name: str
    full_name: str
    owner: str
    clone_url: str
    default_branch: str
    private: bool
    description: str | None
    updated_at: str | None


@dataclass
class TokenIdentity:
    """Who a token belongs to, and what it may do."""

    username: str
    #: Classic PATs report scopes in a header. Fine-grained ones report nothing,
    #: so an empty list means "unknown", never "no permissions".
    scopes: list[str] = field(default_factory=list)
    fine_grained: bool = False


def _auth(token: str) -> dict[str, str]:
    return {**_HEADERS, "Authorization": f"Bearer {token}"}


def _explain(response: httpx.Response) -> str:
    """Turn an API failure into a sentence with a next action in it."""
    if response.status_code == 401:
        return "GitHub rejected the token. It may be expired, revoked, or mistyped."
    if response.status_code == 403:
        # 403 is overloaded: rate limiting and missing scopes both land here.
        if response.headers.get("x-ratelimit-remaining") == "0":
            return "GitHub rate limit reached for this token. Try again shortly."
        return (
            "GitHub refused the request. The token is valid but is probably "
            "missing the scope this action needs."
        )
    if response.status_code == 404:
        return (
            "Not found. For a private repository this usually means the token "
            "lacks `repo` scope rather than that the repository is missing."
        )
    try:
        detail = response.json().get("message")
    except Exception:  # noqa: BLE001 - a non-JSON error body is still an error
        detail = None
    return detail or f"GitHub returned {response.status_code}."


async def validate_token(token: str) -> TokenIdentity:
    """Confirm a token works, and report who it belongs to.

    `GET /user` is the cheapest authenticated call GitHub offers, and its
    response headers carry the granted scopes — so one request answers both
    "does this work" and "will it be allowed to do what we need".
    """
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            response = await client.get(f"{API_ROOT}/user", headers=_auth(token))
        except httpx.RequestError as exc:
            raise GitHubError(f"Could not reach GitHub: {exc}") from exc

    if response.status_code != 200:
        raise GitHubError(_explain(response), status=response.status_code)

    body = response.json()
    # Present but empty is the fine-grained-token tell; absent entirely is too.
    raw_scopes = response.headers.get("x-oauth-scopes", "")
    scopes = [scope.strip() for scope in raw_scopes.split(",") if scope.strip()]

    return TokenIdentity(
        username=body.get("login") or "unknown",
        scopes=scopes,
        fine_grained=not scopes,
    )


def _repo(body: dict) -> Repo:
    owner = (body.get("owner") or {}).get("login") or ""
    return Repo(
        # GitHub's id is a number; stored and compared as text everywhere here.
        id=str(body.get("id") or ""),
        name=body.get("name") or "",
        full_name=body.get("full_name") or "",
        owner=owner,
        clone_url=body.get("clone_url") or "",
        default_branch=body.get("default_branch") or "main",
        private=bool(body.get("private")),
        description=body.get("description"),
        updated_at=body.get("updated_at"),
    )


async def list_repos(token: str, *, page: int = 1, per_page: int = 50) -> list[Repo]:
    """One page of repositories the token can see, most recently pushed first.

    Paged rather than exhaustive: an account with 800 repositories would
    otherwise mean sixteen sequential API calls before the picker could render
    anything, and the operator is going to type a filter regardless.

    `affiliation` is set explicitly so repositories reachable only through an
    organisation still appear — the default omits some of them.
    """
    params = {
        "per_page": str(max(1, min(per_page, 100))),
        "page": str(max(1, page)),
        "sort": "pushed",
        "affiliation": "owner,collaborator,organization_member",
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            response = await client.get(
                f"{API_ROOT}/user/repos", headers=_auth(token), params=params
            )
        except httpx.RequestError as exc:
            raise GitHubError(f"Could not reach GitHub: {exc}") from exc

    if response.status_code != 200:
        raise GitHubError(_explain(response), status=response.status_code)

    return [_repo(item) for item in response.json()]


# ---------------------------------------------------------------------------
# Pull requests.
# ---------------------------------------------------------------------------


@dataclass
class PullRequest:
    number: int
    title: str
    state: str
    html_url: str
    head: str
    base: str
    draft: bool
    mergeable_state: str | None = None


def _pull(body: dict) -> PullRequest:
    return PullRequest(
        number=int(body.get("number") or 0),
        title=body.get("title") or "",
        state=body.get("state") or "open",
        html_url=body.get("html_url") or "",
        head=(body.get("head") or {}).get("ref") or "",
        base=(body.get("base") or {}).get("ref") or "",
        draft=bool(body.get("draft")),
        mergeable_state=body.get("mergeable_state"),
    )


async def create_pull_request(
    token: str,
    owner: str,
    repo: str,
    *,
    title: str,
    head: str,
    base: str,
    body: str = "",
    draft: bool = False,
) -> PullRequest:
    """Open a pull request from `head` into `base`."""
    payload = {
        "title": title,
        "head": head,
        "base": base,
        "body": body,
        "draft": draft,
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            response = await client.post(
                f"{API_ROOT}/repos/{owner}/{repo}/pulls",
                headers=_auth(token),
                json=payload,
            )
        except httpx.RequestError as exc:
            raise GitHubError(f"Could not reach GitHub: {exc}") from exc

    if response.status_code == 422:
        # 422 covers several ordinary situations, and the generic "Validation
        # Failed" hides which one. The errors array names it.
        detail = ""
        try:
            errors = response.json().get("errors") or []
            detail = "; ".join(e.get("message", "") for e in errors if e.get("message"))
        except Exception:  # noqa: BLE001
            pass
        if "already exists" in detail.lower():
            raise GitHubError(f"A pull request for {head} is already open.")
        if "no commits between" in detail.lower():
            raise GitHubError(
                f"{head} has no commits that {base} does not. Commit and push first."
            )
        raise GitHubError(detail or "GitHub rejected the pull request.")

    if response.status_code not in (200, 201):
        raise GitHubError(_explain(response), status=response.status_code)

    return _pull(response.json())


async def list_pull_requests(
    token: str, owner: str, repo: str, *, head_branch: str | None = None
) -> list[PullRequest]:
    """Open pull requests, optionally only those from one branch."""
    params = {"state": "open", "per_page": "50"}
    if head_branch:
        # GitHub wants owner-qualified head refs here.
        params["head"] = f"{owner}:{head_branch}"

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            response = await client.get(
                f"{API_ROOT}/repos/{owner}/{repo}/pulls",
                headers=_auth(token),
                params=params,
            )
        except httpx.RequestError as exc:
            raise GitHubError(f"Could not reach GitHub: {exc}") from exc

    if response.status_code != 200:
        raise GitHubError(_explain(response), status=response.status_code)

    return [_pull(item) for item in response.json()]


async def merge_pull_request(
    token: str,
    owner: str,
    repo: str,
    number: int,
    *,
    method: str = "merge",
    commit_title: str | None = None,
) -> str:
    """Merge a pull request. Returns the resulting commit sha."""
    if method not in {"merge", "squash", "rebase"}:
        raise GitHubError(f"Unknown merge method {method!r}.")

    payload: dict[str, object] = {"merge_method": method}
    if commit_title:
        payload["commit_title"] = commit_title

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            response = await client.put(
                f"{API_ROOT}/repos/{owner}/{repo}/pulls/{number}/merge",
                headers=_auth(token),
                json=payload,
            )
        except httpx.RequestError as exc:
            raise GitHubError(f"Could not reach GitHub: {exc}") from exc

    if response.status_code == 405:
        raise GitHubError(
            "GitHub refused the merge. The pull request is probably blocked by "
            "a required review or a failing check."
        )
    if response.status_code == 409:
        raise GitHubError(
            "The head branch moved since the merge was requested, or the branch "
            "has conflicts that must be resolved on GitHub."
        )
    if response.status_code != 200:
        raise GitHubError(_explain(response), status=response.status_code)

    return response.json().get("sha") or ""
