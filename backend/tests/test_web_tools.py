"""The web tools, and above all the guard in front of them.

No test here touches the network. The address checks are pure functions over a
resolver that gets monkeypatched, and the request paths use httpx.MockTransport.
A test that reached a real host would be slow, flaky, and would prove less --
the interesting cases are the ones a real host would never produce on demand,
like a public name that resolves to loopback.
"""

import socket

import httpx
import pytest

from app.agent.llm.base import ToolCallRequest
from app.agent.loop import _dispatch_tool
from app.agent.tools.base import ToolExecutionError
from app.agent.tools.registry import ALL_TOOLS
from app.agent.tools.web import _fetch
from app.agent.tools.web._fetch import assert_public_host, fetch, validate_url
from app.agent.tools.web._html import html_to_text
from app.core.config import get_settings

TOOLS_BY_NAME = {tool.name: tool for tool in ALL_TOOLS}


@pytest.fixture
def settings(tmp_path):
    return get_settings().model_copy(update={"workspace_root": tmp_path})


@pytest.fixture
def web_settings(tmp_path):
    return get_settings().model_copy(
        update={"workspace_root": tmp_path, "web_tools_enabled": True}
    )


async def dispatch(name, arguments, settings):
    return await _dispatch_tool(
        ToolCallRequest(id="c1", name=name, arguments=arguments), settings, TOOLS_BY_NAME
    )


def fake_resolver(address: str):
    """A getaddrinfo that always answers with one chosen address."""
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    return lambda host, port, *a, **kw: [(family, socket.SOCK_STREAM, 6, "", (address, 0))]


# ------------------------------------------------------------ the master switch


async def test_disabled_by_default(settings):
    """The default must be off; this asserts the shipped configuration."""
    result = await dispatch("fetch_url", {"url": "https://example.com"}, settings)

    assert result.is_error
    assert "WEB_TOOLS_ENABLED" in result.content


async def test_search_is_disabled_by_default(settings):
    result = await dispatch("web_search", {"query": "anything"}, settings)

    assert result.is_error
    assert "WEB_TOOLS_ENABLED" in result.content


async def test_web_tools_stay_registered_when_disabled():
    """Registration must not depend on the flag, or flipping it would move
    every tool after it and invalidate the cached prompt prefix."""
    assert "fetch_url" in TOOLS_BY_NAME
    assert "web_search" in TOOLS_BY_NAME


# ------------------------------------------------------------------ the schemes


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://example.com/x", "gopher://a/1"])
async def test_non_http_schemes_are_refused(web_settings, url):
    result = await dispatch("fetch_url", {"url": url}, web_settings)

    assert result.is_error
    assert "http and https" in result.content


# ------------------------------------------------------------- the address guard


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://10.0.0.1/",
        "http://192.168.1.1/",
        "http://172.16.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "http://0.0.0.0/",
        "http://localhost:8000/",
        "http://service.internal/",
    ],
)
async def test_private_and_local_addresses_are_refused(web_settings, url):
    result = await dispatch("fetch_url", {"url": url}, web_settings)

    assert result.is_error
    assert "Refusing to fetch" in result.content


def test_the_metadata_address_is_named_in_the_message():
    """A generic refusal teaches nothing; naming it explains the rule."""
    with pytest.raises(ToolExecutionError) as excinfo:
        validate_url("http://169.254.169.254/", None)

    assert "metadata" in str(excinfo.value)


def test_a_public_name_resolving_to_loopback_is_still_refused(monkeypatch):
    """The check is on resolved addresses, not the hostname string -- otherwise
    any DNS record pointing at 127.0.0.1 walks straight through."""
    monkeypatch.setattr(socket, "getaddrinfo", fake_resolver("127.0.0.1"))

    with pytest.raises(ToolExecutionError) as excinfo:
        assert_public_host("totally-public-looking.com")

    assert "loopback" in str(excinfo.value)


