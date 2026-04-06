import os
import time
import requests
from bs4 import BeautifulSoup

TOC_URL = "https://konyvtar.dia.hu/html/muvek/PILINSZKY/pilinszky00001_tart.html"
BASE_HOST = "https://konyvtar.dia.hu"
POEM_PATH_PREFIX = "/html/muvek/PILINSZKY/pilinszky"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "corpus")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "versek.txt")


def fetch(url):
    response = requests.get(url, timeout=15)
    return response.content  # raw bytes, let BS4 decode with explicit encoding


def extract_poem_links(raw):
    soup = BeautifulSoup(raw, "html.parser")
    seen = set()
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        # Absolute paths like /html/muvek/PILINSZKY/pilinszky00005/...
        if href.startswith(POEM_PATH_PREFIX) and href not in seen:
            seen.add(href)
            links.append((BASE_HOST + href, a.get_text(strip=True)))
    return links


def extract_poem_text(raw, title):
    soup = BeautifulSoup(raw, "html.parser")

    # Remove script, style, nav elements
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()

    # DIA pages wrap the poem body in a <div class="textbox"> or similar;
    # try to find the main content block, fall back to <body>
    content = (
        soup.find("div", class_="textbox")
        or soup.find("div", id="content")
        or soup.find("body")
    )

    if content is None:
        return None

    # Get text with newlines preserved via separator
    lines = []
    for line in content.get_text(separator="\n").splitlines():
        stripped = line.strip()
        lines.append(stripped)

    # Collapse excessive blank lines (keep at most one consecutive blank)
    cleaned = []
    prev_blank = False
    for line in lines:
        if line == "":
            if not prev_blank:
                cleaned.append("")
            prev_blank = True
        else:
            cleaned.append(line)
            prev_blank = False

    text = "\n".join(cleaned).strip()
    return f"[TYPE: vers]\n[TITLE: {title}]\n\n{text}"


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f"Fetching table of contents: {TOC_URL}")
    toc_html = fetch(TOC_URL)
    links = extract_poem_links(toc_html)
    print(f"Found {len(links)} poem links\n")

    poems = []
    for url, link_title in links:
        try:
            time.sleep(0.5)
            html = fetch(url)
            text = extract_poem_text(html, link_title)
            if text:
                poems.append(text)
                print(f"✓ {link_title}")
            else:
                print(f"✗ {url}: could not extract text")
        except Exception as e:
            print(f"✗ {url}: {e}")

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("\n\n---\n\n".join(poems))

    print(f"\nSaved {len(poems)} poems to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
