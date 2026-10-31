"""Every step the page can show: title, example input, diagram and data views.

A diagram node lights up when the function in `fn` runs. {"fn": "embed",
"in": "retrieve"} only matches embed() called directly from retrieve().

Positions are grid units (x to the right, y down). Edges are
(from, to, decided_by, label); decided_by is "code" or "model".

`views` maps a function name to how its return value is drawn in the Data
panel: chunks, vectors, scores, index or text.
"""

MODULES = [
    ("Build the index", ["step1_chunking", "step2_embeddings", "step3_vector_store", "step4_incremental"]),
    ("Use the index", ["step5_grep_vs_meaning", "step6_ask_codebase", "step7_agent"]),
]


def node(id, label, kind, x, y, fn=None, **match):
    return {"id": id, "label": label, "kind": kind, "x": x, "y": y, "match": {"fn": fn or id, **match}}


def code(id, label, x, y, **kw):
    return node(id, label, "code", x, y, **kw)


def embed(id, label, x, y, **kw):
    return node(id, label, "embed", x, y, fn="embed", **kw)


def store(id, label, x, y, **kw):
    return node(id, label, "store", x, y, **kw)


def tool(id, x, y, label=None):
    return node(id, label or f"{id}()", "tool", x, y)


def llm(id, label, x, y, **kw):
    return node(id, label, "llm", x, y, **kw)


def io(x_in, y_in, x_out, y_out):
    return [{"id": "input", "label": "Input", "kind": "io", "x": x_in, "y": y_in},
            {"id": "output", "label": "Output", "kind": "io", "x": x_out, "y": y_out}]


