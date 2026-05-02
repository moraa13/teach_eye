# [VIBE-CONTEXT]
# Role: FastAPI entry point for Teacher's Eye — login, heartbeat, task upload, submissions,
#       AI feedback delivery, admin monitoring, remote session termination, and CSV export.
# State: Session 10 — configurable session duration via POST /config/session_duration;
#        duration is baked into each session at login so mid-lesson changes don't affect
#        in-progress timers. GET /admin/stats now returns duration_seconds per session.
# Why: BackgroundTasks keeps both task-analysis and submission-feedback responses instant;
#      polling endpoints decouple AI latency from the UX on both sides.

import base64
import csv
import io
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DBSession

from server.ai_engine import analyze_task_or_fallback, get_feedback_or_fallback
from server.code_runner import run_python_code
from server.lesson_mode import (
    create_lesson_from_blueprint,
    dump_json,
    ensure_demo_lesson,
    load_json,
    serialize_code_run,
    serialize_lesson,
    serialize_participant,
    serialize_run,
    serialize_run_lesson,
    sync_lesson_from_blueprint,
)
from server.models import (
    Base,
    CodeRun,
    Lesson,
    LessonParticipantState,
    LessonRun,
    LessonScene,
    LessonStarEvent,
    LessonWidget,
    SessionLocal,
    Session as SessionModel,
    Student,
    Submission,
    Task,
    engine,
)
from shared.config import class_display_code, SESSION_DURATION_SECONDS

# A student is considered online if their last_seen is within this window.
_ONLINE_THRESHOLD_SECONDS = 90

# ---------------------------------------------------------------------------
# In-memory session config — teacher sets duration before students log in.
# Resets to the default when the server restarts (intentional for per-day control).
# ---------------------------------------------------------------------------

# [LOGIC-ANCHOR] This is the single source of truth for the NEXT session's duration.
# Past sessions are unaffected because duration_seconds is baked in at login time.
_session_config: dict = {
    "duration_seconds": SESSION_DURATION_SECONDS,
}


# ---------------------------------------------------------------------------
# Lifespan — DB bootstrap via Alembic
# ---------------------------------------------------------------------------

def _run_migrations() -> None:
    """Runs all pending Alembic migrations against the live database.

    This replaces the former _add_column_if_missing hack with proper versioned
    migrations. The alembic.ini must exist at the project root.
    """
    # [LOGIC-ANCHOR] alembic upgrade head is idempotent — safe to call on every startup.
    # New installs get all tables created by migration 001; existing DBs get only the
    # missing columns added by migration 002 (and any future revisions).
    try:
        cfg = AlembicConfig("alembic.ini")
        alembic_command.upgrade(cfg, "head")
    except Exception as exc:
        # Fallback: if alembic.ini is missing (e.g. running from a packaged exe),
        # ensure tables exist via create_all so the app still starts.
        print(f"[migrations] Alembic unavailable ({exc}), falling back to create_all.")
        Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _run_migrations()
    yield


app = FastAPI(title="Teacher's Eye API", version="0.4.0", lifespan=lifespan)
_LESSON_MODE_STATIC_DIR = Path(__file__).resolve().parent.parent / "frontend" / "lesson_mode"

# Tauri desktop runs from http://tauri.localhost, so local API calls are cross-origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://tauri.localhost",
        "https://tauri.localhost",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if _LESSON_MODE_STATIC_DIR.exists():
    app.mount(
        "/lesson-mode-static",
        StaticFiles(directory=str(_LESSON_MODE_STATIC_DIR)),
        name="lesson-mode-static",
    )


# ---------------------------------------------------------------------------
# Dependency
# ---------------------------------------------------------------------------

