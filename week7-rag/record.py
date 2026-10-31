"""Record real API answers for Replay mode (needs a working key in .env).

Runs every step once in Live mode with its example input and saves the
embeddings and replies to recordings/. After that, Replay shows real
text-embedding-3-small scores instead of the offline stand-in.

    python record.py
"""
import json

import server

record = {"embeddings": {}, "replies": {}}
for name, step in server.catalog.STEPS.items():
    run = server.Run(name, step["example"], "live", False, "fast", record=record)
    server.CURRENT = run
    run.execute()
    server.CURRENT = None
    events = []
    while not run.events.empty():
        events.append(run.events.get())
    errors = [e["message"] for e in events if e["type"] == "error"]
    print(f"{name}: {'ERROR ' + errors[0] if errors else 'ok'}")

record["embeddings"]["_model"] = server.LIVE_EMBED_MODEL
server.replay.RECORDINGS.mkdir(exist_ok=True)
(server.replay.RECORDINGS / "embeddings.json").write_text(json.dumps(record["embeddings"]))
(server.replay.RECORDINGS / "replies.json").write_text(json.dumps(record["replies"], ensure_ascii=False, indent=1))
print(f"saved {len(record['embeddings']) - 1} embeddings and {len(record['replies'])} replies to recordings/")
