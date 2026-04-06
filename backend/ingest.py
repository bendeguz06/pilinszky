"""
One-time ingestion script.
Run from the backend/ directory:
    python ingest.py

Reads all .txt files from ./corpus/, splits them into semantic sections
(separated by ---), parses [TYPE] and [TITLE] metadata headers, embeds
each section via Ollama nomic-embed-text, and upserts into ChromaDB.
Sections longer than 500 words are sub-chunked at ~300 words.
"""

import os
import re
import chromadb
import requests

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL = "nomic-embed-text"
CORPUS_DIR = "./corpus"
CHROMA_PATH = "./chroma_db"
COLLECTION_NAME = "pilinszky_corpus"
CHUNK_SIZE = 300   # words, for sub-chunking long sections
MAX_SECTION = 500  # words; sections larger than this get sub-chunked


def embed(text: str) -> list[float]:
    res = requests.post(
        f"{OLLAMA_URL}/api/embed",
        json={"model": EMBED_MODEL, "input": text},
        timeout=30,
    )
    res.raise_for_status()
    return res.json()["embeddings"][0]


def word_chunks(text: str, size: int) -> list[str]:
    words = text.split()
    return [" ".join(words[i : i + size]) for i in range(0, len(words), size)]


def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9\u00c0-\u024f]+", "_", text)
    return text[:60].strip("_")


def parse_sections(text: str, source: str) -> list[dict]:
    """
    Split corpus text on --- separators, parse metadata headers,
    and return a list of chunk dicts ready for ChromaDB upsert.
    Each dict has: id, text, metadata.
    """
    raw_sections = text.split("\n\n---\n\n")
    chunks: list[dict] = []

    for section in raw_sections:
        section = section.strip()
        if not section:
            continue

        meta: dict = {"source": source, "type": "", "title": ""}
        content_lines: list[str] = []
        header_done = False

        for line in section.splitlines():
            if not header_done:
                m_type = re.match(r"^\[TYPE:\s*(.*?)\]$", line)
                m_title = re.match(r"^\[TITLE:\s*(.*?)\]$", line)
                if m_type:
                    meta["type"] = m_type.group(1).strip()
                    continue
                if m_title:
                    meta["title"] = m_title.group(1).strip()
                    continue
                if line == "":
                    if meta["type"] or meta["title"]:
                        header_done = True
                    continue
                header_done = True  # non-header, non-blank line
            content_lines.append(line)

        content = "\n".join(content_lines).strip()
        if not content:
            continue

        title_slug = slugify(meta["title"]) if meta["title"] else slugify(source)
        word_count = len(content.split())

        if word_count <= MAX_SECTION:
            chunk_id = f"{meta['type']}_{title_slug}_0"
            chunks.append({
                "id": chunk_id,
                "text": content,
                "metadata": {**meta, "chunk_index": 0},
            })
        else:
            for idx, sub in enumerate(word_chunks(content, CHUNK_SIZE)):
                chunk_id = f"{meta['type']}_{title_slug}_{idx}"
                chunks.append({
                    "id": chunk_id,
                    "text": sub,
                    "metadata": {**meta, "chunk_index": idx},
                })

    return chunks


def main():
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    collection = client.get_or_create_collection(COLLECTION_NAME)

    txt_files = sorted(f for f in os.listdir(CORPUS_DIR) if f.endswith(".txt"))
    if not txt_files:
        print(f"No .txt files found in {CORPUS_DIR}")
        return

    for filename in txt_files:
        path = os.path.join(CORPUS_DIR, filename)
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()

        chunks = parse_sections(text, filename)
        print(f"{filename}: {len(chunks)} chunks")

        for chunk in chunks:
            embedding = embed(chunk["text"])
            collection.upsert(
                ids=[chunk["id"]],
                embeddings=[embedding],
                documents=[chunk["text"]],
                metadatas=[chunk["metadata"]],
            )
            print(f"  upserted: {chunk['id']}")

    print("Ingestion complete.")


if __name__ == "__main__":
    main()