def get_db():
    """Yields a SQLAlchemy session and guarantees cleanup even on exception."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    student_name: str
    class_name: str = ""


class SessionEndRequest(BaseModel):
    session_id: int


class PingRequest(BaseModel):
    session_id: int


class SubmissionRequest(BaseModel):
    session_id: int
    task_id: int | None = None
    solution_text: str


class TaskUploadRequest(BaseModel):
    title: str
    task_type: str = ""
    image_b64: str        # base64-encoded PNG from the teacher panel
    solution_code: str = ""


class SessionConfigRequest(BaseModel):
    duration_seconds: int


class LessonWidgetRequest(BaseModel):
    widget_type: str
    title: str = ""
    order_index: int = 0
    layout: dict = Field(default_factory=dict)
    config: dict = Field(default_factory=dict)


class LessonSceneRequest(BaseModel):
    title: str
    scene_type: str = "board"
    order_index: int = 0
    layout: dict = Field(default_factory=dict)
    notes_text: str = ""
    widgets: list[LessonWidgetRequest] = Field(default_factory=list)


class LessonCreateRequest(BaseModel):
    title: str
    grade_band: str = ""
    topic: str = ""
    level: str = ""
    author_name: str = ""
    summary: str = ""
    tags: list[str] = Field(default_factory=list)
    status: str = "draft"
    is_template: bool = True
    scenes: list[LessonSceneRequest] = Field(default_factory=list)


class LessonRunCreateRequest(BaseModel):
    lesson_id: int
    class_name: str = ""


class LessonRunJoinRequest(BaseModel):
    session_id: int


class LessonRunAdvanceRequest(BaseModel):
    scene_index: int | None = None


class LessonParticipantNavigateRequest(BaseModel):
    scene_index: int


class LessonParticipantPreviewRequest(BaseModel):
    preview: dict = Field(default_factory=dict)


class LessonParticipantStarsRequest(BaseModel):
    delta_tenths: int = 1
    reason: str = ""


class LessonWidgetStateRequest(BaseModel):
    scene_id: int
    widget_id: int
    state: dict = Field(default_factory=dict)
    preview: dict | None = None
    activity_delta: int = 0
    expected_progress_version: int | None = None


class CodeRunRequest(BaseModel):
    lesson_run_id: int
    session_id: int
    scene_id: int | None = None
    source_code: str


# ---------------------------------------------------------------------------
# Background tasks
# ---------------------------------------------------------------------------

def _analyze_and_save_task(task_id: int, image_bytes: bytes, solution_code: str) -> None:
    """Calls the AI engine with the task image + solution and saves the analysis.

    Runs after POST /tasks already responded so the teacher gets an instant
    "Загружено" confirmation. Uses its own DB session (request session is closed).
    """
    # [AI-INTERACTION] Multimodal Gemini call — result written to tasks.ai_analysis.
    analysis = analyze_task_or_fallback(image_bytes, solution_code)

    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            task.ai_analysis = analysis
            db.commit()
    finally:
        db.close()


def _generate_and_save_feedback(
    submission_id: int,
    solution_text: str,
    task_type: str,
    task_analysis: str,
) -> None:
    """Calls the AI engine and persists the feedback to the submission record.

    Runs after the HTTP response is already sent so the student never waits
    for Gemini before seeing "Accepted". Uses its own DB session.
    """
    # [AI-INTERACTION] Background Gemini call — result written to submissions.ai_feedback.
    feedback = get_feedback_or_fallback(solution_text, task_type, task_analysis)

    db = SessionLocal()
    try:
        submission = db.query(Submission).filter(Submission.id == submission_id).first()
        if submission:
            submission.ai_feedback = feedback
            db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Session-code helpers
# ---------------------------------------------------------------------------

def _next_class_student_number(class_name: str, db: DBSession) -> int:
    """Returns the next sequential login number for a student in their class.

    Numbers run 1, 2, 3 … in order of login for active sessions started today in the
    same class. Ended or terminated sessions from earlier today do NOT free their slot —
    the number is tied to the person who logged in, not a reusable slot.
    """
    # [LOGIC-ANCHOR] Count all sessions (any status) started today for this class so numbers
    # stay stable even after a session ends — prevents number re-use within one school day.
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    count = (
        db.query(SessionModel)
        .join(Student, SessionModel.student_id == Student.id)
        .filter(
            Student.class_name == class_name,
            SessionModel.start_time >= today_start,
        )
        .count()
    )
    return count + 1  # 1-based; called before the new session is inserted


def _get_lesson_or_404(lesson_id: int, db: DBSession) -> Lesson:
    """Loads a lesson or raises a clean 404 for Lesson Mode routes."""
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return lesson


def _get_lesson_run_or_404(lesson_run_id: int, db: DBSession) -> LessonRun:
    """Loads a live lesson run or fails fast for teacher/student runtime calls."""
    run = db.query(LessonRun).filter(LessonRun.id == lesson_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Lesson run not found")
    return run


def _get_participant_state_or_404(lesson_run_id: int, session_id: int, db: DBSession) -> LessonParticipantState:
    """Loads one student's runtime state inside a live lesson run."""
    participant = (
        db.query(LessonParticipantState)
        .filter(
            LessonParticipantState.lesson_run_id == lesson_run_id,
            LessonParticipantState.session_id == session_id,
        )
        .first()
    )
    if not participant:
        raise HTTPException(status_code=404, detail="Lesson participant state not found")
    return participant


def _lesson_scene_count(lesson: Lesson) -> int:
    """Returns the number of scenes currently authored for the lesson."""
    return len(lesson.scenes or [])


def _run_scene_count(run: LessonRun) -> int:
    """Returns the number of scenes frozen into the live run snapshot."""
    return len(serialize_run_lesson(run).get("scenes", []))


def _find_scene_payload(run: LessonRun, scene_id: int) -> dict:
    """Looks up a scene inside the run snapshot so active lessons survive template edits."""
    lesson_payload = serialize_run_lesson(run)
    for scene in lesson_payload.get("scenes", []):
        if scene.get("id") == scene_id:
            return scene
    raise HTTPException(status_code=404, detail="Scene not found in this lesson")


