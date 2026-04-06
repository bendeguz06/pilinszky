"""
One-time ingestion script.
Run from the backend/ directory:
    python ingest.py

Reads all .txt files from ./corpus/, chunks them into ~300-word pieces,
embeds each chunk via Ollama nomic-embed-text, and upserts into ChromaDB.
"""

import os
import chromadb
import requests

OLLAMA_URL = "http://localhost:11434"
EMBED_MODEL = "nomic-embed-text"
CORPUS_DIR = "./corpus"
CHROMA_PATH = "./chroma_db"
COLLECTION_NAME = "pilinszky_corpus"
CHUNK_SIZE = 300  # words


def chunk_text(text: str, size: int) -> list[str]:
    words = text.split()
    return [" ".join(words[i : i + size]) for i in range(0, len(words), size)]


def embed(text: str) -> list[float]:
    res = requests.post(
        f"{OLLAMA_URL}/api/embeddings",
        json={"model": EMBED_MODEL, "prompt": text},
        timeout=30,
    )
    res.raise_for_status()
    return res.json()["embedding"]


def main():
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    collection = client.get_or_create_collection(COLLECTION_NAME)

    txt_files = [f for f in os.listdir(CORPUS_DIR) if f.endswith(".txt")]
    if not txt_files:
        print(f"No .txt files found in {CORPUS_DIR}")
        return

    for filename in txt_files:
        path = os.path.join(CORPUS_DIR, filename)
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()

        chunks = chunk_text(text, CHUNK_SIZE)
        print(f"{filename}: {len(chunks)} chunks")

        for idx, chunk in enumerate(chunks):
            doc_id = f"{filename}_{idx}"
            embedding = embed(chunk)
            collection.upsert(
                ids=[doc_id],
                embeddings=[embedding],
                documents=[chunk],
                metadatas=[{"source": filename, "chunk_index": idx}],
            )
            print(f"  upserted chunk {idx + 1}/{len(chunks)}")

    print("Ingestion complete.")


if __name__ == "__main__":
    main()
