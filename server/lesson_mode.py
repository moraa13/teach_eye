# [VIBE-CONTEXT]
# Role: Holds Lesson Mode domain helpers for Teacher's Eye: demo-lesson creation, JSON
#        serialization, and API-facing state shaping for lessons, scenes, widgets, and runs.
# State: Session 11 — first backend foundation for Lesson Mode; powers-of-two / IP demo lesson,
#        run state, and participant previews are now represented as structured JSON-backed data.
# Why: Keeping lesson serialization and demo content outside main.py makes the next frontend
#      migration (Tauri + React + Konva) easier because the API contract stays centralized.

from __future__ import annotations

import json
from typing import Any

from server.models import (
    CodeRun,
    Lesson,
    LessonParticipantState,
    LessonRun,
    LessonScene,
    LessonWidget,
)


def dump_json(value: Any) -> str:
    """Stores Python structures as compact JSON strings in SQLite-backed text columns."""
    return json.dumps(value, ensure_ascii=False)


def load_json(raw: str | None, fallback: Any) -> Any:
    """Loads JSON text safely, returning a fallback when the value is empty or malformed."""
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def build_demo_lesson_blueprint() -> dict[str, Any]:
    """Returns the first Lesson Mode demo lesson for IP and powers-of-two practice."""
    return {
        "title": "IP и степени двойки — demo lesson",
        "grade_band": "8-9",
        "topic": "IP и двоичная система",
        "level": "core",
        "author_name": "TeachEye",
        "summary": (
            "Пилотный урок для нового Lesson Mode: степени двойки, двоичное разложение, "
            "IP-мышление, сопоставления, порядок алгоритма и короткий код-пазл."
        ),
        "tags": ["informatics", "ip", "binary", "powers_of_two", "demo"],
        "status": "ready",
        "is_template": True,
        "scenes": [
            {
                "title": "Зачем это нужно",
                "scene_type": "board",
                "order_index": 0,
                "layout": {"preset": "hero"},
                "notes_text": "Короткий заход: где в реальности встречаются байты, IP и степени двойки.",
                "widgets": [
                    {
                        "widget_type": "multiple_choice",
                        "title": "Где встречается 255?",
                        "order_index": 0,
                        "layout": {"x": 72, "y": 120, "w": 500, "h": 220},
                        "config": {
                            "question": "Какое из этих утверждений ближе всего к теме урока?",
                            "options": [
                                "255 связано с максимальным значением одного байта",
                                "255 — случайное число без связи с информатикой",
                                "255 — это всегда IP-адрес целиком",
                                "255 появляется только в Python",
                            ],
                            "correct_index": 0,
                            "reward_tenths": 2,
                        },
                    }
                ],
            },
            {
                "title": "Степени двойки",
                "scene_type": "interactive",
                "order_index": 1,
                "layout": {"preset": "split"},
                "notes_text": "Ученики собирают число руками через степени двойки и сразу видят двоичную запись.",
                "widgets": [
                    {
                        "widget_type": "powers_of_two_picker",
                        "title": "Собери число 11",
                        "order_index": 0,
                        "layout": {"x": 56, "y": 96, "w": 620, "h": 260},
                        "config": {
                            "target_value": 11,
                            "values": [128, 64, 32, 16, 8, 4, 2, 1],
                            "reward_tenths": 4,
                            "context_title": "Адрес узла и маска",
                            "task_text": (
                                "Собери значение октета 11 через степени двойки. "
                                "Нажимай нужные биты и следи, как меняется двоичная запись."
                            ),
                            "node_address": "191.89.109.206",
                            "mask_address": "255.255.224.0",
                            "answer_label": "Текущий октет",
                            "teacher_board_text": (
                                "Доска учителя: объяснение того, как число собирается из битов "
                                "и почему 8 + 2 + 1 дает 11."
                            ),
                        },
                    }
                ],
            },
            {
                "title": "Двоичное разложение",
                "scene_type": "interactive",
                "order_index": 2,
                "layout": {"preset": "split"},
                "notes_text": "Разложение 255 и 240 в биты с сохранением локального прогресса ученика.",
                "widgets": [
                    {
                        "widget_type": "binary_decomposition",
                        "title": "Разложи 255 и 240",
                        "order_index": 0,
                        "layout": {"x": 64, "y": 88, "w": 640, "h": 300},
                        "config": {
                            "tasks": [
                                {"target_value": 255, "bit_count": 8},
                                {"target_value": 240, "bit_count": 8},
                            ],
                            "reward_tenths": 4,
                        },
                    }
                ],
            },
            {
                "title": "Быстрая проверка",
                "scene_type": "quiz",
                "order_index": 3,
                "layout": {"preset": "center"},
                "notes_text": "Финальная сцена перед кодом: короткий тест на понимание.",
                "widgets": [
                    {
                        "widget_type": "multiple_choice",
                        "title": "Что ближе всего к 240?",
                        "order_index": 0,
                        "layout": {"x": 110, "y": 110, "w": 520, "h": 260},
                        "config": {
                            "question": "Какой двоичный шаблон соответствует 240?",
                            "options": [
                                "11110000",
                                "00001111",
                                "10101010",
                                "11001100",
                            ],
                            "correct_index": 0,
                            "reward_tenths": 2,
                        },
                    }
                ],
            },
            {
                "title": "Сопоставление понятий",
                "scene_type": "interactive",
                "order_index": 4,
                "layout": {"preset": "center"},
                "notes_text": "Ученики связывают IP-термины с их практическим смыслом перед тем, как идти в алгоритм.",
                "widgets": [
                    {
                        "widget_type": "match_pairs",
                        "title": "Собери правильные пары",
                        "order_index": 0,
                        "layout": {"x": 80, "y": 96, "w": 620, "h": 320},
                        "config": {
                            "pairs": [
                                {"left": "255.255.255.0", "right": "маска подсети /24"},
                                {"left": "11110000", "right": "двоичная запись 240"},
                                {"left": "8 + 2 + 1", "right": "собирает число 11"},
                                {"left": "Октет", "right": "8 бит в IP-адресе"},
                            ],
                            "right_options": [
                                "собирает число 11",
                                "маска подсети /24",
                                "двоичная запись 240",
                                "8 бит в IP-адресе",
                            ],
                            "reward_tenths": 3,
                        },
                    }
                ],
            },
            {
                "title": "Порядок вычисления",
                "scene_type": "interactive",
                "order_index": 5,
                "layout": {"preset": "split"},
                "notes_text": "Теперь класс раскладывает сам алгоритм: как дойти от адреса и маски до сети.",
                "widgets": [
                    {
                        "widget_type": "algorithm_steps",
                        "title": "Расставь шаги алгоритма",
                        "order_index": 0,
                        "layout": {"x": 72, "y": 96, "w": 640, "h": 320},
                        "config": {
                            "steps": [
                                "Перевести нужный октет адреса в двоичный вид",
                                "Перевести маску в двоичный вид",
                                "Сравнить биты адреса и маски поразрядно",
                                "Собрать адрес сети из оставшихся битов",
                            ],
                            "initial_order": [
                                "Сравнить биты адреса и маски поразрядно",
                                "Перевести маску в двоичный вид",
                                "Собрать адрес сети из оставшихся битов",
                                "Перевести нужный октет адреса в двоичный вид",
                            ],
                            "reward_tenths": 3,
                        },
                    }
                ],
            },
            {
                "title": "Код-пазл",
                "scene_type": "interactive",
                "order_index": 6,
                "layout": {"preset": "split"},
                "notes_text": "Финальная мини-сцена: ученик собирает короткий Python-фрагмент перед запуском кода в раннере.",
                "widgets": [
                    {
                        "widget_type": "code_puzzle",
                        "title": "Собери код для вывода адреса сети",
                        "order_index": 0,
                        "layout": {"x": 72, "y": 96, "w": 640, "h": 320},
                        "config": {
                            "lines": [
                                "octet = 11",
                                "binary = bin(octet)[2:].zfill(8)",
                                "print(binary)",
                            ],
                            "initial_order": [
                                "print(binary)",
                                "octet = 11",
                                "binary = bin(octet)[2:].zfill(8)",
                            ],
                            "reward_tenths": 2,
                        },
                    }
                ],
            },
        ],
    }