def _find_widget_payload(scene_payload: dict, widget_id: int) -> dict:
    """Loads one widget from the frozen scene payload used by the live classroom run."""
    for widget in scene_payload.get("widgets", []):
        if widget.get("id") == widget_id:
            return widget
    raise HTTPException(status_code=404, detail="Widget not found in this scene")


def _current_scene_payload(run: LessonRun, participant: LessonParticipantState | None = None) -> dict:
    """Returns the scene payload currently relevant to the teacher or selected participant."""
    lesson_payload = serialize_run_lesson(run)
    scene_index = participant.current_scene_index if participant else run.current_scene_index
    scenes = lesson_payload.get("scenes", [])
    if not (0 <= scene_index < len(scenes)):
        raise HTTPException(status_code=404, detail="Scene not found in this lesson")
    return scenes[scene_index]


def _record_star_event(
    db: DBSession,
    participant: LessonParticipantState,
    delta_tenths: int,
    source: str,
    reason: str = "",
) -> None:
    """Stores an audit trail entry for any star delta applied during the lesson runtime."""
    if delta_tenths == 0:
        return
    db.add(
        LessonStarEvent(
            participant_state_id=participant.id,
            delta_tenths=delta_tenths,
            source=source,
            reason=reason,
        )
    )


# ---------------------------------------------------------------------------
# Core routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health_check():
    """Quick liveness probe — returns immediately without touching the DB."""
    return {"status": "alive"}


# ---------------------------------------------------------------------------
# Session configuration endpoints (teacher-facing)
# ---------------------------------------------------------------------------

@app.get("/config/session_duration")
def get_session_duration():
    """Returns the duration that will be applied to the NEXT student login."""
    return {"duration_seconds": _session_config["duration_seconds"]}


@app.post("/config/session_duration")
def set_session_duration(payload: SessionConfigRequest):
    """Sets the duration for upcoming sessions. Does not affect sessions already in progress.

    The teacher calls this from the Teacher Panel before students start logging in.
    Valid range: 5 – 180 minutes.
    """
    mins = payload.duration_seconds // 60
    if not (5 <= mins <= 180):
        raise HTTPException(status_code=400, detail="Duration must be between 5 and 180 minutes.")
    # [LOGIC-ANCHOR] Only _session_config is mutated — existing Session rows are untouched.
    _session_config["duration_seconds"] = payload.duration_seconds
    return {"duration_seconds": payload.duration_seconds, "minutes": mins}


@app.post("/login", status_code=201)
def login(payload: LoginRequest, db: DBSession = Depends(get_db)):
    """Opens a new 50-minute session for the given student.

    Identity is (name, class_name) so two students with the same ФИО in different
    classes get separate Student records. The session_code is the student's sequential
    login number within their class for the current school day (1, 2, 3 …).
    """
    # [LOGIC-ANCHOR] Upsert by (name, class_name) so duplicate ФИО across classes coexist safely.
    class_name = payload.class_name.strip().upper()
    student = (
        db.query(Student)
        .filter(Student.name == payload.student_name, Student.class_name == class_name)
        .first()
    )
    if not student:
        student = Student(name=payload.student_name, class_name=class_name)
        db.add(student)
        db.commit()
        db.refresh(student)

    # Stamp last_seen immediately on login so the dashboard shows them online right away.
    student.last_seen = datetime.utcnow()

    # [LOGIC-ANCHOR] Number is assigned before the session row is written so the count doesn't
    # include the new session itself — student 1 gets 1, student 2 gets 2, etc.
    code = _next_class_student_number(class_name, db)
    # [LOGIC-ANCHOR] Bake the current configured duration into the session so that changing
    # the config mid-lesson does not affect timers already running on student screens.
    duration = _session_config["duration_seconds"]
    new_session = SessionModel(student_id=student.id, session_code=code, duration_seconds=duration)
    db.add(new_session)
    db.commit()
    db.refresh(new_session)

    display = class_display_code(class_name, code)
    return {
        "student_id": student.id,
        "session_id": new_session.id,
        "class_name": class_name,
        "session_code": new_session.session_code,
        "session_display_code": display,
        "duration_seconds": new_session.duration_seconds,
        "start_time": new_session.start_time.isoformat(),
    }


