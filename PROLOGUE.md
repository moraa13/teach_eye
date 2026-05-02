# PROLOGUE.md — Teacher's Eye Vibe-Journal

This file acts as the **Vibe-Journal** for the Teacher's Eye ecosystem.  
After every **major change** (new modules, substantial refactors, or critical bug fixes), append a short entry here so humans and AI agents can quickly reload the project narrative and \"where the vibe left off\".

Entries should be concise and written in plain language.

---

## Entry Template

For each new entry, use this structure:

- **Timestamp**: When this change happened (local time is fine).
- **What we just built**: A brief summary of the new behavior, module, or rule.
- **What broke and how we fixed it**: If something was broken, summarize the root cause and the fix.
- **What the next vibe should be**: The next natural direction, open questions, or experiments to try.

You can optionally add a short **Tag** (e.g., `Session 1 — Tray Focus`, `Session 2 — AI Feedback`) to make entries easier to scan.

---

## Session 17 — Full Student Work Projection On Board

- **Timestamp**: 2026-04-26
- **What we just built**:

  The teacher board no longer projects just a tiny student preview card. When the teacher selects a student and turns on projection, the board now renders that learner's actual current scene in read-only mode: the selected widget states are shown directly on the teacher board, using the same shared widget runtime as the rest of Lesson Mode. This covers `multiple_choice`, `powers_of_two_picker`, `binary_decomposition`, `match_pairs`, `algorithm_steps`, and `code_puzzle`.

  The projection path lives in `frontend/lesson_mode/widget_runtime.js` as a shared read-only renderer, so the classroom board still reads from the same widget contract instead of inventing a third UI branch. The projection also includes the latest Python run source and output block when available, so the teacher can surface both widget work and code work without leaving the board.

- **What broke and how we fixed it**:

  Nothing broke structurally. The main risk was introducing yet another board-specific widget rendering path, so the projection renderer was added inside the shared runtime module rather than hardcoding another separate branch in `teacher.js`.

- **What the next vibe should be**:

  Push the board from strong prototype toward actual daily tool: (1) let the teacher choose whether to project the student's own current scene or mirror that student's work into the teacher's current scene slot; (2) add one more widget family with stronger game feel; (3) start wrapping this runtime into a dedicated desktop board shell once the interaction loop feels complete enough to launch in one app.

---

## Session 16 — Next Widget Wave On Shared Runtime

- **Timestamp**: 2026-04-26
- **What we just built**:

  The shared Lesson Mode widget engine moved beyond the first three demo interactions. `frontend/lesson_mode/widget_runtime.js` now covers the next planned widget family too: `match_pairs`, `algorithm_steps`, and `code_puzzle`, alongside the existing `multiple_choice`, `powers_of_two_picker`, and `binary_decomposition`. The shared module now owns not just rendering helpers but also the update builders that shape student widget state + preview payloads, so teacher and student views keep reading the same runtime truth.

  `student.js` now routes all widget actions through the shared builders, including pair matching and order-rearrangement flows. `styles.css` gained the minimal affordances needed for pair rows and ordering widgets. The teacher runtime automatically inherited the new widget summaries because `teacher.js` already renders through the same shared runtime contract.

  The demo lesson in `server/lesson_mode.py` also grew three new scenes so the board can actually exercise the new engine end-to-end: a concept matching scene, an algorithm ordering scene, and a compact Python code-puzzle scene before the code runner.

- **What broke and how we fixed it**:

  Nothing broke in the runtime model itself. The main implementation risk was slipping back into separate teacher/student widget logic, so the new widget types were added only through the shared runtime module instead of being hardcoded directly into page-specific files.

- **What the next vibe should be**:

  Make the board feel even more like a classroom operating system: (1) let the teacher project the selected student's full widget state or code output onto the board, not just a compact preview; (2) add one more genuinely game-like widget family after these three; (3) start deciding whether the final desktop board should wrap the browser runtime as-is or whether parity is finally high enough to begin the Tauri shell.

---

## Session 15 — Runtime Hardening, Teacher Focus & Shared Widgets

