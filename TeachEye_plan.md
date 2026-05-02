# Teacher's Eye — план проекта

## Архитектура

FastAPI сервер + CustomTkinter клиент + Gemini AI

```
TeachEye/
├── server/
│   ├── main.py          — FastAPI: логин, сессии, сабмиты, фидбек
│   ├── models.py        — SQLAlchemy ORM: Student, Session, Task, Submission
│   ├── ai_engine.py     — Gemini 1.5 Flash: генерация подсказок для ученика
│   └── seed.py          — 5 задач ЕГЭ по информатике (17, 19, 24, 25, 26)
├── client/
│   ├── app.py           — UI: логин → список задач → редактор → сабмит → AI-совет
│   └── offline_queue.py — очередь для упавших запросов при отсутствии сети
└── shared/
    ├── config.py        — SERVER_URL, SESSION_DURATION (50 мин), GEMINI_API_KEY
    └── __init__.py
```

---

## Сессии разработки


| Сессия        | Статус    | Что сделано                                                                       |
| ------------- | --------- | --------------------------------------------------------------------------------- |
| **Session 1** | ✅ Готово  | Скелет проекта, пакеты, базовая структура                                         |
| **Session 2** | ✅ Готово  | FastAPI сервер, ORM модели, клиент с таймером и треем, offline queue              |
| **Session 3** | ✅ Готово  | AI интеграция: Gemini 1.5 Flash, асинхронная генерация фидбека, polling в клиенте |
| **Session 4** | ⏳ Pending | Кнопка "Attach file" в панели сабмита                                             |


---

## Открытые точки [VIBE-CHECK]

- `client/app.py:445` — при таймауте поллинга нет кнопки "Retry" для AI-совета
- `server/main.py:29` — миграции через `ALTER TABLE`, в перспективе нужен Alembic
- `client/app.py:34` — реальная иконка трея (сейчас генерируется кружок-заглушка, нужен `assets/tray_icon.png`)
- `server/ai_engine.py:85` — мониторить частоту fallback-ответов (индикатор проблем с ключом/квотой)

---

## Стабы [STUB-FOR-VIBE] — запланировано, но не реализовано

- `client/app.py:240` — кнопка "Attach file" (Session 4)
- `server/models.py:56` — `task_type` будет управлять выбором AI-рубрики (уже используется в Session 3)

---

## Как запустить

```bash
# 1. Установить зависимости
pip install fastapi uvicorn sqlalchemy customtkinter pystray pillow requests google-generativeai

# 2. Прописать реальный Gemini API ключ
# shared/config.py → GEMINI_API_KEY = "твой_ключ"

# 3. Заполнить задачи (один раз)
python -m server.seed

# 4. Запустить сервер
uvicorn server.main:app --reload

# 5. Запустить клиент
python -m client.app
```

---

## Ключевые решения


| Решение                                | Почему                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| SQLite                                 | Простота на этапе разработки; легко заменить на Postgres через `DATABASE_URL` |
| BackgroundTasks (FastAPI)              | Ответ "Accepted" приходит мгновенно, Gemini работает в фоне                   |
| Polling каждые 3 сек (макс 12 попыток) | Не нужен WebSocket; простой механизм для ~36 сек ожидания AI                  |
| pystray + withdraw()                   | Таймер и сессия живут в фоне, ученик не может случайно убить процесс          |
| Offline queue (JSON файл)              | Школьные сети ненадёжны; данные не теряются при падении сервера               |


---

## База данных

```
students       — id, name, created_at
sessions       — id, student_id, start_time, end_time, status (active/ended)
tasks          — id, title, description, task_type (EGE_17/19/24/25/26)
submissions    — id, session_id, task_id, solution_text, submitted_at, ai_feedback
```

---

## Следующий шаг (Session 4)

1. Добавить кнопку "Attach file" рядом с Submit
2. Передавать файл вместе с `solution_text` на сервер
3. Обновить `/submissions` для приёма файлов (multipart/form-data)