@app.post("/ping")
def ping(payload: PingRequest, db: DBSession = Depends(get_db)):
    """Heartbeat endpoint — called by the client every 30 seconds to signal the student is alive.

    Updates last_seen on the Student record so the admin dashboard can distinguish
    online students from those who lost connection or closed the app.
    """
    session = db.query(SessionModel).filter(SessionModel.id == payload.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # [LOGIC-ANCHOR] Writing last_seen here (not on the Session) means all sessions for the
    # same student share a single freshness signal — simpler for the dashboard query.
    student = db.query(Student).filter(Student.id == session.student_id).first()
    if student:
        student.last_seen = datetime.utcnow()
        db.commit()

    return {"ok": True}


@app.post("/sessions/end")
def end_session(payload: SessionEndRequest, db: DBSession = Depends(get_db)):
    """Closes an active session — sets end_time and transitions status to 'ended'."""
    session = db.query(SessionModel).filter(SessionModel.id == payload.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # [LOGIC-ANCHOR] This write is the canonical close of the focus window on the server side.
    session.end_time = datetime.utcnow()
    session.status = "ended"
    db.commit()

    return {"session_id": session.id, "status": "ended"}


# ---------------------------------------------------------------------------
# Lesson Mode — library, runs, previews, and code execution
# ---------------------------------------------------------------------------

@app.get("/lessons")
def list_lessons(db: DBSession = Depends(get_db)):
    """Returns the shared lesson library with lightweight metadata for teacher pickers."""
    lessons = db.query(Lesson).order_by(Lesson.updated_at.desc(), Lesson.id.desc()).all()
    return [
        {
            "id": lesson.id,
            "title": lesson.title,
            "grade_band": lesson.grade_band or "",
            "topic": lesson.topic or "",
            "level": lesson.level or "",
            "author_name": lesson.author_name or "",
            "summary": lesson.summary or "",
            "tags": load_json(lesson.tags_json, []),
            "status": lesson.status or "draft",
            "is_template": bool(lesson.is_template),
            "scene_count": len(lesson.scenes),
            "updated_at": lesson.updated_at.isoformat() if lesson.updated_at else None,
        }
        for lesson in lessons
    ]


@app.post("/lessons", status_code=201)
def create_lesson(payload: LessonCreateRequest, db: DBSession = Depends(get_db)):
    """Creates a new lesson with nested scenes and widgets for Lesson Mode."""
    lesson = create_lesson_from_blueprint(db, payload.model_dump())
    db.commit()
    db.refresh(lesson)
    return serialize_lesson(lesson)


@app.put("/lessons/{lesson_id}")
def update_lesson(lesson_id: int, payload: LessonCreateRequest, db: DBSession = Depends(get_db)):
    """Updates an existing lesson in place so scene/widget ids remain stable where possible."""
    lesson = _get_lesson_or_404(lesson_id, db)
    lesson = sync_lesson_from_blueprint(db, lesson, payload.model_dump())
    db.commit()
    db.refresh(lesson)
    return serialize_lesson(lesson)


@app.post("/lessons/demo/ip-powers", status_code=201)
def create_ip_demo_lesson(db: DBSession = Depends(get_db)):
    """Ensures the first IP/powers-of-two demonstration lesson exists."""
    lesson = ensure_demo_lesson(db)
    db.commit()
    db.refresh(lesson)
    return serialize_lesson(lesson)


@app.get("/lessons/{lesson_id}")
def get_lesson(lesson_id: int, db: DBSession = Depends(get_db)):
    """Returns one lesson with all scenes and widgets for runtime hydration."""
    lesson = _get_lesson_or_404(lesson_id, db)
    return serialize_lesson(lesson)


@app.post("/lesson-runs", status_code=201)
def create_lesson_run(payload: LessonRunCreateRequest, db: DBSession = Depends(get_db)):
    """Starts a live classroom run from a lesson template."""
    lesson = _get_lesson_or_404(payload.lesson_id, db)
    if _lesson_scene_count(lesson) == 0:
        raise HTTPException(status_code=409, detail="Lesson has no scenes yet")

    run = LessonRun(
        lesson_id=lesson.id,
        class_name=payload.class_name.strip().upper(),
        status="active",
        current_scene_index=0,
        highest_unlocked_scene_index=0,
        teacher_state_json=dump_json({"mode": "lesson_runtime"}),
        lesson_snapshot_json=dump_json(serialize_lesson(lesson)),
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return {"run": serialize_run(run), "lesson": serialize_run_lesson(run)}


@app.get("/lesson-runs/{lesson_run_id}")
def get_lesson_run(lesson_run_id: int, db: DBSession = Depends(get_db)):
    """Returns the current classroom state plus the static lesson content."""
    run = _get_lesson_run_or_404(lesson_run_id, db)
    return {"run": serialize_run(run), "lesson": serialize_run_lesson(run)}


@app.get("/lesson-runs/{lesson_run_id}/participants/{session_id}")
def get_lesson_participant(lesson_run_id: int, session_id: int, db: DBSession = Depends(get_db)):
    """Returns one student's current runtime state for the student-facing client poll loop."""
    participant = _get_participant_state_or_404(lesson_run_id, session_id, db)
    return serialize_participant(participant)


@app.get("/lesson-runs/{lesson_run_id}/participants/{session_id}/inspect")
def inspect_lesson_participant(lesson_run_id: int, session_id: int, db: DBSession = Depends(get_db)):
    """Returns the teacher-facing deep view of one participant: scene, progress, and recent code."""
    run = _get_lesson_run_or_404(lesson_run_id, db)
    participant = _get_participant_state_or_404(lesson_run_id, session_id, db)
    lesson_payload = serialize_run_lesson(run)
    scene_payload = _current_scene_payload(run, participant)
    code_runs = (
        db.query(CodeRun)
        .filter(CodeRun.participant_state_id == participant.id)
        .order_by(CodeRun.created_at.desc(), CodeRun.id.desc())
        .limit(10)
        .all()
    )
    return {
        "participant": serialize_participant(participant),
        "scene": scene_payload,
        "lesson": {
            "id": lesson_payload.get("id"),
            "title": lesson_payload.get("title", ""),
        },
        "code_runs": [serialize_code_run(code_run, lesson_payload) for code_run in code_runs],
    }


@app.post("/lesson-runs/{lesson_run_id}/join", status_code=201)
def join_lesson_run(lesson_run_id: int, payload: LessonRunJoinRequest, db: DBSession = Depends(get_db)):
    """Creates or returns the student's participant state inside a live lesson run."""
    run = _get_lesson_run_or_404(lesson_run_id, db)
    session = db.query(SessionModel).filter(SessionModel.id == payload.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    participant = (
        db.query(LessonParticipantState)
        .filter(
            LessonParticipantState.lesson_run_id == lesson_run_id,
            LessonParticipantState.session_id == payload.session_id,
        )
        .first()
    )
    if not participant:
        participant = LessonParticipantState(
            lesson_run_id=lesson_run_id,
            session_id=payload.session_id,
            current_scene_index=run.current_scene_index,
            highest_unlocked_scene_index=run.highest_unlocked_scene_index,
            preview_json=dump_json({"scene_index": run.current_scene_index, "status": "joined"}),
            progress_json=dump_json({}),
            last_event_at=datetime.utcnow(),
            last_preview_at=datetime.utcnow(),
        )
        db.add(participant)
        db.commit()
        db.refresh(participant)

    return {"run": serialize_run(run), "participant": serialize_participant(participant)}


@app.post("/lesson-runs/{lesson_run_id}/advance")
def advance_lesson_run(
    lesson_run_id: int,
    payload: LessonRunAdvanceRequest,
    db: DBSession = Depends(get_db),
):
    """Moves the class to a new scene and expands the unlocked frontier."""
    run = _get_lesson_run_or_404(lesson_run_id, db)
    scene_count = _run_scene_count(run)
    if scene_count == 0:
        raise HTTPException(status_code=409, detail="Lesson has no scenes")

    next_scene_index = payload.scene_index
    if next_scene_index is None:
        next_scene_index = min(run.current_scene_index + 1, scene_count - 1)

    if not (0 <= next_scene_index < scene_count):
        raise HTTPException(status_code=400, detail="scene_index is out of range")

    # [LOGIC-ANCHOR] The run owns the canonical lesson pace; students can go back, but only the
    # teacher expands the unlocked frontier and moves the shared classroom focus forward.
    run.current_scene_index = next_scene_index
    run.highest_unlocked_scene_index = max(run.highest_unlocked_scene_index, next_scene_index)
    db.commit()
    db.refresh(run)
    return serialize_run(run)


@app.post("/lesson-runs/{lesson_run_id}/participants/{session_id}/navigate")
def navigate_participant_scene(
    lesson_run_id: int,
    session_id: int,
    payload: LessonParticipantNavigateRequest,
    db: DBSession = Depends(get_db),
):
    """Moves one student between already-opened scenes without letting them skip ahead."""
    run = _get_lesson_run_or_404(lesson_run_id, db)
    participant = _get_participant_state_or_404(lesson_run_id, session_id, db)
    if payload.scene_index > run.highest_unlocked_scene_index:
        raise HTTPException(status_code=409, detail="Scene is still locked by the teacher")
    if payload.scene_index < 0:
        raise HTTPException(status_code=400, detail="scene_index cannot be negative")

    participant.current_scene_index = payload.scene_index
    participant.highest_unlocked_scene_index = max(
        participant.highest_unlocked_scene_index,
        min(run.highest_unlocked_scene_index, payload.scene_index),
    )
    participant.last_event_at = datetime.utcnow()
    db.commit()
    db.refresh(participant)
    return serialize_run(run)


@app.post("/lesson-runs/{lesson_run_id}/participants/{session_id}/preview")
def update_participant_preview(
    lesson_run_id: int,
    session_id: int,
    payload: LessonParticipantPreviewRequest,
    db: DBSession = Depends(get_db),
):
    """Updates the teacher-visible mini-preview state for one student."""
    participant = _get_participant_state_or_404(lesson_run_id, session_id, db)
    participant.preview_json = dump_json(payload.preview)
    participant.last_preview_at = datetime.utcnow()
    participant.last_event_at = datetime.utcnow()
    db.commit()
    db.refresh(participant)
    return {"participant": serialize_participant(participant)}


@app.post("/lesson-runs/{lesson_run_id}/participants/{session_id}/stars")
def award_participant_stars(
    lesson_run_id: int,
    session_id: int,
    payload: LessonParticipantStarsRequest,
    db: DBSession = Depends(get_db),
):
    """Adjusts a student's star progress in tenths so the teacher can reward growth manually."""
    participant = _get_participant_state_or_404(lesson_run_id, session_id, db)
    if not (-10 <= payload.delta_tenths <= 10):
        raise HTTPException(status_code=400, detail="delta_tenths must be between -10 and 10")

    participant.stars_tenths = max(0, participant.stars_tenths + payload.delta_tenths)
    participant.last_event_at = datetime.utcnow()
    _record_star_event(db, participant, payload.delta_tenths, source="teacher_manual", reason=payload.reason)
    db.commit()
    db.refresh(participant)
    return {"stars_tenths": participant.stars_tenths}


@app.post("/lesson-runs/{lesson_run_id}/participants/{session_id}/widget-state")
def update_widget_state(
    lesson_run_id: int,
    session_id: int,
    payload: LessonWidgetStateRequest,
    db: DBSession = Depends(get_db),
):
    """Stores one widget's local progress so students can leave and return without losing work."""
    run = _get_lesson_run_or_404(lesson_run_id, db)
    participant = _get_participant_state_or_404(lesson_run_id, session_id, db)
    scene_payload = _find_scene_payload(run, payload.scene_id)
    widget_payload = _find_widget_payload(scene_payload, payload.widget_id)

    if (
        payload.expected_progress_version is not None
        and payload.expected_progress_version != participant.progress_version
    ):
        raise HTTPException(
            status_code=409,
            detail="Widget progress is stale. Refresh the lesson state and try again.",
        )

    progress = load_json(participant.progress_json, {})
    scene_key = str(payload.scene_id)
    scene_progress = progress.setdefault(scene_key, {})
    previous_state = scene_progress.get(str(payload.widget_id), {})
    scene_progress[str(payload.widget_id)] = payload.state

    # [LOGIC-ANCHOR] First completion of a widget grants its configured reward once.
    previous_completed = bool(previous_state.get("completed")) if isinstance(previous_state, dict) else False
    current_completed = bool(payload.state.get("completed")) if isinstance(payload.state, dict) else False
    if current_completed and not previous_completed:
        widget_config = widget_payload.get("config", {})
        reward_tenths = int(widget_config.get("reward_tenths", 0) or 0)
        participant.stars_tenths = max(0, participant.stars_tenths + reward_tenths)
        _record_star_event(
            db,
            participant,
            reward_tenths,
            source="widget_completion",
            reason=f"{widget_payload.get('widget_type', 'widget')} completed",
        )

    participant.progress_json = dump_json(progress)
    participant.progress_version += 1

    if payload.preview is not None:
        participant.preview_json = dump_json(payload.preview)
        participant.last_preview_at = datetime.utcnow()

    participant.activity_points = max(0, participant.activity_points + max(payload.activity_delta, 0))
    participant.last_event_at = datetime.utcnow()
    db.commit()
    db.refresh(participant)
    return {"progress": load_json(participant.progress_json, {}), "activity_points": participant.activity_points}


@app.post("/lesson-mode/code-runs", status_code=201)
def create_code_run(payload: CodeRunRequest, db: DBSession = Depends(get_db)):
    """Runs a student's Python code and persists the result for later teacher inspection."""
    participant = _get_participant_state_or_404(payload.lesson_run_id, payload.session_id, db)
    run = _get_lesson_run_or_404(payload.lesson_run_id, db)

    if payload.scene_id is not None:
        _find_scene_payload(run, payload.scene_id)

    execution = run_python_code(payload.source_code)
    code_run = CodeRun(
        participant_state_id=participant.id,
        scene_id=payload.scene_id,
        source_code=payload.source_code,
        status=str(execution["status"]),
        exit_code=execution["exit_code"],
        stdout_text=str(execution["stdout_text"]),
        stderr_text=str(execution["stderr_text"]),
        friendly_error=execution["friendly_error"],
        duration_ms=execution["duration_ms"],
    )
    db.add(code_run)

    participant.activity_points += 1
    participant.last_event_at = datetime.utcnow()
    db.commit()
    db.refresh(code_run)
    return {"code_run_id": code_run.id, **execution}


# ---------------------------------------------------------------------------
# Lesson Mode static demo pages
# ---------------------------------------------------------------------------

@app.get("/lesson-mode")
def lesson_mode_index():
    """Serves the browser-first Lesson Mode prototype when the static bundle exists."""
    index_path = _LESSON_MODE_STATIC_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Lesson Mode frontend is not built yet")
    return FileResponse(index_path)


@app.get("/lesson-mode/teacher")
def lesson_mode_teacher():
    """Serves the teacher-facing Lesson Mode prototype page."""
    page_path = _LESSON_MODE_STATIC_DIR / "teacher.html"
    if not page_path.exists():
        raise HTTPException(status_code=404, detail="Teacher Lesson Mode page is not built yet")
    return FileResponse(page_path)


@app.get("/lesson-mode/student")
def lesson_mode_student():
    """Serves the student-facing Lesson Mode prototype page."""
    page_path = _LESSON_MODE_STATIC_DIR / "student.html"
    if not page_path.exists():
        raise HTTPException(status_code=404, detail="Student Lesson Mode page is not built yet")
    return FileResponse(page_path)


# ---------------------------------------------------------------------------
# Task endpoints
# ---------------------------------------------------------------------------

@app.post("/tasks", status_code=201)
def create_task(
    payload: TaskUploadRequest,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
):
    """Accepts a teacher-uploaded task (screenshot + solution) and queues AI pre-analysis."""
    try:
        image_bytes = base64.b64decode(payload.image_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="image_b64 is not valid base64")

    task = Task(
        title=payload.title,
        task_type=payload.task_type,
        image_data=image_bytes,
        solution_code=payload.solution_code,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # [AI-INTERACTION] Queue multimodal analysis — teacher sees "Загружено" immediately.
    background_tasks.add_task(
        _analyze_and_save_task,
        task_id=task.id,
        image_bytes=image_bytes,
        solution_code=payload.solution_code,
    )

    return {"task_id": task.id, "status": "uploaded"}


@app.get("/tasks")
def list_tasks(db: DBSession = Depends(get_db)):
    """Returns all tasks ordered by id — excludes image_data and solution_code (too heavy)."""
    tasks = db.query(Task).order_by(Task.id).all()
    return [
        {
            "id": t.id,
            "title": t.title,
            "task_type": t.task_type,
            "analysis_ready": t.ai_analysis is not None,
        }
        for t in tasks
    ]


@app.get("/tasks/{task_id}/image")
def get_task_image(task_id: int, db: DBSession = Depends(get_db)):
    """Returns the raw PNG bytes of a task's screenshot."""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not task.image_data:
        raise HTTPException(status_code=404, detail="No image for this task")
    return Response(content=task.image_data, media_type="image/png")


@app.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, db: DBSession = Depends(get_db)):
    """Removes a task from the bank.

    Also nullifies task_id on any existing submissions so referential integrity
    is maintained — student work is never deleted, only unlinked from the task.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # [VIBE-CHECK] Unlink submissions before deleting — we keep student work even if the task is gone.
    for sub in task.submissions:
        sub.task_id = None
    db.commit()

    db.delete(task)
    db.commit()


# ---------------------------------------------------------------------------
# Submission endpoints
# ---------------------------------------------------------------------------

@app.post("/submissions", status_code=201)
def create_submission(
    payload: SubmissionRequest,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
):
    """Accepts a student's solution, persists it immediately, and queues AI feedback generation."""
    session = db.query(SessionModel).filter(SessionModel.id == payload.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != "active":
        raise HTTPException(status_code=409, detail="Session is already ended")

    task = db.query(Task).filter(Task.id == payload.task_id).first() if payload.task_id else None

    # [LOGIC-ANCHOR] Persist first, generate feedback second — work is never lost even if Gemini fails.
    submission = Submission(
        session_id=payload.session_id,
        task_id=payload.task_id,
        solution_text=payload.solution_text,
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)

    # [AI-INTERACTION] Queue the Gemini call — student gets instant "Accepted" without waiting for the LLM.
    background_tasks.add_task(
        _generate_and_save_feedback,
        submission_id=submission.id,
        solution_text=payload.solution_text,
        task_type=task.task_type or "" if task else "",
        task_analysis=task.ai_analysis or "" if task else "",
    )

    return {"submission_id": submission.id, "status": "received"}


@app.get("/submissions/{submission_id}/feedback")
def get_submission_feedback(submission_id: int, db: DBSession = Depends(get_db)):
    """Polls for AI feedback on a submitted solution."""
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    if submission.ai_feedback is None:
        return {"ready": False, "feedback": None}

    return {"ready": True, "feedback": submission.ai_feedback}


@app.get("/admin/sessions/{session_id}/submissions")
def list_session_submissions(session_id: int, db: DBSession = Depends(get_db)):
    """Returns all submissions for a session, ordered newest-first.

    Used by the admin dashboard to display full submission history for the
    selected student — not just the latest entry as returned by /admin/stats.
    """
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    submissions = (
        db.query(Submission)
        .filter(Submission.session_id == session_id)
        .order_by(Submission.submitted_at.desc())
        .all()
    )

    result = []
    for sub in submissions:
        task = db.query(Task).filter(Task.id == sub.task_id).first() if sub.task_id else None
        result.append({
            "submission_id": sub.id,
            "task_title": task.title if task else "(задание удалено)",
            "task_type": task.task_type if task else "",
            "solution_text": sub.solution_text or "",
            "ai_feedback": sub.ai_feedback,
            "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
        })
    return result


@app.get("/sessions/{session_id}/status")
def get_session_status(session_id: int, db: DBSession = Depends(get_db)):
    """Returns the current status of a session for client-side polling.

    The student client calls this every 60 seconds. If status is 'terminated',
    the client immediately locks the UI without waiting for the timer to expire.
    """
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session_id": session_id, "status": session.status}


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------

@app.get("/admin/stats")
def admin_stats(db: DBSession = Depends(get_db)):
    """Returns a full snapshot for the admin dashboard.

    For every student who has an active session, returns their online status,
    current task, latest submission text, and AI feedback.
    Students with ended sessions are included so the teacher sees the full class picture.
    """
    # [LOGIC-ANCHOR] Single query fan-out: students → sessions → latest submission per session.
    # Sorting by session start_time desc ensures we get the most recent session per student.
    online_cutoff = datetime.utcnow() - timedelta(seconds=_ONLINE_THRESHOLD_SECONDS)

    students = db.query(Student).all()
    result = []

    for student in students:
        # Latest session for this student.
        session = (
            db.query(SessionModel)
            .filter(SessionModel.student_id == student.id)
            .order_by(SessionModel.start_time.desc())
            .first()
        )
        if session is None:
            continue  # Student exists but has never started a session — skip.

        # Latest submission in that session.
        latest_sub = (
            db.query(Submission)
            .filter(Submission.session_id == session.id)
            .order_by(Submission.submitted_at.desc())
            .first()
        )

        task_title = None
        task_type = None
        if latest_sub and latest_sub.task_id:
            task = db.query(Task).filter(Task.id == latest_sub.task_id).first()
            if task:
                task_title = task.title
                task_type = task.task_type

        is_online = (
            student.last_seen is not None and student.last_seen >= online_cutoff
        )

        display = (
            class_display_code(student.class_name, session.session_code)
            if session.session_code is not None
            else None
        )
        result.append({
            "student_id": student.id,
            "student_name": student.name,
            "class_name": student.class_name or "",
            "last_seen": student.last_seen.isoformat() if student.last_seen else None,
            "online": is_online,
            "session_id": session.id,
            "session_code": session.session_code,
            "session_display_code": display,
            "session_status": session.status,
            "session_start": session.start_time.isoformat(),
            "duration_seconds": session.duration_seconds or SESSION_DURATION_SECONDS,
            "submission_id": latest_sub.id if latest_sub else None,
            "task_title": task_title,
            "task_type": task_type,
            "solution_text": latest_sub.solution_text if latest_sub else None,
            "ai_feedback": latest_sub.ai_feedback if latest_sub else None,
            "submitted_at": latest_sub.submitted_at.isoformat() if latest_sub else None,
        })

    # Sort: class name first (so the teacher sees all 8А together), then online status, then name.
    result.sort(key=lambda r: (r["class_name"], not r["online"], r["student_name"].lower()))
    return result


@app.post("/admin/sessions/{session_id}/terminate", status_code=200)
def terminate_session(session_id: int, db: DBSession = Depends(get_db)):
    """Forcibly terminates a student's active session from the teacher dashboard.

    Sets status to 'terminated' — a distinct state from 'ended' (natural timer expiry)
    so analytics can distinguish forced vs normal completion. The student client detects
    this via its 60-second poll of GET /sessions/{id}/status and locks the UI immediately.
    """
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != "active":
        raise HTTPException(status_code=409, detail=f"Session is already '{session.status}'")

    # [LOGIC-ANCHOR] 'terminated' is the teacher-forced close; 'ended' is the natural timer expiry.
    session.status = "terminated"
    session.end_time = datetime.utcnow()
    db.commit()

    return {"session_id": session_id, "status": "terminated"}


@app.get("/admin/export/csv")
def export_csv(db: DBSession = Depends(get_db)):
    """Exports all submissions from today as a UTF-8 CSV file.

    Columns: student_name, session_id, task_title, task_type,
             solution_text, ai_feedback, submitted_at.
    The browser/client receives a file download response.
    """
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    submissions = (
        db.query(Submission)
        .filter(Submission.submitted_at >= today_start)
        .order_by(Submission.submitted_at)
        .all()
    )

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    writer.writerow([
        "student_name", "session_id", "task_title", "task_type",
        "solution_text", "ai_feedback", "submitted_at",
    ])

    for sub in submissions:
        session = db.query(SessionModel).filter(SessionModel.id == sub.session_id).first()
        student_name = session.student.name if session and session.student else ""
        task = db.query(Task).filter(Task.id == sub.task_id).first() if sub.task_id else None
        writer.writerow([
            student_name,
            sub.session_id,
            task.title if task else "",
            task.task_type if task else "",
            sub.solution_text or "",
            sub.ai_feedback or "",
            sub.submitted_at.isoformat() if sub.submitted_at else "",
        ])

    csv_bytes = output.getvalue().encode("utf-8-sig")  # utf-8-sig for Excel compatibility
    filename = f"teachereye_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