- **Timestamp**: 2026-04-26
- **What we just built**:

  Lesson Mode stopped behaving like a fragile prototype and started acting like a real live-board runtime. `LessonRun` now freezes its lesson payload at launch via `lesson_snapshot_json`, so active classes no longer depend on mutable lesson rows that may later be edited. `LessonParticipantState` gained `progress_version`, and new `lesson_star_events` rows keep an audit trail for both teacher-awarded stars and widget-completion rewards. A new migration `007_lesson_mode_runtime_hardening.py` adds these fields plus runtime indexes for participant lookups and code-run history.

  The teacher screen under `frontend/lesson_mode/teacher.js` was promoted from a scene summary into a true board runtime: the current scene now renders teacher-facing widget cards instead of only `notes_text`, and the teacher can open a focused student view with widget progress plus recent Python runs. That focused student can also be projected directly onto the board so the lesson can temporarily pivot around one learner's work.

  The widget layer itself was partially unified: shared rendering/math/update helpers now live in `frontend/lesson_mode/widget_runtime.js`, and both `student.js` and `teacher.js` consume the same widget contract for `multiple_choice`, `powers_of_two_picker`, and `binary_decomposition`. Student-side widget updates now also send `expected_progress_version`, preparing the runtime for safer concurrent writes.

- **What broke and how we fixed it**:

  The original demo lesson sync path recreated scenes and widgets from scratch, which would have invalidated IDs referenced by active runs, progress blobs, and code-run history. The sync helper in `server/lesson_mode.py` was changed to update scenes/widgets in place whenever possible, while `LessonRun` now keeps its own frozen lesson snapshot so the live classroom never has to trust the mutable template rows.

- **What the next vibe should be**:

  Finish converging on one board runtime instead of two parallel shells: (1) extend the shared widget runtime to the next lesson widgets (`match_pairs`, `algorithm_steps`, `code_puzzle`); (2) let the teacher open richer student artifacts on the board, especially full code + output, not just preview text; (3) decide whether the final separate desktop app should wrap the static runtime as-is or replace it with the planned Tauri shell once parity is reached.

---

## Session 10 — Timer Config, Dashboard Polish & Linux Build

- **Timestamp**: 2026-03-07
- **What we just built**:

  **Configurable session timer** — the teacher now sets the lesson duration in the Teacher Panel before students log in. The new "Длительность сессии" strip shows buttons for 20, 25, 30, 35, 40, 45, 50, 60 minutes. Pressing "Применить" calls `POST /config/session_duration` on the server. The duration is stored in an in-memory dict `_session_config` (resets each server restart — intentional). Each `/login` call bakes the current duration into `Session.duration_seconds` so changing the setting mid-lesson never affects timers already running. The student code screen shows "Длительность сессии: N минут" as a subtitle. (`# [LOGIC-ANCHOR]` in `main.py` on config dict)
  - `server/models.py` — `Session` gains `duration_seconds (Integer, nullable)`.
  - `server/migrations/versions/005_session_duration.py` — idempotent column addition.
  - `server/main.py` — `_session_config` dict; `GET /config/session_duration`; `POST /config/session_duration` (validates 5–180 min); `/login` bakes in duration; `/admin/stats` returns `duration_seconds`.
  - `client/teacher_panel.py` — duration picker section at top; fetches current value on open; `_on_duration_apply` POSTs to server.
  - `client/app.py` — `_session_duration` set from login response; code screen shows duration subtitle.

  **Dashboard: time remaining column** — new "Осталось" column in the student table computes `duration - elapsed` in real time (uses `session_start` + `duration_seconds` from stats). Color coding: gray → orange (< 15 min) → red (< 5 min). Ended/terminated sessions show "—".

  **Dashboard: class separators** — a blue header strip is inserted before the first row of each class group (e.g. "8А", "9Я"). Data is pre-sorted by `class_name` on the server so no client-side sort needed.

  **Linux build support** — `build.py` now:
  - Selects `pystray._xorg` (not `._win32`) as the hidden import on Linux.
  - After building, calls `generate_linux_desktop_files()` which: (a) `chmod +x` each binary; (b) writes a `.desktop` file next to each binary; (c) generates `install_linux.sh` at the project root.
  - `install_linux.sh` (static template also committed) copies the `.desktop` files to `~/Desktop` and marks them executable. Double-click → app launches.

- **What broke and how we fixed it**: Nothing broken. The `remaining_color` for active sessions uses a tuple `("gray70", "gray60")` for the neutral case (light/dark mode support). Sessions with `duration_seconds=NULL` (pre-Session-10 rows) fall back to `SESSION_DURATION_SECONDS` in both the dashboard and the student client.

- **What the next vibe should be**: (1) Actually run `python build.py` on a Linux machine and test double-click; (2) add a live countdown ticker in the dashboard (update every 60 s without a full stats re-fetch — just re-render the "Осталось" cells); (3) export `duration_seconds` in the CSV export; (4) optionally persist the duration config to a file so it survives server restarts.

