"""HTML to readable text, using only the standard library.

Deliberately not BeautifulSoup: the target is documentation pages, where the
useful content is headings, paragraphs, lists and code blocks, and a parser
that drops chrome and keeps that structure is a hundred lines. Adding a
dependency to the backend to save them is a poor trade.

Structure is kept where it carries meaning for a reader -- headings become
markdown headings, list items get a bullet, code blocks get fenced -- because
a doc page flattened into one paragraph loses exactly the shape that makes it
answerable.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser

#: Subtrees whose text is never worth reading: scripts, styling, and the
#: navigation furniture that surrounds the actual content on every page.
_DROP_SUBTREES = {"script", "style", "noscript", "svg", "nav", "footer", "header", "form"}

_HEADINGS = {"h1": "#", "h2": "##", "h3": "###", "h4": "####", "h5": "#####", "h6": "######"}

#: Tags after which a line break is meaningful.
_BLOCK_TAGS = {
    "p", "div", "section", "article", "br", "tr", "table", "ul", "ol", "dl",
    "blockquote", "hr", *_HEADINGS,
}


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.title: str = ""
        self._drop_depth = 0
        self._in_title = False
        self._in_pre = False
        self._pending_heading: str | None = None

    # -- helpers ---------------------------------------------------------
    def _emit(self, text: str) -> None:
        if text:
            self.parts.append(text)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _DROP_SUBTREES:
            self._drop_depth += 1
            return
        if self._drop_depth:
            return

        if tag == "title":
            self._in_title = True
        elif tag in _HEADINGS:
            self._emit("\n\n")
            self._pending_heading = _HEADINGS[tag]
        elif tag == "li":
            self._emit("\n- ")
        elif tag == "pre":
            self._in_pre = True
            self._emit("\n\n```\n")
        elif tag in _BLOCK_TAGS:
            self._emit("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _DROP_SUBTREES:
            self._drop_depth = max(0, self._drop_depth - 1)
            return
        if self._drop_depth:
            return

        if tag == "title":
            self._in_title = False
        elif tag == "pre":
            self._in_pre = False
            self._emit("\n```\n")
        elif tag in _HEADINGS:
            self._pending_heading = None
            self._emit("\n")
        elif tag in _BLOCK_TAGS:
            self._emit("\n")

    def handle_data(self, data: str) -> None:
        if self._drop_depth:
            return
        if self._in_title:
            self.title += data.strip()
            return
        if self._in_pre:
            self._emit(data)
            return

        text = re.sub(r"\s+", " ", data)
        if not text.strip():
            # Keep a single separating space so adjacent inline elements do not
            # run together into oneword.
            if self.parts and not self.parts[-1].endswith((" ", "\n")):
                self._emit(" ")
            return

        if self._pending_heading:
            self._emit(f"{self._pending_heading} {text.strip()}")
            self._pending_heading = None
            return
        self._emit(text)


def html_to_text(html: str) -> tuple[str, str]:
    """Return (title, readable text)."""
    parser = _TextExtractor()
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # noqa: BLE001 - malformed markup must not fail the fetch
        # A partial parse is still worth returning; the alternative is nothing.
        pass

    text = "".join(parser.parts)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [line.rstrip() for line in text.splitlines()]
    return parser.title.strip(), "\n".join(lines).strip()
