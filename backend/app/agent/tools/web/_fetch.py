"""The guarded HTTP GET behind the web tools.

This is the only code in the harness that reaches off the machine, so it is
written to refuse first and fetch second. Layers, outermost in:

1. A master switch, off by default. Egress is an operator decision.
2. Scheme allowlist -- http and https only.
3. Address check on the RESOLVED addresses, not the hostname string. A name
   check alone is defeated by any DNS record pointing at 127.0.0.1, and
   "internal.example.com" resolving to a private address is the normal case
   for a split-horizon network, not an attack.
4. Redirects followed by hand, three hops maximum, re-checking the address at
   every hop. Letting httpx follow them automatically is the classic bypass: a
   public URL 302s to http://169.254.169.254/ and the guard never sees it.
5. A streamed size cap. Content-Length is a claim by the server, not a fact.
6. A content-type allowlist, so a binary body is refused by name rather than
   decoded into the model's context as mojibake.
7. An optional domain allowlist for deployments that want a hard boundary.

**The limit this does not close.** The address check happens before the
connection, so a name that resolves public at check time and private a moment
later (DNS rebinding) would slip through. Closing it properly means pinning the
resolved IP into the connection with a custom transport. For a local dev tool
that an operator has explicitly enabled, with no untrusted tenants, that is not
a trade worth the complexity -- but it is a real gap, and better stated here
than assumed absent by the next reader.
"""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from app.agent.tools.base import ToolExecutionError

MAX_REDIRECTS = 3
USER_AGENT = "Harness-Agent/1.0"

_ALLOWED_SCHEMES = ("http", "https")

#: Suffixes that name a machine-local or network-local host by convention.
_LOCAL_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home.arpa")

#: Content types worth putting in front of a language model.
_TEXTUAL_TYPES = ("text/", "application/json", "application/xml", "+json", "+xml")

DISABLED_MESSAGE = (
    "Web access is disabled. The operator can enable it by setting "
    "WEB_TOOLS_ENABLED=true in backend/.env. Do not retry until they do."
)


@dataclass(frozen=True)
class FetchedPage:
    url: str
    status: int
    content_type: str
    body: str
    truncated: bool


def assert_enabled(enabled: bool) -> None:
    if not enabled:
        raise ToolExecutionError(DISABLED_MESSAGE)


def _assert_public_ip(host: str, raw: str) -> None:
    address = ipaddress.ip_address(raw)
    if address.is_loopback:
        raise ToolExecutionError(f"Refusing to fetch {host}: it resolves to loopback ({raw}).")
    if address.is_link_local:
        raise ToolExecutionError(
            f"Refusing to fetch {host}: it resolves to a link-local address ({raw}). "
            "169.254.169.254 in particular is the cloud metadata service."
        )
    if address.is_private:
        raise ToolExecutionError(
            f"Refusing to fetch {host}: it resolves to a private address ({raw}). "
            "The web tools reach public hosts only."
        )
    if address.is_reserved or address.is_multicast or address.is_unspecified:
        raise ToolExecutionError(
            f"Refusing to fetch {host}: it resolves to a reserved address ({raw})."
        )


def assert_public_host(host: str) -> None:
    """Resolve `host` and refuse if any address it answers with is not public."""
    lowered = host.lower().rstrip(".")
    if lowered == "localhost" or lowered.endswith(_LOCAL_SUFFIXES):
        raise ToolExecutionError(f"Refusing to fetch {host}: it names a local host.")

    # A literal address is already the answer: resolving it would only invite a
    # resolver to disagree with the URL about where the request is going.
    try:
        _assert_public_ip(host, lowered.strip("[]"))
        return
    except ValueError:
        pass  # Not an IP literal, so resolve it as a name.

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise ToolExecutionError(f"Could not resolve {host}: {exc}") from exc

    if not infos:
        raise ToolExecutionError(f"Could not resolve {host}: no addresses returned.")

    # Every address, not just the first: a name answering with one public and
    # one loopback address must not be reachable on the strength of the public
    # one, since which gets connected to is not ours to choose.
    for info in infos:
        _assert_public_ip(host, info[4][0])


def assert_allowed_domain(host: str, allowed: list[str] | None) -> None:
    if not allowed:
        return
    lowered = host.lower().rstrip(".")
    for domain in allowed:
        clean = domain.lower().strip().lstrip(".")
        if lowered == clean or lowered.endswith("." + clean):
            return
    raise ToolExecutionError(
        f"{host} is not in WEB_ALLOWED_DOMAINS ({', '.join(allowed)}), so it cannot be fetched."
    )


def validate_url(url: str, allowed_domains: list[str] | None) -> str:
    """Run every pre-connection check. Returns the host for logging."""
    parsed = urlparse(url)

    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise ToolExecutionError(
            f"Refusing to fetch a {parsed.scheme or 'schemeless'} URL. "
            "Only http and https are allowed."
        )
    if not parsed.hostname:
        raise ToolExecutionError(f"{url!r} has no hostname.")

    assert_allowed_domain(parsed.hostname, allowed_domains)
    assert_public_host(parsed.hostname)
    return parsed.hostname


def _is_textual(content_type: str) -> bool:
    lowered = content_type.lower()
    return any(marker in lowered for marker in _TEXTUAL_TYPES)


async def fetch(
    url: str,
    *,
    timeout_seconds: float,
    max_response_bytes: int,
    allowed_domains: list[str] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> FetchedPage:
    """GET `url`, following redirects by hand and re-checking each hop."""
    timeout = httpx.Timeout(timeout_seconds, connect=5.0)
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,text/plain,application/json"}

    current = url
    async with httpx.AsyncClient(
        timeout=timeout, follow_redirects=False, transport=transport
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            validate_url(current, allowed_domains)

            try:
                request = client.build_request("GET", current, headers=headers)
                response = await client.send(request, stream=True)
            except httpx.TimeoutException as exc:
                raise ToolExecutionError(f"Timed out fetching {current}: {exc}") from exc
            except httpx.HTTPError as exc:
                raise ToolExecutionError(f"Could not fetch {current}: {exc}") from exc

            try:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise ToolExecutionError(
                            f"{current} returned {response.status_code} with no Location header."
                        )
                    # Resolved against the current URL so a relative redirect works.
                    current = str(response.url.join(location))
                    continue

                content_type = response.headers.get("content-type", "")
                if content_type and not _is_textual(content_type):
                    raise ToolExecutionError(
                        f"{current} returned {content_type!r}, which is not text. "
                        "The web tools read text, JSON and XML only."
                    )

                chunks: list[bytes] = []
                total = 0
                truncated = False
                async for chunk in response.aiter_bytes():
                    chunks.append(chunk)
                    total += len(chunk)
                    if total >= max_response_bytes:
                        truncated = True
                        break

                body = b"".join(chunks)[:max_response_bytes].decode("utf-8", errors="replace")
                return FetchedPage(
                    url=current,
                    status=response.status_code,
                    content_type=content_type,
                    body=body,
                    truncated=truncated,
                )
            finally:
                await response.aclose()

    raise ToolExecutionError(
        f"Gave up after {MAX_REDIRECTS} redirects starting from {url}."
    )