---

## Session 11 — Lesson Mode Product Map

- **Timestamp**: 2026-04-24
- **What we just built**:

  Captured the next product direction in `TeachEye_lesson_mode_plan.md`: Teacher's Eye grows from a session/submission tool into a local informatics lesson platform. The plan fixes the new core model — lesson library, scene-based flow, widget engine, teacher control runtime, student runtime, mini-previews, embedded Python runner, and post-lesson analytics. It also locks the first demonstration topic to IP addressing and powers of two so future implementation stays grounded in a real classroom use case.

- **What broke and how we fixed it**:

  Nothing broke in code. The main risk we clarified is preview scope: full desktop monitoring would explode complexity, so the plan explicitly narrows MVP previews to TeachEye state only rather than remote-desktop behavior.

- **What the next vibe should be**:

  Turn the product map into concrete implementation artifacts: (1) a domain model for lessons/scenes/widgets/previews/code runs; (2) teacher and student screen layouts; (3) the event flow for scene sync over the local network; (4) the widget contract for the first 5-7 informatics interactions.

---

## Session 12 — Lesson Mode Backend Foundation

- **Timestamp**: 2026-04-24
- **What we just built**:

  Started the real Lesson Mode implementation on the backend. `server/models.py` now includes the first domain layer for reusable lessons, ordered scenes, scene widgets, live lesson runs, per-student runtime state, and stored Python code runs. `server/main.py` gained the first Lesson Mode API surface: lesson library CRUD foundation, demo lesson creation for the IP/powers-of-two flow, lesson run creation/join/advance, participant preview + widget-state updates, manual star progress, and an embedded code-run endpoint. New helpers split the logic: `server/lesson_mode.py` centralizes demo-lesson blueprints + JSON serialization, while `server/code_runner.py` executes short-lived Python snippets with timeout handling and friendly interpreter hints.

- **What broke and how we fixed it**:

  Smoke-testing exposed that `alembic` was used at runtime but missing from `requirements.txt`. Added it to the dependency list and installed the project requirements locally so the new imports could be verified. Full `TestClient` API checks are still gated by a missing dev-only `httpx` package, but the app imports cleanly and the code runner was verified directly.

- **What the next vibe should be**:

  Build the first vertical slice on top of this foundation: (1) seed or author the IP/powers-of-two demo lesson end-to-end; (2) connect one minimal teacher runtime and one minimal student runtime to lesson-run APIs; (3) render the first three widgets (`powers_of_two_picker`, `binary_decomposition`, `multiple_choice`); (4) surface code-run results inside the student runtime instead of a raw API response.

---

## Session 13 — Browser-First Lesson Runtime Slice

- **Timestamp**: 2026-04-24
- **What we just built**:

  Added the first usable Lesson Mode frontend slice under `frontend/lesson_mode/` and wired it into FastAPI at `GET /lesson-mode`. The page contains a teacher runtime and a student runtime hitting the new lesson APIs directly: ensure demo lesson, start a live run, join as a student, switch scenes, navigate back/forward within unlocked scenes, render the first three widget types (`multiple_choice`, `powers_of_two_picker`, `binary_decomposition`), award manual stars, and execute Python code through the embedded runner. The server side also grew a direct participant snapshot route plus one-time reward logic on first widget completion so stars can accumulate without client-side double-awards.

- **What broke and how we fixed it**:

  The machine has `node` available but not a working `npm/corepack` toolchain, so bootstrapping the planned Tauri/React stack was not reliable yet. Instead of stalling, the frontend was delivered as static browser assets mounted by FastAPI. That kept the API contracts and lesson mechanics moving forward while preserving the option to migrate the same runtime flow into Tauri later.

- **What the next vibe should be**:

  Polish this slice into a true classroom prototype: (1) split teacher and student pages cleanly; (2) improve preview tiles so they show richer per-widget state; (3) add the next widget set (`match_pairs`, `algorithm_steps`, `code_puzzle`); (4) decide when to re-attempt the Tauri/React shell once Node tooling is healthy.

---

## Session 14 — Separate Teacher/Student Pages

- **Timestamp**: 2026-04-24
- **What we just built**:

  Split the browser-first Lesson Mode prototype into separate role pages: `GET /lesson-mode/teacher` and `GET /lesson-mode/student`, with `GET /lesson-mode` now acting as a small landing page between them. The teacher page keeps lesson-library control, scene switching, and student tiles; the student page keeps session login, lesson join, widget interaction, and the Python runner. UI labels and action buttons were translated into Russian so the prototype reads like an actual classroom tool instead of an internal English demo.

