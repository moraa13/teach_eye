import { invoke } from '@tauri-apps/api/core'

const DEBUG_SESSION = 'ffe9af'
const DEBUG_ENDPOINT = 'http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1'
const DEBUG_RUN = 'white-board-debug-v1'

/** NDJSON to ingest + append_debug_log (Tauri) so file works even if ingest is down. */
export function debugAgentLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
) {
  // #region agent log
  const payload: Record<string, unknown> = {
    sessionId: DEBUG_SESSION,
    runId: DEBUG_RUN,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  }
  void fetch(DEBUG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': DEBUG_SESSION },
    body: JSON.stringify(payload),
  }).catch(() => {})
  const line = `${JSON.stringify(payload)}\n`
  void invoke('append_debug_log', { line }).catch(() => {})
  // #endregion
}
