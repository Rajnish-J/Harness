"""`fetch_url` and `web_search`: reading documentation from inside a turn.

Both are gated on WEB_TOOLS_ENABLED and stay registered when it is off. That is
deliberate: the tool list is part of the prompt, so a flag that added and
removed tools would change the cached prefix every time an operator flipped it.
A disabled tool refuses when called, naming the setting.
"""

from __future__ import annotations

import json

import httpx

from app.agent.tools.base import Tool, ToolExecutionError
from app.agent.tools.web._fetch import USER_AGENT, assert_enabled, fetch
from app.agent.tools.web._html import html_to_text

WEB_GROUP = "Web"

#: Documented JSON endpoints, not HTML scraping. See web_search below.
_SEARCH_ENDPOINTS = {
    "brave": "https://api.search.brave.com/res/v1/web/search",
    "tavily": "https://api.tavily.com/search",
}


async def fetch_url(
    url: str,
    max_chars: int = 20000,
    *,
    web_tools_enabled: bool = False,
    web_timeout_seconds: float = 15.0,
    web_max_response_bytes: int = 2_000_000,
    web_allowed_domains: list[str] | None = None,
    **_ignored: object,
) -> str:
    assert_enabled(web_tools_enabled)

    if not isinstance(url, str) or not url.strip():
        raise ToolExecutionError("url must be a non-empty http(s) URL.")

    page = await fetch(
        url.strip(),
        timeout_seconds=web_timeout_seconds,
        max_response_bytes=web_max_response_bytes,
        allowed_domains=web_allowed_domains,
    )

    # An HTTP error is a result the model should read and react to, the same way
    # run_command treats a non-zero exit code.
    if page.status >= 400:
        return (
            f"{page.url}\nHTTP {page.status}. The server returned an error; the "
            "body below may explain it.\n\n" + page.body[:2000]
        )

    lowered = page.content_type.lower()
    if "json" in lowered:
        try:
            rendered = json.dumps(json.loads(page.body), indent=2)
        except json.JSONDecodeError:
            rendered = page.body
        title = ""
    elif "html" in lowered or page.body.lstrip()[:1] == "<":
        title, rendered = html_to_text(page.body)
    else:
        title, rendered = "", page.body

    capped = max(500, int(max_chars))
    shown = rendered[:capped]
    notes = []
    if page.truncated:
        notes.append(f"response capped at {web_max_response_bytes} bytes")
    if len(rendered) > capped:
        notes.append(f"showing {capped} of {len(rendered)} characters")

    header = f"# {title}\n{page.url}" if title else page.url
    suffix = f"\n({'; '.join(notes)})" if notes else ""
    return f"{header}{suffix}\n\n{shown}"


def _render_brave(payload: dict, max_results: int) -> list[str]:
    results = (payload.get("web") or {}).get("results") or []
    return [
        f"{index}. {item.get('title', '(untitled)')}\n   {item.get('url', '')}\n"
        f"   {item.get('description', '').strip()}"
        for index, item in enumerate(results[:max_results], start=1)
    ]


def _render_tavily(payload: dict, max_results: int) -> list[str]:
    results = payload.get("results") or []
    return [
        f"{index}. {item.get('title', '(untitled)')}\n   {item.get('url', '')}\n"
        f"   {(item.get('content') or '').strip()[:300]}"
        for index, item in enumerate(results[:max_results], start=1)
    ]


async def web_search(
    query: str,
    max_results: int = 5,
    *,
    web_tools_enabled: bool = False,
    web_timeout_seconds: float = 15.0,
    web_search_provider: str = "none",
    web_search_api_key: str | None = None,
    **_ignored: object,
) -> str:
    assert_enabled(web_tools_enabled)

    if not isinstance(query, str) or not query.strip():
        raise ToolExecutionError("query must be a non-empty string.")

    # No provider means no search. Scraping a search engine's result HTML would
    # be brittle, against its terms, and would rot silently the next time the
    # markup changed -- so this refuses in the same "say so rather than guess"
    # spirit as the configured-command tools.
    if web_search_provider not in _SEARCH_ENDPOINTS or not web_search_api_key:
        raise ToolExecutionError(
            "No web search provider is configured. Set WEB_SEARCH_PROVIDER "
            f"(one of: {', '.join(_SEARCH_ENDPOINTS)}) and WEB_SEARCH_API_KEY in "
            "backend/.env, or use fetch_url with a URL you already know. "
            "Do not retry until they are set."
        )

    capped = max(1, min(int(max_results), 10))
    endpoint = _SEARCH_ENDPOINTS[web_search_provider]
    timeout = httpx.Timeout(web_timeout_seconds, connect=5.0)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if web_search_provider == "brave":
                response = await client.get(
                    endpoint,
                    params={"q": query.strip(), "count": capped},
                    headers={
                        "X-Subscription-Token": web_search_api_key,
                        "Accept": "application/json",
                        "User-Agent": USER_AGENT,
                    },
                )
            else:
                response = await client.post(
                    endpoint,
                    json={
                        "api_key": web_search_api_key,
                        "query": query.strip(),
                        "max_results": capped,
                    },
                    headers={"User-Agent": USER_AGENT},
                )
    except httpx.HTTPError as exc:
        raise ToolExecutionError(f"Search request failed: {exc}") from exc

    if response.status_code >= 400:
        raise ToolExecutionError(
            f"{web_search_provider} returned HTTP {response.status_code}. "
            "The API key may be wrong or out of quota."
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise ToolExecutionError(f"{web_search_provider} returned invalid JSON: {exc}") from exc

    rendered = (
        _render_brave(payload, capped)
        if web_search_provider == "brave"
        else _render_tavily(payload, capped)
    )
    if not rendered:
        return f"No results for {query!r}."

    return "\n".join(
        [f"Results for {query!r} via {web_search_provider}:", "", *rendered, "",
         "Use fetch_url to read any of these pages."]
    )


WEB_TOOLS: list[Tool] = [
    Tool(
        name="fetch_url",
        description=(
            "Fetch a web page or JSON document and return it as readable text. "
            "Use it to read documentation, a changelog, an RFC, or an API "
            "response for a library you are working with. HTML is reduced to "
            "text with headings, lists and code blocks preserved. Only public "
            "http/https hosts are reachable: private, loopback and cloud "
            "metadata addresses are refused. Requires the operator to have "
            "enabled web access; if it is off, the tool says so and you should "
            "carry on without it."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "The http(s) URL to fetch."},
                "max_chars": {
                    "type": "integer",
                    "description": "Truncate the extracted text to this many characters. Defaults to 20000.",
                },
            },
            "required": ["url"],
            "additionalProperties": False,
        },
        run=fetch_url,
        group=WEB_GROUP,
    ),
    Tool(
        name="web_search",
        description=(
            "Search the web and return titles, URLs and snippets, which you can "
            "then read with fetch_url. Requires both web access and a search "
            "provider API key to be configured; without them it says so rather "
            "than guessing. Prefer fetch_url when you already know the URL."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What to search for."},
                "max_results": {
                    "type": "integer",
                    "description": "How many results to return, 1-10. Defaults to 5.",
                },
            },
            "required": ["query"],
            "additionalProperties": False,
        },
        run=web_search,
        group=WEB_GROUP,
    ),
]