def test_every_resolved_address_is_checked(monkeypatch):
    """One public answer must not license a name that also answers private."""
    def both(host, port, *args, **kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", 0)),
        ]

    monkeypatch.setattr(socket, "getaddrinfo", both)

    with pytest.raises(ToolExecutionError):
        assert_public_host("mixed.example.com")


def test_a_public_address_passes(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_resolver("93.184.216.34"))

    assert_public_host("example.com")


def test_an_unresolvable_host_fails_clearly(monkeypatch):
    def boom(*args, **kwargs):
        raise socket.gaierror("no such host")

    monkeypatch.setattr(socket, "getaddrinfo", boom)

    with pytest.raises(ToolExecutionError) as excinfo:
        assert_public_host("nope.example")

    assert "Could not resolve" in str(excinfo.value)


# ------------------------------------------------------------ the domain allowlist


def test_allowlist_permits_a_subdomain(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_resolver("93.184.216.34"))

    validate_url("https://docs.example.com/guide", ["example.com"])


def test_allowlist_blocks_everything_else(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_resolver("93.184.216.34"))

    with pytest.raises(ToolExecutionError) as excinfo:
        validate_url("https://other.com/", ["example.com"])

    assert "WEB_ALLOWED_DOMAINS" in str(excinfo.value)


def test_allowlist_is_not_fooled_by_a_suffix(monkeypatch):
    """notexample.com must not pass an allowlist naming example.com."""
    monkeypatch.setattr(socket, "getaddrinfo", fake_resolver("93.184.216.34"))

    with pytest.raises(ToolExecutionError):
        validate_url("https://notexample.com/", ["example.com"])


# -------------------------------------------------------------- redirects, caps


async def test_a_redirect_to_loopback_is_refused(monkeypatch):
    """The classic SSRF bypass: a public URL that 302s somewhere private."""
    monkeypatch.setattr(socket, "getaddrinfo", fake_resolver("93.184.216.34"))

    def handler(request):
        return httpx.Response(302, headers={"location": "http://127.0.0.1/secrets"})

    with pytest.raises(ToolExecutionError) as excinfo:
        await fetch(
            "https://example.com/",
            timeout_seconds=5,
            max_response_bytes=1000,
            transport=httpx.MockTransport(handler),
        )

    assert "Refusing to fetch" in str(excinfo.value)


async def test_a_redirect_to_a_public_host_is_followed(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_resolver("93.184.216.34"))

    def handler(request):
        if request.url.path == "/start":
            return httpx.Response(302, headers={"location": "https://example.com/end"})
        return httpx.Response(200, text="arrived", headers={"content-type": "text/plain"})

    page = await fetch(
        "https://example.com/start",
        timeout_seconds=5,
        max_response_bytes=1000,
        transport=httpx.MockTransport(handler),
    )

    assert page.body == "arrived"


async def test_a_redirect_loop_gives_up(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_resolver("93.184.216.34"))

    def handler(request):
        return httpx.Response(302, headers={"location": "https://example.com/again"})

    with pytest.raises(ToolExecutionError) as excinfo:
        await fetch(
            "https://example.com/",
            timeout_seconds=5,
            max_response_bytes=1000,
            transport=httpx.MockTransport(handler),
        )

    assert "redirects" in str(excinfo.value)


async def test_an_oversized_body_is_capped(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_resolver("93.184.216.34"))

    def handler(request):
        return httpx.Response(
            200, text="x" * 50_000, headers={"content-type": "text/plain"}
        )

    page = await fetch(
        "https://example.com/",
        timeout_seconds=5,
        max_response_bytes=1000,
        transport=httpx.MockTransport(handler),
    )

    assert page.truncated
    assert len(page.body) <= 1000


async def test_binary_content_is_refused_by_type(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_resolver("93.184.216.34"))

    def handler(request):
        return httpx.Response(200, content=b"\x89PNG", headers={"content-type": "image/png"})

    with pytest.raises(ToolExecutionError) as excinfo:
        await fetch(
            "https://example.com/",
            timeout_seconds=5,
            max_response_bytes=1000,
            transport=httpx.MockTransport(handler),
        )

    assert "image/png" in str(excinfo.value)


