# chunking.py — cut a source file into pieces small enough to embed.
#
# The naive way cuts every N lines, so a function can end up in two halves.
# Half a function means nothing on its own. Better: cut where a new function
# or class starts, so every chunk is one whole thing with a name.
import re

# A line that starts a new top-level definition (no indentation in front).
DEFINITION = re.compile(r"^(def |async def |class |function |export function |export class )")


def chunk_by_lines(path, text, size=10):
    """The naive way: a new chunk every `size` lines, wherever that lands."""
    lines = text.splitlines()
    chunks = []
    for start in range(0, len(lines), size):
        chunks.append(make_chunk(path, lines, start, start + size))
    return chunks


def chunk_by_definition(path, text, max_lines=60):
    """Cut where a function or class starts. Every chunk is one whole unit."""
    lines = text.splitlines()
    starts = [number for number, line in enumerate(lines) if DEFINITION.match(line)]
    if not starts or starts[0] != 0:
        starts.insert(0, 0)              # the imports and constants at the top
    ends = starts[1:] + [len(lines)]

    chunks = []
    for start, end in zip(starts, ends):
        # A huge function is split again, so no chunk is too big to embed well.
        for piece in range(start, end, max_lines):
            chunk = make_chunk(path, lines, piece, min(piece + max_lines, end))
            if chunk["text"].strip():
                chunks.append(chunk)
    return chunks


def make_chunk(path, lines, start, end):
    end = min(end, len(lines))
    return {
        "path": path,
        "start": start + 1,              # line numbers people use start at 1
        "end": end,
        "text": "\n".join(lines[start:end]).strip("\n"),
    }