def create_lesson_from_blueprint(db, blueprint: dict[str, Any]) -> Lesson:
    """Builds a lesson tree (lesson -> scenes -> widgets) from a JSON-like blueprint."""
    lesson = Lesson(
        title=blueprint["title"],
        grade_band=blueprint.get("grade_band", ""),
        topic=blueprint.get("topic", ""),
        level=blueprint.get("level", ""),
        author_name=blueprint.get("author_name", ""),
        summary=blueprint.get("summary", ""),
        tags_json=dump_json(blueprint.get("tags", [])),
        status=blueprint.get("status", "draft"),
        is_template=bool(blueprint.get("is_template", True)),
    )
    db.add(lesson)
    db.flush()

    for scene_data in blueprint.get("scenes", []):
        scene = LessonScene(
            lesson_id=lesson.id,
            title=scene_data["title"],
            scene_type=scene_data.get("scene_type", "board"),
            order_index=scene_data.get("order_index", 0),
            layout_json=dump_json(scene_data.get("layout", {})),
            notes_text=scene_data.get("notes_text", ""),
        )
        db.add(scene)
        db.flush()

        for widget_data in scene_data.get("widgets", []):
            widget = LessonWidget(
                scene_id=scene.id,
                widget_type=widget_data["widget_type"],
                title=widget_data.get("title", ""),
                order_index=widget_data.get("order_index", 0),
                layout_json=dump_json(widget_data.get("layout", {})),
                config_json=dump_json(widget_data.get("config", {})),
            )
            db.add(widget)

    db.flush()
    return lesson