- **What broke and how we fixed it**:

  The old shared `app.js` shape was too coupled to a single combined page. Instead of forcing conditional branches through one file, the runtime was split into `landing.js`, `teacher.js`, and `student.js`, with small shared conventions via `localStorage` for the current lesson run and student session.

- **What the next vibe should be**:

  Make the separated pages feel more real: (1) richer student preview cards; (2) clearer teacher scene control states; (3) next interactive widgets; (4) later, migrate the same role split into the Tauri shell once the Node toolchain is healthy.

---

## Session 9 — МЭШ-Style Class Codes

- **Timestamp**: 2026-03-07
- **What we just built**:

  **Class-aware МЭШ-style codes** — session codes now encode the student's class and their login order within it, mirroring the numbering familiar from Moscow Electronic School.

  **Roster** (built from the teacher's printed schedule photo):
  | Класс | А | Б | В | Д | Е | З | И | Л | Ч | Ш | Ю | Я |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|
  | **6** | — | — | — | 1 | 2 | 3 | 4 | 5 | — | — | — | — |
  | **8** | 1 | 2 | 3 | 4 | — | — | — | — | 5 | 6 | 7 | 8 |
  | **9** | 1 | 2 | 3 | 4 | — | — | — | — | 5 | 6 | 7 | 8 |
  | **11** | — | — | — | — | — | — | — | — | 1 | — | — | — |

  **Code formula**: `grade_digits + class_ordinal + student_number_in_class`
  e.g. 8А student 3 → **813**, 9Я student 11 → **9811**

  **Changes:**
  - `shared/config.py` — `CLASS_LETTER_ORDINALS` dict (hardcoded roster), `ALL_CLASSES` list for the dropdown, `class_display_code(class_name, student_number) → str` helper.
  - `server/models.py` — `Student` gains `class_name (String)`; unique constraint moves from `name` alone to composite `(name, class_name)`.
  - `server/main.py` — `LoginRequest` gains `class_name`; upsert is now by `(name, class_name)`; `_next_class_student_number` counts today's sessions in same class to assign 1, 2, 3 …; `/login` returns `session_display_code`; `/admin/stats` returns `class_name` + `session_display_code`; sorts by `(class_name, online, name)`.
  - `server/migrations/versions/004_student_class_name.py` — idempotent: adds `class_name`, drops the old `name` unique index, adds composite unique via `recreate="always"`.
  - `client/app.py` — login screen now shows class dropdown (`CTkComboBox` from `ALL_CLASSES`) + name entry; code screen shows class name as header and the МЭШ-style number at 96pt; `_do_login` passes `class_name`.
  - `client/admin_dashboard.py` — student table: two-row cells (name + class in blue below); "Код" column shows the МЭШ display code; detail panel header shows `[code] • class`.

- **What broke and how we fixed it**: Nothing broken. Pre-Session-9 Student rows get `class_name=""` via migration `server_default`; they show "—" as the display code. The unique constraint change required `recreate="always"` because SQLite doesn't support `ALTER TABLE DROP CONSTRAINT` natively.

- **What the next vibe should be**: (1) Test bundles on a clean machine; (2) add group separators in the dashboard student list (one divider per class); (3) consider reading the roster from a YAML/CSV file instead of hardcoding so it survives school-year roster changes without a code edit.

---

## Session 8 — Student Session Codes

- **Timestamp**: 2026-03-07
- **What we just built**:

  **Session codes** — each login now produces a short 2-digit code (10–99) unique among all currently active sessions. The flow:
  1. Student opens the app, types their ФИО, clicks "Войти".
  2. Server assigns a free code via `_generate_session_code()` and returns it inside the `/login` response. (`# [LOGIC-ANCHOR]`)
  3. Client shows a full-screen **code screen** — the number is rendered at 96 pt in blue. Below it: "Покажи этот номер учителю, затем нажми «Начать»".
  4. Student presses "Начать работу →"; only then does the client fetch tasks and open the 50-minute work panel.
  5. Admin dashboard gains a new **"№" column** (first visible column) showing each student's code in `#80c8ff`. The detail-panel header also shows `№XX` next to the student name.
  6. `server/models.py` — `Session` gains `session_code (Integer, nullable)`.
  7. `server/migrations/versions/003_session_code.py` — idempotent Alembic migration adds the column to existing DBs.
  8. Pre-Session-8 session records get `NULL` in the column and display as "—" in the dashboard — no breakage.

- **What broke and how we fixed it**: Nothing broken. Task fetching was moved out of `_do_login` into `_fetch_tasks_and_start` (called when the student clicks "Начать"), keeping the login round-trip minimal.

- **What the next vibe should be**: (1) Test PyInstaller bundles end-to-end on a clean machine; (2) add `requirements.txt` version pins; (3) consider moving `ADMIN_PASSWORD_HASH` to `.env`; (4) add a progress bar in the admin dashboard showing time remaining per student session.

---

## Session 7 — Reliability, Security & Packaging

- **Timestamp**: 2026-03-05
- **What we just built**:

  **Security** — `shared/config.py` no longer stores the raw admin password. `ADMIN_PASSWORD_HASH` holds the SHA-256 digest of `"teacher123"` (computed at import time via `hashlib.sha256`). New `check_admin_password(candidate)` helper hashes the candidate before comparing — the plain text never touches storage or logs. (`# [LOGIC-ANCHOR]`) Both `_require_password` guards in `teacher_panel.py` and `admin_dashboard.py` now call `check_admin_password` instead of a string equality check. (`# [VIBE-CHECK]` in config: change hash before real deployment.)

  **Alembic migrations** — `_add_column_if_missing` removed from `server/main.py`. Replaced by `_run_migrations()` which calls `alembic upgrade head` programmatically at server startup. New files:
    - `alembic.ini` (project root) — points at `server/migrations/`, SQLite URL mirrors `models.py`
    - `server/migrations/env.py` — standard Alembic env; `render_as_batch=True` for SQLite ALTER TABLE support
    - `server/migrations/script.py.mako` — revision template
    - `server/migrations/versions/001_initial_schema.py` — idempotent creation of all Session 1-2 tables
    - `server/migrations/versions/002_sessions_3_to_6_columns.py` — idempotent addition of `submissions.ai_feedback`, `tasks.image_data/solution_code/ai_analysis`, `students.last_seen`; each column guarded by `_column_exists()` so existing DBs upgraded by the old hack are handled safely.
    A `try/except` fallback in `_run_migrations()` falls back to `create_all()` when `alembic.ini` is absent (e.g. inside a PyInstaller bundle).

  **Submission history** — `server/main.py` gains `GET /admin/sessions/{session_id}/submissions` returning all submissions for a session, newest-first, with task title/type, code, AI feedback, and timestamp. `admin_dashboard.py` detail panel now shows a "ИСТОРИЯ СДАЧ" scrollable list of clickable pills (one per submission, showing time + task type + AI-ready indicator). Clicking a pill loads that submission's code and feedback into the code/feedback viewers below. (`# [LOGIC-ANCHOR]` on row click that triggers history fetch.)

  **build.py** — `python build.py` produces three `--onedir` PyInstaller bundles in `dist/`: `TeacherEye_Student`, `TeacherEye_Teacher`, `TeacherEye_Admin`. Bundles `shared/`, `server/`, `client/`, and `assets/` as data; includes `HIDDEN_IMPORTS` list for PIL, pystray, customtkinter, google-generativeai, sqlalchemy, alembic. The FastAPI server is intentionally *not* packaged — it stays a normal Python process. (`# [VIBE-CHECK]`: test each exe on a clean machine before classroom distribution.)

- **What broke and how we fixed it**:
  Nothing broken. Key migration edge-case: SQLite does not support `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so migration 002 uses `_column_exists()` (inspects `sa.inspect(bind).get_columns(table)`) before each `batch_op.add_column` to stay idempotent on DBs that were already upgraded by the old Session 5-6 code.

- **What the next vibe should be**:
  The project is now feature-complete for a classroom MVP. Remaining polish: (1) test the PyInstaller bundles end-to-end on a clean Windows machine; (2) add `requirements.txt` version pins; (3) optionally move `ADMIN_PASSWORD_HASH` out of source into an `.env` file so it survives git updates; (4) add a progress bar in the admin dashboard showing time remaining per student session; (5) consider replacing SHA-256 with `bcrypt` if the tool ever leaves the local LAN.

---

## Session 6 — Polish & Hardening

- **Timestamp**: 2026-03-05
- **What we just built**:
  Security, remote session control, and data export:
  - `shared/config.py` — `ADMIN_PASSWORD = "teacher123"` added. (`# [VIBE-CHECK]`: change before real deployment)
  - `client/teacher_panel.py` — `_require_password()` guard runs before the main window opens. Uses `CTkInputDialog`; exits the process on Cancel or wrong password.
  - `client/admin_dashboard.py` — same `_require_password()` pattern. Two new capabilities:
    - **"Завершить сессию" button** in the detail panel (enabled only when session is `active`). Calls `POST /admin/sessions/{id}/terminate`; disables itself after success so the teacher can't double-click. (`# [LOGIC-ANCHOR]`)
    - **"Экспорт в CSV" button** in the top bar. Downloads `GET /admin/export/csv`, saves the file to the user's Desktop with a timestamp filename, shows the path in the status bar.
  - `server/main.py` — three new endpoints:
    - `GET /sessions/{session_id}/status` — lightweight poll endpoint for the student client. Returns `{session_id, status}`.
    - `POST /admin/sessions/{session_id}/terminate` — sets `session.status = "terminated"` (distinct from `"ended"` which is the natural timer expiry) and stamps `end_time`. Returns 409 if session is not active. (`# [LOGIC-ANCHOR]`)
    - `GET /admin/export/csv` — queries all submissions since today UTC midnight, writes a UTF-8-BOM CSV (Excel-compatible), and returns it as a file-download response.
  - `client/app.py` — `_schedule_status_poll` / `_do_status_poll` / `_fetch_session_status` chain polls `GET /sessions/{id}/status` every 60 seconds. If status is `"terminated"`, `_on_session_terminated()` fires: timer stops, submit locks, a red "Учитель завершил сессию" message appears in the feedback panel. Network errors keep the poll running silently. (`# [LOGIC-ANCHOR]`)
- **What broke and how we fixed it**:
  Nothing broken. Key decision: `"terminated"` is a new session status alongside `"active"` and `"ended"` — keeping them separate lets future analytics distinguish teacher-forced closures from natural expiry. The terminate button in the dashboard disables after a successful call (state="disabled") to prevent accidental double-sends.
- **What the next vibe should be**:
  Session 7 — candidates: (1) Replace `ADMIN_PASSWORD` plain-text comparison with hashed storage (bcrypt or hashlib); (2) show a submission history list per student (not just the latest); (3) live progress bar in admin showing time remaining per student; (4) replace `_add_column_if_missing` hack with Alembic migrations; (5) package both teacher and student apps as standalone executables with PyInstaller.

---

## Session 5 — The Overseer (Teacher's Dashboard)

- **Timestamp**: 2026-03-05
- **What we just built**:
  Real-time class monitoring, task bank management, and student heartbeat tracking:
  - `server/models.py` — `Student` gains `last_seen (DateTime, nullable)`. Migration added in `main.py` lifespan via `_add_column_if_missing`.
  - `server/main.py` — three new endpoints:
    - `POST /ping` — lightweight heartbeat; the client calls this every 30 s. Writes `student.last_seen`. A student is "online" if `last_seen >= utcnow() - 90s`. (`# [LOGIC-ANCHOR]`)
    - `GET /admin/stats` — single-endpoint snapshot: all students who have ever started a session, sorted online-first then alphabetically. Returns `online` bool, session status, latest submission text, task title/type, AI feedback, `last_seen`. (`# [LOGIC-ANCHOR]`)
    - `DELETE /tasks/{id}` — removes a task from the bank; nullifies `task_id` on linked submissions so student work is preserved. (`# [VIBE-CHECK]`)
  - `client/app.py` — `_schedule_ping` / `_do_ping` / `_send_ping` wired into `_on_login_success`. Fires every 30 s via `self.after`; stops automatically when session ends. Errors are silent — a missed ping only causes a brief offline flash.
  - `client/teacher_panel.py` — added **Task Bank** section at the bottom: scrollable list of all uploaded tasks with 🟢/🟡 analysis-ready indicator and a red "Удалить" button per task. Refreshes automatically after upload or delete. (`# [VIBE-CHECK]` on delete)
  - `client/admin_dashboard.py` (new) — full-screen dashboard (`python -m client.admin_dashboard`). Left panel: student table (online dot | name | current task | status | last_seen). Right panel: selected student's code in a monospace textbox + AI feedback textbox. Auto-refreshes every 15 s; clicking a row populates the detail panel. (`# [LOGIC-ANCHOR]` on row click)
- **What broke and how we fixed it**:
  Nothing broken. Key decisions: `last_seen` lives on `Student` (not `Session`) so all sessions for the same name share one freshness signal — simpler dashboard query. Admin stats endpoint does N+1 queries (students → sessions → submissions) which is acceptable for ~30 students; add a JOIN if performance becomes an issue.
- **What the next vibe should be**:
  Session 6 — polish and hardening. Candidates: (1) password-protect the admin dashboard or teacher panel; (2) export session results to CSV; (3) show a history of all submissions per student (not just the latest); (4) replace the `_add_column_if_missing` hack with Alembic; (5) add a "force-end session" button in the admin dashboard for the teacher to close a stuck session remotely.

---

## Session 4 — Teacher Panel & Multimodal Tasks

- **Timestamp**: 2026-03-05
- **What we just built**:
  Replaced hardcoded EGE task seeds with a full teacher-driven task upload flow:
  - `server/models.py` — `Task` table updated: dropped `description`, added `image_data (LargeBinary)` for the task screenshot, `solution_code (Text)` for the teacher's correct solution, and `ai_analysis (Text, nullable)` for Gemini's pre-computed task breakdown. Migration helpers in `main.py` (`_add_column_if_missing`) handle existing DBs without requiring a manual wipe.
  - `server/seed.py` — stripped to a pure schema bootstrap (`create_all` only, no task data). Tasks are now created at runtime by the teacher.
  - `server/ai_engine.py` — new `analyze_task(image_bytes, solution_code)`: multimodal Gemini call (`# [AI-INTERACTION]`) that receives the task screenshot as a PIL Image plus the teacher's solution; returns a structured analysis (task summary, algorithm breakdown, 3–5 typical student mistakes). `analyze_task_or_fallback` wraps it safely. `get_student_feedback` now accepts `task_analysis` and injects it as context before the student's code, making hints significantly more targeted.
  - `server/main.py` — two new endpoints: `POST /tasks` (accepts `{title, task_type, image_b64, solution_code}`, decodes base64 → bytes, persists task, queues `_analyze_and_save_task()` as a BackgroundTask) and `GET /tasks/{id}/image` (returns raw PNG bytes). `GET /tasks` now returns only lightweight metadata (no image or solution). `POST /submissions` passes `task.ai_analysis` into the feedback background task.
  - `client/teacher_panel.py` (new) — standalone CustomTkinter window (`python -m client.teacher_panel`): title field, EGE type dropdown, Ctrl+V paste zone with live preview (canvas), solution code textbox, submit button. `# [VIBE-CHECK]` guards handle empty clipboard and non-image clipboard content with user-facing orange warnings.
  - `client/app.py` — task selection now fetches `GET /tasks/{id}/image` in a daemon thread and renders it via `CTkImage` in the right panel instead of a text description label. `_task_image_ref` holds the reference to prevent GC.
- **What broke and how we fixed it**:
  Nothing broken. Key design decision: images are stored as raw BLOB in SQLite (fine for school-scale, ~30 students, images ~100–500 KB each). The `_add_column_if_missing` migration helper ensures the three new `tasks` columns appear on existing DBs without touching the data.
- **What the next vibe should be**:
  Session 5 — Teacher's Dashboard. A read-only view (web or Tkinter) where the teacher can see all students' submissions and AI feedback per session, in real time. Also: consider adding a `DELETE /tasks/{id}` endpoint so the teacher can remove a task mid-session if it has a typo. Monitor `BackgroundTasks` concurrency if more than ~30 students submit simultaneously (flag for Celery/ARQ if needed).

---

## Session 3 — AI Feedback Engine

- **Timestamp**: 2026-03-05
- **What we just built**:
  Wired Gemini 1.5 Flash into the submission flow to give students Socratic hints:
  - `server/ai_engine.py` — `get_student_feedback()` with a hardcoded "Supportive Teacher" system prompt in Russian (never reveals the answer, explains errors to a 14-year-old, max 5–7 sentences). `get_feedback_or_fallback()` wraps it so callers always get a string, never an exception.
  - `server/models.py` — added `ai_feedback TEXT` column to `Submission` (nullable, populated asynchronously).
  - `server/main.py` — `POST /submissions` now queues `_generate_and_save_feedback()` via FastAPI `BackgroundTasks` (response is instant; Gemini runs after). New `GET /submissions/{id}/feedback` polling endpoint returns `{ready, feedback}`. Added `_add_column_if_missing()` migration helper so existing DBs from Session 2 get the column automatically on next server start.
  - `client/app.py` — after "Accepted ✓", the client immediately shows a loading indicator and polls every 3 seconds (up to 12 attempts / ~36 seconds). When feedback is ready it appears in a styled panel below the editor. On timeout or network failure: "Совет загрузится, как только появится сеть."
- **What broke and how we fixed it**:
  Nothing catastrophically broken. Key design tension: FastAPI `BackgroundTasks` uses the same process/thread pool — if Gemini takes >30s the worker can back up. Acceptable for a school LAN with one teacher and ~30 students. Flag for Session 5 if concurrency becomes an issue.
- **What the next vibe should be**:
  Session 4 — Teacher's Dashboard. Add a read-only web view (or a simple Tkinter admin panel) where the teacher can see all submissions and AI feedback per student per session. Also: promote the `# [STUB-FOR-VIBE]` "Attach file" button in the client to a real file-upload flow.

---

## Session 2 — The Interaction

- **Timestamp**: 2026-03-05
- **What we just built**:
  Closed three Session 1 gaps and delivered the full interaction layer:
  - `client/offline_queue.py` — JSON-backed persistent queue (`enqueue` / `drain`) that survives process crashes; wired into session_end and submission calls; drained automatically on client startup via a `/health` ping.
  - `server/seed.py` — idempotent seed script (`python -m server.seed`) with 5 real EGE informatics tasks: EGE_17 (recursion), EGE_19 (binary arithmetic), EGE_24 (IP subnets), EGE_25 (algorithm trace), EGE_26 (programming task).
  - `server/main.py` — added `GET /tasks` (sorted by id) and promoted `POST /submissions` from STUB-FOR-VIBE to a live endpoint: validates session status, persists `Submission` to DB, returns `{submission_id, status: "received"}`.
  - `client/app.py` — full rebuild: RGBA tray icon with `assets/tray_icon.png` fallback, two-column session UI (task list in `CTkScrollableFrame` on the left, solution `CTkTextbox` + Submit on the right), offline queue wiring on submit and session end, timer-end locks the submit button and turns the clock red.
- **What broke and how we fixed it**:
  The tray icon used `RGB` mode — Windows renders this with a solid black bounding box. Fixed by switching to `RGBA` with a transparent background in `_load_tray_image()`.
- **What the next vibe should be**:
  Session 3 — AI Feedback. Wire Gemini into `POST /submissions`: send `solution_text` + task description to the model, get structured feedback, store it in a new `feedback_text` column on `Submission`, and surface it in the client with a "View Feedback" panel next to the submission status.

---

## Session 1 — Core Logic Implementation

- **Timestamp**: 2026-03-05
- **What we just built**:
  Laid the functional skeleton of the entire Teacher's Eye stack:
  - `requirements.txt` — all Python deps (FastAPI, SQLAlchemy, CustomTkinter, pystray, Pillow, requests, google-generativeai).
  - `shared/config.py` — single source of truth for `SERVER_URL`, `SESSION_DURATION_SECONDS`, and `GEMINI_API_KEY` placeholder.
  - `server/models.py` — SQLAlchemy 4-table schema: **Students** (identity), **Tasks** (EGE content), **Sessions** (50-min window tracking), **Submissions** (student work).
  - `server/main.py` — FastAPI app with lifespan DB init, `/health`, `/login` (upsert student + open session), `/sessions/end`, and a `/submissions` stub.
  - `client/app.py` — CustomTkinter dark-mode login window → live 50-minute countdown → `POST /sessions/end` on timer zero; window close withdraws to `pystray` tray so the timer survives.
- **What broke and how we fixed it**:
  Nothing broken yet — first real code pass. Key design decisions: `after(1000, _tick)` keeps the timer on the Tk thread (no race conditions); HTTP calls run in daemon threads so the GUI never blocks.
- **What the next vibe should be**:
  Session 2 — add the submission panel inside the client (task list + text input + `POST /submissions`), seed the Tasks table with a few EGE tasks, and wire up teacher-side read endpoints so results can be reviewed.

---

## Session 0 — Vibe-Coding Protocol Established

- **Timestamp**: 2026-03-02
- **What we just built**:  
  Defined the Vibe-Coding Annotation Protocol for all Python files via `.cursor/rules/vibe-coding-python.mdc`. This includes the `# [VIBE-CONTEXT]` header, intent-based tags (`# [LOGIC-ANCHOR]`, `# [VIBE-CHECK]`, `# [AI-INTERACTION]`, `# [STUB-FOR-VIBE]`), and an intent-focused docstring philosophy.
- **What broke and how we fixed it**:  
  Nothing was broken yet; this was a foundational setup step to keep future development aligned and searchable.
- **What the next vibe should be**:  
  Start applying the Vibe-Coding annotations to core Teacher's Eye modules (tray app, session timing, and AI feedback flows), and use this PROLOGUE as a save point after each major feature or refactor.

