# [VIBE-CONTEXT]
# Role: Main desktop client for Teacher's Eye — login, code screen, tray, timer, submission panel, and AI feedback display.
# State: Session 8 — after login the student sees a "Ваш номер: XX" screen so the teacher can verify
#        identity on the admin dashboard before the session work begins.
# Why: CustomTkinter dark-mode UI + pystray keep the session alive; feedback is polled asynchronously
#      so the "Accepted" response is instant and the AI hint appears a few seconds later.

import io
import threading
from pathlib import Path

import customtkinter as ctk
import pystray
import requests
from PIL import Image, ImageDraw

from client.offline_queue import drain, enqueue
from shared.config import ALL_CLASSES, SERVER_URL, SESSION_DURATION_SECONDS, TRAY_TOOLTIP

ASSETS_DIR = Path(__file__).parent.parent / "assets"

_FEEDBACK_POLL_INTERVAL_MS = 3000   # poll every 3 seconds
_FEEDBACK_MAX_POLLS = 12            # give up after ~36 seconds
_PING_INTERVAL_MS = 30_000          # heartbeat every 30 seconds
_STATUS_POLL_INTERVAL_MS = 60_000   # session-status check every 60 seconds


# ---------------------------------------------------------------------------
# Tray helpers
# ---------------------------------------------------------------------------

def _load_tray_image() -> Image.Image:
    """Returns the tray icon — loads assets/tray_icon.png when present, otherwise generates a placeholder.

    The generated fallback uses RGBA with a transparent background so Windows
    renders the icon correctly without a black bounding box.
    """
    # [VIBE-CHECK] Drop a real tray_icon.png into assets/ to override the generated placeholder.
    icon_path = ASSETS_DIR / "tray_icon.png"
    if icon_path.exists():
        return Image.open(icon_path).convert("RGBA").resize((64, 64))

    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((4, 4, 60, 60), fill=(80, 140, 255, 255))
    return img


def _build_tray(root: ctk.CTk) -> pystray.Icon:
    """Creates a pystray Icon wired to show/exit actions on the main window."""

    def on_show(icon, item):
        root.after(0, root.deiconify)

    def on_exit(icon, item):
        icon.stop()
        root.after(0, root.destroy)

    menu = pystray.Menu(
        pystray.MenuItem("Show", on_show),
        pystray.MenuItem("Exit (end session)", on_exit),
    )
    return pystray.Icon("teacher_eye", _load_tray_image(), TRAY_TOOLTIP, menu)


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

class TeacherEyeApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Teacher's Eye")
        self.geometry("960x640")
        self.minsize(780, 500)
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self._session_id: int | None = None
        self._session_code: int | None = None
        self._session_display_code: str | None = None
        self._class_name: str | None = None
        self._session_duration: int = SESSION_DURATION_SECONDS
        self._remaining: int = SESSION_DURATION_SECONDS
        self._tray: pystray.Icon | None = None
        self._timer_running: bool = False
        self._selected_task: dict | None = None
        self._task_buttons: dict[int, ctk.CTkButton] = {}

        # Feedback polling state
        self._feedback_submission_id: int | None = None
        self._feedback_poll_count: int = 0

        # Keeps a reference to the CTkImage so it isn't garbage-collected while displayed.
        self._task_image_ref: ctk.CTkImage | None = None
        # [LOGIC-ANCHOR] Persistent 1×1 transparent placeholder — always passed instead of
        # image=None so Tkinter never holds a dangling PhotoImage reference on Linux.
        _blank = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
        self._task_image_placeholder = ctk.CTkImage(light_image=_blank, dark_image=_blank, size=(1, 1))

        self._build_login_ui()

        # [LOGIC-ANCHOR] Overriding WM_DELETE_WINDOW keeps the process (and timer) alive
        # after window close — the student cannot accidentally kill the session.
        self.protocol("WM_DELETE_WINDOW", self._minimize_to_tray)

        threading.Thread(target=self._try_drain, daemon=True).start()

    # ------------------------------------------------------------------
    # Offline queue
    # ------------------------------------------------------------------


    def _try_drain(self) -> None:
        """Pings the server on startup; replays any offline-queued events if reachable."""
        try:
            requests.get(f"{SERVER_URL}/health", timeout=3)
            replayed = drain(SERVER_URL)
            if replayed:
                print(f"[offline_queue] replayed {replayed} event(s)")
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Login UI
    # ------------------------------------------------------------------

    def _build_login_ui(self) -> None:
        self._login_frame = ctk.CTkFrame(self)
        self._login_frame.pack(expand=True, fill="both", padx=80, pady=50)

        ctk.CTkLabel(
            self._login_frame,
            text="Teacher's Eye",
            font=ctk.CTkFont(size=26, weight="bold"),
        ).pack(pady=(18, 4))

        ctk.CTkLabel(
            self._login_frame,
            text="Введи класс и ФИО, чтобы начать 50-минутную сессию",
            text_color="gray",
        ).pack(pady=(0, 20))

        # Class picker
        ctk.CTkLabel(self._login_frame, text="Класс", text_color="gray",
                     font=ctk.CTkFont(size=12)).pack()
        self._class_combo = ctk.CTkComboBox(
            self._login_frame,
            values=ALL_CLASSES,
            width=280,
        )
        self._class_combo.set(ALL_CLASSES[0] if ALL_CLASSES else "")
        self._class_combo.pack(pady=(2, 10))

        # Name entry
        ctk.CTkLabel(self._login_frame, text="Фамилия Имя", text_color="gray",
                     font=ctk.CTkFont(size=12)).pack()
        self._name_entry = ctk.CTkEntry(
            self._login_frame,
            placeholder_text="Иванов Иван",
            width=280,
        )
        self._name_entry.pack(pady=(2, 14))
        self._name_entry.bind("<Return>", lambda _: self._on_start())

        self._start_btn = ctk.CTkButton(
            self._login_frame,
            text="Войти",
            width=200,
            command=self._on_start,
        )
        self._start_btn.pack(pady=4)

        self._status_label = ctk.CTkLabel(self._login_frame, text="", text_color="gray")
        self._status_label.pack(pady=(10, 0))

    # ------------------------------------------------------------------
    # Code screen — shown between login and the session work panel
    # ------------------------------------------------------------------

    def _build_code_ui(self, display_code: str, class_name: str) -> None:
        """Shows the student their МЭШ-style session code before the work panel opens.

        The teacher sees the same code on the admin dashboard, letting them match the person
        at the desk to the name on screen without any registration flow.
        """
        self._login_frame.destroy()

        self._code_frame = ctk.CTkFrame(self)
        self._code_frame.pack(expand=True, fill="both", padx=80, pady=50)

        ctk.CTkLabel(
            self._code_frame,
            text=class_name,
            font=ctk.CTkFont(size=22, weight="bold"),
            text_color="gray",
        ).pack(pady=(30, 0))

        ctk.CTkLabel(
            self._code_frame,
            text="Твой номер сегодня",
            font=ctk.CTkFont(size=14),
            text_color="gray",
        ).pack(pady=(4, 6))

        # [LOGIC-ANCHOR] МЭШ-style code displayed at 96pt — visible from across the classroom.
        ctk.CTkLabel(
            self._code_frame,
            text=display_code,
            font=ctk.CTkFont(size=96, weight="bold"),
            text_color="#80c8ff",
        ).pack(pady=(0, 10))

        dur_mins = self._session_duration // 60
        ctk.CTkLabel(
            self._code_frame,
            text=f"Покажи этот номер учителю, затем нажми «Начать»\nДлительность сессии: {dur_mins} минут",
            text_color="gray",
            font=ctk.CTkFont(size=13),
            justify="center",
        ).pack(pady=(0, 28))

        ctk.CTkButton(
            self._code_frame,
            text="Начать работу →",
            width=220,
            font=ctk.CTkFont(size=14, weight="bold"),
            command=self._on_code_confirmed,
        ).pack()

    def _on_code_confirmed(self) -> None:
        """Transitions from the code screen to the session work panel."""
        self._code_frame.destroy()
        threading.Thread(target=self._fetch_tasks_and_start, daemon=True).start()

    def _fetch_tasks_and_start(self) -> None:
        try:
            tasks_resp = requests.get(f"{SERVER_URL}/tasks", timeout=5)
            tasks_resp.raise_for_status()
            tasks: list[dict] = tasks_resp.json()
            self.after(0, lambda: self._on_tasks_ready(tasks))
        except Exception as exc:
            self.after(0, lambda: self._show_code_error(str(exc)))

    def _show_code_error(self, msg: str) -> None:
        ctk.CTkLabel(
            self._code_frame,
            text=f"Ошибка загрузки заданий: {msg}",
            text_color="red",
        ).pack(pady=8)

    def _on_tasks_ready(self, tasks: list[dict]) -> None:
        self._build_session_ui(tasks)
        self._timer_running = True
        self._tick()
        self._schedule_ping()
        self._schedule_status_poll()

    # ------------------------------------------------------------------
    # Session UI — top bar + task list + editor + feedback
    # ------------------------------------------------------------------

    def _build_session_ui(self, tasks: list[dict]) -> None:
        self._login_frame.destroy()

        # ── Top bar ────────────────────────────────────────────────────
        top = ctk.CTkFrame(self, height=54, corner_radius=0)
        top.pack(fill="x")
        top.pack_propagate(False)

        ctk.CTkLabel(
            top,
            text="Teacher's Eye",
            font=ctk.CTkFont(size=15, weight="bold"),
        ).pack(side="left", padx=16, pady=12)

        self._timer_label = ctk.CTkLabel(
            top,
            text=self._fmt_time(self._remaining),
            font=ctk.CTkFont(size=20, weight="bold"),
            text_color="#80c8ff",
        )
        self._timer_label.pack(side="right", padx=16, pady=12)

        ctk.CTkLabel(
            top,
            text="Session active  —  close window to hide to tray",
            text_color="gray",
            font=ctk.CTkFont(size=12),
        ).pack(side="right", padx=4, pady=12)

        # ── Main content ───────────────────────────────────────────────
        content = ctk.CTkFrame(self, fg_color="transparent")
        content.pack(expand=True, fill="both", padx=12, pady=10)
        content.columnconfigure(0, weight=0, minsize=250)
        content.columnconfigure(1, weight=1)
        content.rowconfigure(0, weight=1)

        # Left panel — task list
        left = ctk.CTkFrame(content)
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 8))

        ctk.CTkLabel(
            left,
            text="TASKS",
            font=ctk.CTkFont(size=11, weight="bold"),
            text_color="gray",
        ).pack(anchor="w", padx=12, pady=(10, 4))

        self._task_scroll = ctk.CTkScrollableFrame(left, fg_color="transparent")
        self._task_scroll.pack(expand=True, fill="both", padx=4, pady=(0, 8))

        if tasks:
            for task in tasks:
                self._add_task_card(task)
        else:
            ctk.CTkLabel(
                self._task_scroll,
                text="No tasks loaded.\nRun: python -m server.seed",
                text_color="gray",
                justify="center",
            ).pack(pady=20)

        # Right panel — task info + editor + submit + feedback
        right = ctk.CTkFrame(content)
        right.grid(row=0, column=1, sticky="nsew")
        right.columnconfigure(0, weight=1)
        # Row weights: title(0), image(0), editor(1), submit(0), feedback(0)
        right.rowconfigure(2, weight=1)

        self._task_title_label = ctk.CTkLabel(
            right,
            text="← Select a task to begin",
            font=ctk.CTkFont(size=14, weight="bold"),
            anchor="w",
        )
        self._task_title_label.grid(row=0, column=0, sticky="ew", padx=14, pady=(12, 2))

        # Image display area — shows the task screenshot fetched from the server.
        # The inner CTkLabel is updated dynamically when a task is selected.
        self._task_image_frame = ctk.CTkFrame(right, fg_color="transparent")
        self._task_image_frame.grid(row=1, column=0, sticky="ew", padx=14, pady=(0, 6))

        self._task_image_label = ctk.CTkLabel(
            self._task_image_frame,
            image=self._task_image_placeholder,
            text="Выберите задание из списка слева",
            text_color="gray",
            anchor="w",
        )
        self._task_image_label.pack(fill="x")

        self._solution_box = ctk.CTkTextbox(right, state="disabled", wrap="word")
        self._solution_box.grid(row=2, column=0, sticky="nsew", padx=14, pady=(0, 6))

        # [STUB-FOR-VIBE] "Attach file" button will extend this row in Session 4.
        submit_row = ctk.CTkFrame(right, fg_color="transparent")
        submit_row.grid(row=3, column=0, sticky="ew", padx=14, pady=(0, 8))

        self._submit_btn = ctk.CTkButton(
            submit_row,
            text="Submit",
            width=140,
            state="disabled",
            command=self._on_submit,
        )
        self._submit_btn.pack(side="left")

        self._submit_status = ctk.CTkLabel(submit_row, text="", text_color="#4caf50")
        self._submit_status.pack(side="left", padx=12)

        # Feedback panel — hidden until a submission returns
        self._feedback_frame = ctk.CTkFrame(right, fg_color=("gray88", "gray18"))
        # Not gridded yet — shown dynamically via _show_feedback_panel()
        self._feedback_frame.columnconfigure(0, weight=1)

        ctk.CTkLabel(
            self._feedback_frame,
            text="💡  Совет от учителя",
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color=("#1a6fbf", "#80c8ff"),
            anchor="w",
        ).grid(row=0, column=0, sticky="ew", padx=12, pady=(10, 4))

        self._feedback_box = ctk.CTkTextbox(
            self._feedback_frame,
            height=130,
            wrap="word",
            state="disabled",
            font=ctk.CTkFont(size=12),
            fg_color=("gray88", "gray18"),
            border_width=0,
        )
        self._feedback_box.grid(row=1, column=0, sticky="ew", padx=8, pady=(0, 10))

    def _add_task_card(self, task: dict) -> None:
        """Adds a single task button to the scrollable task list."""
        btn = ctk.CTkButton(
            self._task_scroll,
            text=f"[{task['task_type']}]  {task['title'].split('—')[-1].strip()}",
            anchor="w",
            fg_color="transparent",
            hover_color=("gray75", "gray28"),
            text_color=("gray10", "gray90"),
            font=ctk.CTkFont(size=12),
            command=lambda t=task: self._on_task_select(t),
        )
        btn.pack(fill="x", pady=2, padx=2)
        self._task_buttons[task["id"]] = btn

    # ------------------------------------------------------------------
    # Login flow
    # ------------------------------------------------------------------

    def _on_start(self) -> None:
        name = self._name_entry.get().strip()
        class_name = self._class_combo.get().strip().upper()
        if not name:
            self._status_label.configure(text="Введи фамилию и имя.", text_color="orange")
            return
        if not class_name:
            self._status_label.configure(text="Выбери класс.", text_color="orange")
            return

        self._status_label.configure(text="Подключение…", text_color="gray")
        self._start_btn.configure(state="disabled")
        threading.Thread(target=self._do_login, args=(name, class_name), daemon=True).start()

    def _do_login(self, name: str, class_name: str) -> None:
        try:
            login_resp = requests.post(
                f"{SERVER_URL}/login",
                json={"student_name": name, "class_name": class_name},
                timeout=5,
            )
            login_resp.raise_for_status()
            data = login_resp.json()
            self._session_id = data["session_id"]
            self._session_code = data.get("session_code")
            self._session_display_code = data.get("session_display_code", str(data.get("session_code", "")))
            self._class_name = data.get("class_name", class_name)
            # [LOGIC-ANCHOR] Use the duration baked into this specific session by the server.
            # Fallback to the config constant only for pre-Session-10 records (duration_seconds=null).
            self._session_duration = data.get("duration_seconds") or SESSION_DURATION_SECONDS
            self._remaining = self._session_duration
            # #region agent log
            import json, time as _t
            with open("debug-9731b4.log", "a") as _f:
                _f.write(json.dumps({"sessionId":"9731b4","timestamp":int(_t.time()*1000),"location":"app.py:_do_login:duration","message":"duration from login","data":{"raw":data.get("duration_seconds"),"used":self._session_duration,"fallback_const":SESSION_DURATION_SECONDS},"hypothesisId":"E"}) + "\n")
            # #endregion

            self.after(0, self._on_login_success)
        except Exception as exc:
            self.after(0, lambda: self._status_label.configure(
                text=f"Не удалось подключиться: {exc}", text_color="red",
            ))
            self.after(0, lambda: self._start_btn.configure(state="normal"))

    def _on_login_success(self) -> None:
        # [LOGIC-ANCHOR] Show the code screen first; task fetching happens when the student
        # presses "Начать" so they have time to show their МЭШ-style number to the teacher.
        display = self._session_display_code or str(self._session_code or "?")
        self._build_code_ui(display, self._class_name or "")

    # ------------------------------------------------------------------
    # Heartbeat ping
    # ------------------------------------------------------------------

    def _schedule_ping(self) -> None:
        """Schedules the next heartbeat; stops automatically when the session ends."""
        if self._timer_running and self._session_id is not None:
            self.after(_PING_INTERVAL_MS, self._do_ping)

    def _do_ping(self) -> None:
        # [LOGIC-ANCHOR] Fires a lightweight POST /ping so the admin dashboard online indicator
        # stays green for this student. Runs in a daemon thread — never blocks the UI.
        if not self._timer_running or self._session_id is None:
            return
        threading.Thread(target=self._send_ping, daemon=True).start()
        self._schedule_ping()

    def _send_ping(self) -> None:
        try:
            requests.post(
                f"{SERVER_URL}/ping",
                json={"session_id": self._session_id},
                timeout=5,
            )
        except Exception:
            pass  # Silent — a missed ping just makes the student appear offline briefly.

    # ------------------------------------------------------------------
    # Remote session-status polling
    # ------------------------------------------------------------------

    def _schedule_status_poll(self) -> None:
        """Schedules the next server-side session-status check."""
        if self._timer_running and self._session_id is not None:
            self.after(_STATUS_POLL_INTERVAL_MS, self._do_status_poll)

    def _do_status_poll(self) -> None:
        if not self._timer_running or self._session_id is None:
            return
        threading.Thread(target=self._fetch_session_status, daemon=True).start()

    def _fetch_session_status(self) -> None:
        # [LOGIC-ANCHOR] If the teacher terminates the session remotely, the server sets
        # status = "terminated". The next poll detects this and locks the UI immediately,
        # regardless of how much time remains on the local timer.
        try:
            resp = requests.get(
                f"{SERVER_URL}/sessions/{self._session_id}/status",
                timeout=5,
            )
            resp.raise_for_status()
            status = resp.json().get("status", "active")
            if status == "terminated":
                self.after(0, self._on_session_terminated)
            else:
                self.after(0, self._schedule_status_poll)
        except Exception:
            # Network error — keep polling, don't lock the student out.
            self.after(0, self._schedule_status_poll)

    def _on_session_terminated(self) -> None:
        """Locks the UI when the teacher forcibly ends the session."""
        # [LOGIC-ANCHOR] Mirror _on_session_end but with a distinct message so the student
        # knows the teacher closed the session rather than the timer running out.
        self._timer_running = False
        self._submit_btn.configure(state="disabled")
        self._timer_label.configure(text="СТОП", text_color="#ff6b6b")
        self._set_feedback_text(
            "🛑  Учитель завершил сессию досрочно. Подними руку, если есть вопросы.",
            color="#ff6b6b",
        )
        self._feedback_frame.grid(row=4, column=0, sticky="ew", padx=14, pady=(0, 12))

    # ------------------------------------------------------------------
    # Task selection
    # ------------------------------------------------------------------

    def _on_task_select(self, task: dict) -> None:
        # [LOGIC-ANCHOR] Selecting a task activates the solution editor — nothing can be submitted
        # without an active selection, preventing orphaned submissions with no task context.
        for tid, btn in self._task_buttons.items():
            btn.configure(
                fg_color=("#3a7ebf", "#1f538d") if tid == task["id"] else "transparent"
            )

        self._selected_task = task
        self._task_title_label.configure(
            text=f"[{task['task_type']}]  {task['title'].split('—')[-1].strip()}"
        )
        self._solution_box.configure(state="normal")
        self._solution_box.delete("1.0", "end")
        self._submit_btn.configure(state="normal")
        self._submit_status.configure(text="")
        self._hide_feedback_panel()

        # Fetch and display the task screenshot in a background thread.
        self._task_image_label.configure(image=self._task_image_placeholder, text="Загрузка изображения задания…", text_color="gray")
        self._task_image_ref = None
        threading.Thread(target=self._fetch_task_image, args=(task["id"],), daemon=True).start()

    def _fetch_task_image(self, task_id: int) -> None:
        """Downloads the task screenshot from the server and renders it in the image label."""
        try:
            resp = requests.get(f"{SERVER_URL}/tasks/{task_id}/image", timeout=10)
            resp.raise_for_status()
            pil_image = Image.open(io.BytesIO(resp.content)).convert("RGB")
            self.after(0, lambda img=pil_image: self._display_task_image(img))
        except Exception:
            self.after(0, lambda: self._task_image_label.configure(
                image=self._task_image_placeholder,
                text="Не удалось загрузить изображение задания.",
                text_color="orange",
            ))

    def _display_task_image(self, pil_image: Image.Image) -> None:
        """Scales the task image to fit the panel width and updates the label."""
        # [LOGIC-ANCHOR] CTkImage requires explicit light/dark variants; we use the same image for both.
        panel_w = max(self._task_image_frame.winfo_width(), 500)
        w, h = pil_image.size
        scale = min(panel_w / w, 300 / h, 1.0)
        display_w = max(int(w * scale), 1)
        display_h = max(int(h * scale), 1)

        ctk_img = ctk.CTkImage(
            light_image=pil_image,
            dark_image=pil_image,
            size=(display_w, display_h),
        )
        self._task_image_ref = ctk_img
        self._task_image_label.configure(image=ctk_img, text="")

    # ------------------------------------------------------------------
    # Submission
    # ------------------------------------------------------------------

    def _on_submit(self) -> None:
        if self._selected_task is None:
            return
        solution = self._solution_box.get("1.0", "end").strip()
        if not solution:
            self._submit_status.configure(text="Write something first.", text_color="orange")
            return

        self._submit_btn.configure(state="disabled", text="Sending…")
        self._submit_status.configure(text="")
        payload = {
            "session_id": self._session_id,
            "task_id": self._selected_task["id"],
            "solution_text": solution,
        }
        threading.Thread(target=self._do_submit, args=(payload,), daemon=True).start()

    def _do_submit(self, payload: dict) -> None:
        # [LOGIC-ANCHOR] Submission must survive network failures via the offline queue.
        # On success, the returned submission_id is used to poll for AI feedback.
        try:
            resp = requests.post(f"{SERVER_URL}/submissions", json=payload, timeout=5)
            resp.raise_for_status()
            data = resp.json()
            submission_id: int | None = data.get("submission_id")
            self.after(0, lambda: self._on_submit_success(submission_id))
        except Exception:
            enqueue("submission", payload)
            self.after(0, self._on_submit_queued)

    def _on_submit_success(self, submission_id: int | None) -> None:
        self._submit_btn.configure(state="normal", text="Submit")
        self._submit_status.configure(text="Accepted ✓", text_color="#4caf50")
        if submission_id is not None:
            self._start_feedback_polling(submission_id)

    def _on_submit_queued(self) -> None:
        self._submit_btn.configure(state="normal", text="Submit")
        self._submit_status.configure(
            text="Saved offline — will sync when server is back.",
            text_color="orange",
        )

    # ------------------------------------------------------------------
    # AI Feedback polling
    # ------------------------------------------------------------------

    def _start_feedback_polling(self, submission_id: int) -> None:
        """Kicks off the polling cycle for a newly created submission."""
        self._feedback_submission_id = submission_id
        self._feedback_poll_count = 0
        self._show_feedback_loading()
        self._schedule_next_poll()

    def _schedule_next_poll(self) -> None:
        """Schedules a single poll attempt on the Tk event loop."""
        self.after(_FEEDBACK_POLL_INTERVAL_MS, self._do_feedback_poll)

    def _do_feedback_poll(self) -> None:
        """Fires one feedback check in a daemon thread, then schedules the next if needed."""
        self._feedback_poll_count += 1
        threading.Thread(target=self._fetch_feedback, daemon=True).start()

    def _fetch_feedback(self) -> None:
        # [AI-INTERACTION] Polls the server until ai_feedback is populated by the background Gemini task.
        submission_id = self._feedback_submission_id
        if submission_id is None:
            return
        try:
            resp = requests.get(
                f"{SERVER_URL}/submissions/{submission_id}/feedback",
                timeout=5,
            )
            resp.raise_for_status()
            data = resp.json()

            if data.get("ready"):
                feedback_text: str = data["feedback"]
                self.after(0, lambda: self._show_feedback(feedback_text))
            elif self._feedback_poll_count < _FEEDBACK_MAX_POLLS:
                # Not ready yet — schedule another poll.
                self.after(0, self._schedule_next_poll)
            else:
                # [VIBE-CHECK] Poll timeout — show offline stub. Consider a "Retry" button here.
                self.after(0, self._show_feedback_offline)
        except Exception:
            if self._feedback_poll_count < _FEEDBACK_MAX_POLLS:
                self.after(0, self._schedule_next_poll)
            else:
                self.after(0, self._show_feedback_offline)

    # ------------------------------------------------------------------
    # Feedback panel helpers
    # ------------------------------------------------------------------

    def _show_feedback_loading(self) -> None:
        """Shows the feedback panel with a loading indicator."""
        self._set_feedback_text("⏳  Получаю совет от учителя…", color="gray")
        self._feedback_frame.grid(row=4, column=0, sticky="ew", padx=14, pady=(0, 12))

    def _show_feedback(self, text: str) -> None:
        """Populates the feedback panel with the AI-generated hint."""
        self._set_feedback_text(text, color=("gray10", "gray90"))

    def _show_feedback_offline(self) -> None:
        """Shows a fallback message when the server is unreachable or Gemini is slow."""
        self._set_feedback_text(
            "⚠️  Совет загрузится, как только появится сеть. "
            "Попробуй отправить решение ещё раз, когда подключение восстановится.",
            color="orange",
        )

    def _hide_feedback_panel(self) -> None:
        """Removes the feedback panel from the grid (called on task switch)."""
        try:
            self._feedback_frame.grid_remove()
        except Exception:
            pass
        self._feedback_submission_id = None

    def _set_feedback_text(self, text: str, color: str | tuple) -> None:
        self._feedback_box.configure(state="normal")
        self._feedback_box.delete("1.0", "end")
        self._feedback_box.insert("1.0", text)
        self._feedback_box.configure(state="disabled", text_color=color)

    # ------------------------------------------------------------------
    # Timer
    # ------------------------------------------------------------------

    def _tick(self) -> None:
        # [LOGIC-ANCHOR] Drives the 50-minute countdown on the Tk thread — no race conditions,
        # all GUI mutations happen in the event loop that owns the widgets.
        if not self._timer_running:
            return
        if self._remaining > 0:
            self._remaining -= 1
            self._timer_label.configure(text=self._fmt_time(self._remaining))
            self.after(1000, self._tick)
        else:
            self._on_session_end()

    def _on_session_end(self) -> None:
        # [LOGIC-ANCHOR] Timer reached zero — lock the submission panel and notify the server.
        self._timer_running = False
        self._submit_btn.configure(state="disabled")
        self._timer_label.configure(text="00:00", text_color="#ff6b6b")
        threading.Thread(target=self._post_session_end, daemon=True).start()

    def _post_session_end(self) -> None:
        """Posts /sessions/end; falls back to the offline queue on network failure."""
        if self._session_id is None:
            return
        payload = {"session_id": self._session_id}
        try:
            requests.post(f"{SERVER_URL}/sessions/end", json=payload, timeout=5)
        except Exception:
            enqueue("session_end", payload)

    # ------------------------------------------------------------------
    # Tray
    # ------------------------------------------------------------------

    def _minimize_to_tray(self) -> None:
        # [LOGIC-ANCHOR] Withdraw instead of destroy — timer loop and feedback polling stay alive
        # so the student can return from the tray without losing their session state.
        self.withdraw()
        if self._tray is None:
            self._tray = _build_tray(self)
            threading.Thread(target=self._tray.run, daemon=True).start()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _fmt_time(seconds: int) -> str:
        m, s = divmod(seconds, 60)
        return f"{m:02d}:{s:02d}"


if __name__ == "__main__":
    app = TeacherEyeApp()
    app.mainloop()
