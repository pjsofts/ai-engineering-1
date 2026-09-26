"""Chunk a PDF and index the chunks in Upstash Vector (namespace: docs)."""
import re
import sys
import time

from dotenv import load_dotenv
from openai import OpenAI
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader
from upstash_vector import Index

load_dotenv()

index = Index.from_env()
client = OpenAI()

NAMESPACE = "docs"
EMBED_MODEL = "text-embedding-3-small"  # must match chat.py and the index's 1536 dims
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150


def clean(text):
    """Undo the letter-spaced headings in the deck and squeeze blank space."""
    text = re.sub(r"\b(?:[A-Za-z]  )+[A-Za-z]\b",
                  lambda m: m.group(0).replace("  ", ""), text)
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def chunk_pdf(path):
    """Split each page into overlapping chunks, keeping the page number."""
    reader = PdfReader(path)
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )

    chunks = []
    for page_no, page in enumerate(reader.pages, start=1):
        text = clean(page.extract_text() or "")
        if not text:
            continue
        for i, piece in enumerate(splitter.split_text(text)):
            chunks.append({
                "id": f"{path}:p{page_no}:c{i}",
                # Prefixing the source helps the model cite the right page.
                "data": f"[{path}, page {page_no}]\n{piece}",
                "metadata": {"source": path, "page": page_no, "chunk": i},
            })
    return chunks


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "AI-Engineering-Week6.pdf"
    chunks = chunk_pdf(path)

    sizes = [len(c["data"]) for c in chunks]
    print(f"{path}: {len(chunks)} chunks, "
          f"{min(sizes)}-{max(sizes)} chars (avg {sum(sizes) // len(sizes)})")

    if NAMESPACE in index.info().namespaces:
        index.delete([c["id"] for c in chunks], namespace=NAMESPACE)
    for i in range(0, len(chunks), 50):  # Upstash caps batch size.
        batch = chunks[i:i + 50]
        resp = client.embeddings.create(input=[c["data"] for c in batch],
                                        model=EMBED_MODEL)
        for chunk, item in zip(batch, resp.data):
            chunk["vector"] = item.embedding
        index.upsert(batch, namespace=NAMESPACE)
    while index.info().namespaces[NAMESPACE].pending_vector_count:
        time.sleep(0.5)

    print(f"indexed into namespace '{NAMESPACE}': "
          f"{index.info().namespaces[NAMESPACE].vector_count} vectors")


if __name__ == "__main__":
    main()
