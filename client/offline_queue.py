# [VIBE-CONTEXT]
# Role: Persistent offline queue for the Teacher's Eye client — stores failed HTTP payloads and replays them when the server is reachable.
# State: Draft — handles session_end and submission event types; drain() is called on startup and can be triggered manually.
# Why: School networks are unreliable; we cannot silently drop session-close or submission data just because the server
#      was temporarily down. A JSON file is the simplest durable store that survives process crashes.

import json
import time
from pathlib import Path
from typing import Any

import requests

# Stored next to this module so the queue survives across client restarts.
_QUEUE_FILE = Path(__file__).parent / ".offline_queue.json"

# Maps logical event types to server route paths.
_ROUTES: dict[str, str] = {
    "session_end": "/sessions/end",
    "submission": "/submissions",
}


def enqueue(event_type: str, payload: dict[str, Any]) -> None:
    """Appends a failed request to the persistent queue.

    Persists immediately so no data is lost even if the process crashes
    before the next drain attempt.
    """
    queue = _load()
    queue.append({
        "type": event_type,
        "payload": payload,
        "queued_at": time.time(),
    })
    _save(queue)


def drain(server_url: str) -> int:
    """Replays all queued events against the live server.

    Only removes entries that succeed; leaves failed ones in place for the
    next retry. Returns the count of successfully replayed events.
    """
    queue = _load()
    if not queue:
        return 0

    failed: list[dict] = []
    replayed = 0

    for event in queue:
        route = _ROUTES.get(event["type"])
        if route is None:
            # Unknown event type — discard silently to avoid infinite accumulation.
            continue
        try:
            resp = requests.post(f"{server_url}{route}", json=event["payload"], timeout=5)
            resp.raise_for_status()
            replayed += 1
        except Exception:
            failed.append(event)

    _save(failed)
    return replayed


def queue_size() -> int:
    """Returns the number of events currently waiting in the offline queue."""
    return len(_load())


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _load() -> list[dict]:
    if not _QUEUE_FILE.exists():
        return []
    try:
        return json.loads(_QUEUE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _save(queue: list[dict]) -> None:
    _QUEUE_FILE.write_text(
        json.dumps(queue, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