def _sync_widgets_in_place(db, scene: LessonScene, widgets_data: list[dict[str, Any]]) -> None:
    """Updates a scene's widgets without replacing every row and breaking active references."""
    existing_widgets = sorted(scene.widgets, key=lambda item: (item.order_index, item.id))

    for index, widget_data in enumerate(widgets_data):
        widget = existing_widgets[index] if index < len(existing_widgets) else LessonWidget(scene_id=scene.id)
        widget.widget_type = widget_data["widget_type"]
        widget.title = widget_data.get("title", "")
        widget.order_index = widget_data.get("order_index", index)
        widget.layout_json = dump_json(widget_data.get("layout", {}))
        widget.config_json = dump_json(widget_data.get("config", {}))
        db.add(widget)

    for widget in existing_widgets[len(widgets_data):]:
        db.delete(widget)


def sync_lesson_from_blueprint(db, lesson: Lesson, blueprint: dict[str, Any]) -> Lesson:
    """Refreshes an existing lesson so the demo template can evolve without stale content."""
    lesson.title = blueprint["title"]
    lesson.grade_band = blueprint.get("grade_band", "")
    lesson.topic = blueprint.get("topic", "")
    lesson.level = blueprint.get("level", "")
    lesson.author_name = blueprint.get("author_name", "")
    lesson.summary = blueprint.get("summary", "")
    lesson.tags_json = dump_json(blueprint.get("tags", []))
    lesson.status = blueprint.get("status", "draft")
    lesson.is_template = bool(blueprint.get("is_template", True))
    existing_scenes = sorted(lesson.scenes, key=lambda item: (item.order_index, item.id))

    for index, scene_data in enumerate(blueprint.get("scenes", [])):
        scene = existing_scenes[index] if index < len(existing_scenes) else LessonScene(lesson_id=lesson.id)
        scene.title = scene_data["title"]
        scene.scene_type = scene_data.get("scene_type", "board")
        scene.order_index = scene_data.get("order_index", index)
        scene.layout_json = dump_json(scene_data.get("layout", {}))
        scene.notes_text = scene_data.get("notes_text", "")
        db.add(scene)
        db.flush()
        _sync_widgets_in_place(db, scene, scene_data.get("widgets", []))

    for scene in existing_scenes[len(blueprint.get("scenes", [])):]:
        db.delete(scene)

    db.flush()
    return lesson


def ensure_demo_lesson(db) -> Lesson:
    """Creates the IP/powers-of-two demo lesson once and reuses it afterwards."""
    blueprint = build_demo_lesson_blueprint()
    existing = (
        db.query(Lesson)
        .filter(Lesson.title == blueprint["title"])
        .order_by(Lesson.id.desc())
        .first()
    )
    if existing:
        return sync_lesson_from_blueprint(db, existing, blueprint)
    return create_lesson_from_blueprint(db, blueprint)


