import os
import re
import time
import requests
from bs4 import BeautifulSoup

# The _kv page is a frameset; the actual TOC lives in _tart
TOC_URL = "https://konyvtar.dia.hu/html/muvek/PILINSZKY/pilinszky00989_tart.html"
BASE_HOST = "https://konyvtar.dia.hu"
LINK_PREFIX = "/html/muvek/PILINSZKY/pilinszky"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "corpus")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "interjuk.txt")

# Em-dash variants used by DIA pages
DASH_RE = re.compile(r"^[\u2013\u2014\-]\s*")
# Interviewer name in parentheses, e.g. "(Cs. Szabó László)"
INTERVIEWER_RE = re.compile(r"^\((.+?)\)\s*$")


def fetch(url: str) -> bytes:
    resp = requests.get(url, timeout=15)
    return resp.content


def extract_links(raw: bytes) -> list[tuple[str, str]]:
    soup = BeautifulSoup(raw, "html.parser")
    seen: set[str] = set()
    links: list[tuple[str, str]] = []
    for a in soup.find_all("a", href=True):
        href: str = a["href"]
        # Skip overview pages (_o suffix) and external links
        if (
            href.startswith(LINK_PREFIX)
            and not href.endswith("_o.html")
            and "_o/" not in href
            and href not in seen
        ):
            seen.add(href)
            links.append((BASE_HOST + href, a.get_text(strip=True)))
    return links


def extract_interview(raw: bytes, link_title: str) -> str:
    soup = BeautifulSoup(raw, "html.parser")

    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()

    content = (
        soup.find("div", class_="textbox")
        or soup.find("div", id="content")
        or soup.find("body")
    )
    if content is None:
        return f"[TYPE: interjú]\n[TITLE: {link_title}]\n\n(nem sikerült kinyerni)"

    # Collect all non-empty text blocks in document order
    blocks: list[str] = []
    for elem in content.find_all(["h1", "h2", "h3", "h4", "p", "div"]):
        # Skip nested divs/containers that would duplicate text
        if elem.name == "div" and elem.find(["p", "h1", "h2", "h3", "h4"]):
            continue
        text = elem.get_text(separator=" ", strip=True)
        if text:
            blocks.append(text)

    if not blocks:
        # Fallback: plain text
        blocks = [l.strip() for l in content.get_text().splitlines() if l.strip()]

    # --- Identify title and interviewer ---
    title = link_title
    interviewer = "KÉRDEZŐ"
    body_start = 0

    for i, block in enumerate(blocks):
        # Skip DIA header cruft
        if "DIA" in block and len(block) < 30:
            body_start = i + 1
            continue
        # First real heading = title
        if title == link_title and len(block) < 120 and not DASH_RE.match(block):
            title = block
            body_start = i + 1
            continue
        # Interviewer name in parentheses right after title
        m = INTERVIEWER_RE.match(block)
        if m and i <= body_start + 1:
            interviewer = m.group(1).strip()
            body_start = i + 1
            continue
        break

    # --- Label speaker turns ---
    # All turns start with – (em/en-dash). They strictly alternate:
    # odd turns (0, 2, 4…) = interviewer, even turns (1, 3, 5…) = PILINSZKY
    output_lines: list[str] = []
    turn_index = 0

    for block in blocks[body_start:]:
        if DASH_RE.match(block):
            text = DASH_RE.sub("", block).strip()
            if not text:
                continue
            if turn_index % 2 == 0:
                speaker = interviewer.upper()
            else:
                speaker = "PILINSZKY"
            output_lines.append(f"{speaker}: {text}")
            turn_index += 1
        else:
            # Non-dialogue block (section header, editorial note, etc.)
            output_lines.append(block)

    body = "\n\n".join(output_lines).strip()
    return f"[TYPE: interjú]\n[TITLE: {title}]\n\n{body}"


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f"Fetching interview TOC: {TOC_URL}")
    toc_raw = fetch(TOC_URL)
    links = extract_links(toc_raw)
    print(f"Found {len(links)} interview links\n")

    sections: list[str] = []
    for url, link_title in links:
        try:
            time.sleep(0.5)
            raw = fetch(url)
            text = extract_interview(raw, link_title)
            sections.append(text)
            print(f"✓ {link_title}")
        except Exception as e:
            print(f"✗ {url}: {e}")

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("\n\n---\n\n".join(sections))

    print(f"\nSaved {len(sections)} interviews to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