# ----------------------------------------------------------------- html to text


def test_html_drops_chrome_and_keeps_content():
    title, text = html_to_text(
        "<html><head><title>Docs</title></head><body>"
        "<nav>Home About Contact</nav>"
        "<script>alert('x')</script>"
        "<style>.a{color:red}</style>"
        "<h1>Install</h1><p>Run the installer.</p>"
        "<ul><li>First</li><li>Second</li></ul>"
        "<footer>Copyright</footer>"
        "</body></html>"
    )

    assert title == "Docs"
    assert "# Install" in text
    assert "Run the installer." in text
    assert "- First" in text
    # Chrome and scripts are gone.
    assert "Home About Contact" not in text
    assert "alert" not in text
    assert "color:red" not in text
    assert "Copyright" not in text


def test_html_preserves_code_blocks():
    _, text = html_to_text("<body><pre>pip install thing</pre></body>")

    assert "```" in text
    assert "pip install thing" in text


def test_malformed_html_still_returns_something():
    _, text = html_to_text("<body><p>unclosed <b>bold</body>")

    assert "unclosed" in text


# --------------------------------------------------------------------- search


async def test_search_without_a_provider_names_the_setting(web_settings):
    result = await dispatch("web_search", {"query": "python asyncio"}, web_settings)

    assert result.is_error
    assert "WEB_SEARCH_PROVIDER" in result.content


async def test_search_with_a_provider_but_no_key_is_refused(tmp_path):
    settings = get_settings().model_copy(
        update={
            "workspace_root": tmp_path,
            "web_tools_enabled": True,
            "web_search_provider": "brave",
        }
    )

    result = await dispatch("web_search", {"query": "x"}, settings)

    assert result.is_error
    assert "WEB_SEARCH_API_KEY" in result.content


# ------------------------------------------------------------------- fetch_url


async def test_fetch_url_renders_a_page(monkeypatch, web_settings):
    monkeypatch.setattr(socket, "getaddrinfo", fake_resolver("93.184.216.34"))

    async def fake_fetch(url, **kwargs):
        return _fetch.FetchedPage(
            url=url,
            status=200,
            content_type="text/html",
            body="<html><head><title>Guide</title></head><body><h1>Setup</h1></body></html>",
            truncated=False,
        )

    monkeypatch.setattr("app.agent.tools.web.web_tools.fetch", fake_fetch)

    result = await dispatch("fetch_url", {"url": "https://example.com"}, web_settings)

    assert not result.is_error
    assert "# Guide" in result.content
    assert "# Setup" in result.content


async def test_an_http_error_comes_back_as_a_readable_result(monkeypatch, web_settings):
    """Matches run_command: a 404 is something to react to, not a tool failure."""

    async def fake_fetch(url, **kwargs):
        return _fetch.FetchedPage(
            url=url, status=404, content_type="text/html", body="Not found", truncated=False
        )

    monkeypatch.setattr("app.agent.tools.web.web_tools.fetch", fake_fetch)

    result = await dispatch("fetch_url", {"url": "https://example.com/gone"}, web_settings)

    assert not result.is_error
    assert "HTTP 404" in result.content


async def test_json_is_pretty_printed(monkeypatch, web_settings):
    async def fake_fetch(url, **kwargs):
        return _fetch.FetchedPage(
            url=url,
            status=200,
            content_type="application/json",
            body='{"version":"1.0","name":"thing"}',
            truncated=False,
        )

    monkeypatch.setattr("app.agent.tools.web.web_tools.fetch", fake_fetch)

    result = await dispatch("fetch_url", {"url": "https://example.com/api"}, web_settings)

    assert not result.is_error
    assert '"version": "1.0"' in result.content


async def test_an_empty_url_is_refused(web_settings):
    result = await dispatch("fetch_url", {"url": "   "}, web_settings)

    assert result.is_error