STEPS = {
    "step1_chunking": {
        "title": "1 · Chunking",
        "decides": "split on definitions",
        "summary": "Cut a file into pieces to embed. Fixed windows cut functions in half; "
                   "cutting where a def or class starts keeps every chunk whole.",
        "example": "api/throttle.py",
        "hint": "Try: payments/charge.py · auth/session.py · web/navbar.js",
        "nodes": io(0, 1, 4, 1) + [
            code("read_source", "Read the file", 1.3, 1),
            code("chunk_by_lines", "Every 10 lines", 2.65, 0.25),
            code("chunk_by_definition", "At each def / class", 2.65, 1.75),
        ],
        "edges": [
            ("input", "read_source", "code", ""),
            ("read_source", "chunk_by_lines", "code", "naive"),
            ("read_source", "chunk_by_definition", "code", "better"),
            ("chunk_by_lines", "output", "code", ""),
            ("chunk_by_definition", "output", "code", ""),
        ],
        "views": {"chunk_by_lines": "chunks", "chunk_by_definition": "chunks"},
    },
    "step2_embeddings": {
        "title": "2 · Embeddings",
        "decides": "meaning, not words",
        "summary": "Turn text into vectors. Similar meaning means a similar direction, "
                   "so cosine similarity finds matches that share no words.",
        "example": "take payment from a user",
        "hint": "Try: block someone who calls us too often · make the menu open",
        "nodes": io(0, 1, 4, 1) + [
            embed("embed", "Embed 6 texts", 1.3, 1),
            code("rank", "Rank by similarity", 2.65, 1),
            code("cosine_similarity", "cosine_similarity", 2.65, 2.25),
        ],
        "edges": [
            ("input", "embed", "code", ""),
            ("embed", "rank", "code", "vectors"),
            ("rank", "cosine_similarity", "code", "each"),
            ("cosine_similarity", "rank", "code", "score"),
            ("rank", "output", "code", ""),
        ],
        "views": {"embed": "vectors", "rank": "scores"},
    },
    "step3_vector_store": {
        "title": "3 · The vector store",
        "decides": "a JSON file + a loop",
        "summary": "Index time: chunk and embed every file, save to JSON. "
                   "Question time: embed the question, score every chunk, keep the best.",
        "example": "where do we stop people from calling the API too often?",
        "hint": "Index time is the top row, question time the bottom row",
        "nodes": io(0, 1.1, 5.1, 2.2) + [
            code("build_index", "build_index", 1.2, 0),
            code("chunk_by_definition", "Chunk a file", 2.5, 0),
            embed("embed_chunks", "Embed its chunks", 3.8, 0, **{"in": "embed_file"}),
            store("save_store", "Save index.json", 5.1, 0),
            code("retrieve", "retrieve", 1.2, 2.2),
            embed("embed_question", "Embed the question", 2.5, 2.2, **{"in": "retrieve"}),
            store("search", "Search the store", 3.8, 2.2),
            code("cosine_similarity", "cosine_similarity", 3.8, 3.35),
        ],
        "edges": [
            ("input", "build_index", "code", ""),
            ("build_index", "chunk_by_definition", "code", "each file"),
            ("chunk_by_definition", "embed_chunks", "code", ""),
            ("embed_chunks", "chunk_by_definition", "code", "next"),
            ("embed_chunks", "save_store", "code", ""),
            ("build_index", "save_store", "code", ""),
            ("build_index", "retrieve", "code", "then"),
            ("retrieve", "embed_question", "code", ""),
            ("embed_question", "search", "code", ""),
            ("search", "cosine_similarity", "code", "each chunk"),
            ("cosine_similarity", "search", "code", ""),
            ("retrieve", "output", "code", "top 3"),
        ],
        "views": {"build_index": "index", "search": "scores"},
    },
    "step4_incremental": {
        "title": "4 · Incremental indexing",
        "decides": "a hash per file",
        "summary": "Index a copy of the repo four times: first run, no change, one file edited, "
                   "one file deleted. Only new or changed files are embedded.",
        "example": "auth/session.py",
        "hint": "The file to edit between runs. Try: orders/cart.py",
        "nodes": io(0, 1, 4.4, 2.2) + [
            code("start_fresh", "Copy the repo", 1.2, 1),
            code("build_index", "build_index", 2.6, 1),
            code("edit_file", "Edit one file", 1.6, 2.2),
            code("embed_file", "Embed a changed file", 4.1, 0.2),
            embed("embed", "Embed", 4.1, 1.2, **{"in": "embed_file"}),
        ],
        "edges": [
            ("input", "start_fresh", "code", ""),
            ("start_fresh", "build_index", "code", ""),
            ("build_index", "build_index", "code", "again"),
            ("build_index", "edit_file", "code", ""),
            ("edit_file", "build_index", "code", ""),
            ("build_index", "embed_file", "code", "changed?"),
            ("embed_file", "embed", "code", ""),
            ("build_index", "output", "code", ""),
        ],
        "views": {"build_index": "index"},
    },
    "step5_grep_vs_meaning": {
        "title": "5 · grep vs semantic search",
        "decides": "you pick the tool",
        "summary": "The same words, two tools. grep needs the exact text in the code; "
                   "semantic search only needs the meaning to be there.",
        "example": "rate limiting",
        "hint": "Try: needs_reauth (a name grep finds) · charge twice",
        "nodes": io(0, 1, 4.6, 1) + [
            code("build_index", "build_index", 1.2, 1),
            tool("grep_search", 2.5, 0),
            tool("semantic_search", 2.5, 2),
            embed("embed", "Embed the words", 1.7, 3.1),
            store("search", "Search the store", 3.3, 3.1),
        ],
        "edges": [
            ("input", "build_index", "code", ""),
            ("build_index", "grep_search", "code", "exact"),
            ("build_index", "semantic_search", "code", "meaning"),
            ("semantic_search", "embed", "code", ""),
            ("embed", "search", "code", ""),
            ("search", "semantic_search", "code", ""),
            ("grep_search", "output", "code", ""),
            ("semantic_search", "output", "code", ""),
        ],
        "views": {"grep_search": "text", "search": "scores"},
    },
    "step6_ask_codebase": {
        "title": "6 · Ask the codebase (RAG)",
        "decides": "retrieve, then answer",
        "summary": "Retrieve the closest chunks, put them in the prompt, and make the model "
                   "answer only from them, with path:line citations.",
        "example": "When does a user have to log in again?",
        "hint": "Try a question the code can't answer: What database do we use?",
        "nodes": io(0, 1, 5.9, 1) + [
            code("build_index", "build_index", 1.15, 1),
            code("retrieve", "Retrieve", 2.4, 1),
            embed("embed", "Embed the question", 1.8, 2.25, **{"in": "retrieve"}),
            store("search", "Search the store", 3.0, 2.25),
            code("format_excerpts", "Build the prompt", 3.6, 1),
            llm("ask", "LLM: answer", 4.8, 1),
        ],
        "edges": [
            ("input", "build_index", "code", ""),
            ("build_index", "retrieve", "code", ""),
            ("retrieve", "embed", "code", "R"),
            ("embed", "search", "code", ""),
            ("search", "retrieve", "code", ""),
            ("retrieve", "format_excerpts", "code", "A"),
            ("format_excerpts", "ask", "code", "G"),
            ("ask", "output", "code", ""),
        ],
        "views": {"search": "scores"},
    },
    "step7_agent": {
        "title": "7 · Agent with both tools",
        "decides": "model, every step",
        "summary": "The ReAct loop from the webinar, with grep_search, semantic_search and "
                   "read_file. The tool descriptions tell the model which to pick.",
        "example": "How many requests per minute can one client make, and what happens after that?",
        "hint": "Watch which tool it picks first, and why",
        "nodes": io(0, 1, 4.0, 1) + [
            code("build_index", "build_index", 1.2, 1),
            llm("chat", "LLM: reason", 2.6, 1),
            tool("semantic_search", 1.4, 2.4),
            tool("grep_search", 2.6, 2.4),
            tool("read_file", 3.8, 2.4),
        ],
        "edges": [
            ("input", "build_index", "code", ""),
            ("build_index", "chat", "code", ""),
            ("chat", "semantic_search", "model", "act"),
            ("semantic_search", "chat", "code", "observe"),
            ("chat", "grep_search", "model", "act"),
            ("grep_search", "chat", "code", "observe"),
            ("chat", "read_file", "model", "act"),
            ("read_file", "chat", "code", "observe"),
            ("chat", "output", "model", "answer"),
        ],
        "views": {"search": "scores"},
    },
}