def serialize_widget(widget: LessonWidget) -> dict[str, Any]:
    """Shapes a widget row into the frontend-facing contract for Lesson Mode clients."""
    return {
        "id": widget.id,
        "widget_type": widget.widget_type,
        "title": widget.title,
        "order_index": widget.order_index,
        "layout": load_json(widget.layout_json, {}),
        "config": load_json(widget.config_json, {}),
    }


def serialize_scene(scene: LessonScene) -> dict[str, Any]:
    """Serializes a lesson scene with all widgets sorted in authoring order."""
    widgets = sorted(scene.widgets, key=lambda w: (w.order_index, w.id))
    return {
        "id": scene.id,
        "title": scene.title,
        "scene_type": scene.scene_type,
        "order_index": scene.order_index,
        "layout": load_json(scene.layout_json, {}),
        "notes_text": scene.notes_text or "",
        "widgets": [serialize_widget(widget) for widget in widgets],
    }


def serialize_lesson(lesson: Lesson) -> dict[str, Any]:
    """Returns a full lesson payload, including scenes and widget metadata."""
    scenes = sorted(lesson.scenes, key=lambda s: (s.order_index, s.id))
    return {
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
        "created_at": lesson.created_at.isoformat() if lesson.created_at else None,
        "updated_at": lesson.updated_at.isoformat() if lesson.updated_at else None,
        "scenes": [serialize_scene(scene) for scene in scenes],
    }


def serialize_run_lesson(run: LessonRun) -> dict[str, Any]:
    """Returns the frozen lesson snapshot for a run, falling back to the current lesson rows."""
    snapshot = load_json(run.lesson_snapshot_json, None)
    if isinstance(snapshot, dict) and snapshot.get("scenes") is not None:
        return snapshot
    return serialize_lesson(run.lesson)


def serialize_code_run(code_run: CodeRun, lesson_payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """Returns one persisted code-run attempt with optional scene title from the run snapshot."""
    scene_title = ""
    if lesson_payload and code_run.scene_id is not None:
        for scene in lesson_payload.get("scenes", []):
            if scene.get("id") == code_run.scene_id:
                scene_title = scene.get("title", "")
                break
    return {
        "id": code_run.id,
        "scene_id": code_run.scene_id,
        "scene_title": scene_title,
        "source_code": code_run.source_code,
        "status": code_run.status,
        "exit_code": code_run.exit_code,
        "stdout_text": code_run.stdout_text or "",
        "stderr_text": code_run.stderr_text or "",
        "friendly_error": code_run.friendly_error or "",
        "duration_ms": code_run.duration_ms,
        "created_at": code_run.created_at.isoformat() if code_run.created_at else None,
    }


def serialize_participant(participant: LessonParticipantState) -> dict[str, Any]:
    """Returns the teacher-facing state snapshot for one student inside a lesson run."""
    session = participant.session
    student = session.student if session else None
    return {
        "session_id": participant.session_id,
        "student_id": student.id if student else None,
        "student_name": student.name if student else "",
        "class_name": student.class_name if student else "",
        "current_scene_index": participant.current_scene_index,
        "highest_unlocked_scene_index": participant.highest_unlocked_scene_index,
        "stars_tenths": participant.stars_tenths,
        "activity_points": participant.activity_points,
        "preview": load_json(participant.preview_json, {}),
        "progress": load_json(participant.progress_json, {}),
        "progress_version": participant.progress_version,
        "last_event_at": participant.last_event_at.isoformat() if participant.last_event_at else None,
        "last_preview_at": participant.last_preview_at.isoformat() if participant.last_preview_at else None,
    }


def serialize_run(run: LessonRun) -> dict[str, Any]:
    """Returns a run snapshot with lesson summary and all participant tiles."""
    participants = sorted(
        run.participants,
        key=lambda item: ((item.session.student.class_name if item.session and item.session.student else ""), item.id),
    )
    return {
        "id": run.id,
        "lesson_id": run.lesson_id,
        "lesson_title": run.lesson.title if run.lesson else "",
        "class_name": run.class_name or "",
        "status": run.status,
        "current_scene_index": run.current_scene_index,
        "highest_unlocked_scene_index": run.highest_unlocked_scene_index,
        "teacher_state": load_json(run.teacher_state_json, {}),
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "ended_at": run.ended_at.isoformat() if run.ended_at else None,
        "participants": [serialize_participant(participant) for participant in participants],
    }
