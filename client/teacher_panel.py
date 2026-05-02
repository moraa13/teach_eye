# [VIBE-CONTEXT]
# Role: Teacher-facing desktop panel for uploading and managing EGE tasks in Teacher's Eye.
# State: Session 6 — password guard on startup; task bank list with delete added in Session 5.
# Why: Keeping the teacher UI as a separate CustomTkinter window mirrors the student app's
#      pattern and avoids shipping teacher-only controls inside the student client.

"""
Usage (run from the project root while the server is running):

    python -m client.teacher_panel
"""

import base64
import io
import sys
import threading
from tkinter import filedialog

import customtkinter as ctk
import requests
from PIL import Image, ImageGrab, ImageTk

from shared.config import check_admin_password, SERVER_URL, SESSION_DURATION_SECONDS


# ---------------------------------------------------------------------------
# Auth guard — shown before the main window is created
# ---------------------------------------------------------------------------

def _require_password(app_name: str) -> None:
    """Shows a blocking password dialog; exits the process on cancel or wrong password.

    Uses a temporary hidden root so the dialog appears before the main window opens.
    The candidate is hashed before comparison — the raw input is never stored.
    """
    guard = ctk.CTk()
    guard.withdraw()
    dialog = ctk.CTkInputDialog(
        text=f"Введите пароль для доступа к {app_name}:",
        title="Teacher's Eye — Доступ",
    )
    candidate = dialog.get_input()
    guard.destroy()

    if candidate is None:
        sys.exit(0)

    # [LOGIC-ANCHOR] Hash comparison — the plain-text candidate is never stored or logged.
    if not check_admin_password(candidate):
        err = ctk.CTk()
        err.withdraw()
        msg = ctk.CTkToplevel(err)
        msg.title("Неверный пароль")
        msg.geometry("320x120")
        ctk.CTkLabel(msg, text="Неверный пароль. Приложение закроется.", text_color="red").pack(pady=30)
        ctk.CTkButton(msg, text="ОК", command=lambda: sys.exit(1)).pack()
        msg.mainloop()
        sys.exit(1)

_TASK_TYPES = ["EGE_17", "EGE_19", "EGE_24", "EGE_25", "EGE_26", "Другое"]
_DURATION_OPTIONS = [20, 25, 30, 35, 40, 45, 50, 60]  # minutes
_PREVIEW_MAX_W = 560
_PREVIEW_MAX_H = 260


class TeacherPanel(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Teacher's Eye — Панель учителя")
        self.geometry("820x920")
        self.minsize(700, 780)
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self._pasted_image: Image.Image | None = None
        self._preview_photo: ImageTk.PhotoImage | None = None

        self._build_ui()

        # Ctrl+V works anywhere in the window, not just the paste zone.
        self.bind("<Control-v>", self._on_paste)

        # Load the task bank as soon as the window opens.
        threading.Thread(target=self._refresh_task_list, daemon=True).start()

    # ------------------------------------------------------------------
    # UI construction
    # ------------------------------------------------------------------

    def _build_ui(self) -> None:
        wrapper = ctk.CTkFrame(self, fg_color="transparent")
        wrapper.pack(expand=True, fill="both", padx=24, pady=20)

        ctk.CTkLabel(
            wrapper,
            text="Панель учителя",
            font=ctk.CTkFont(size=22, weight="bold"),
        ).pack(anchor="w", pady=(0, 2))

        ctk.CTkLabel(
            wrapper,
            text="Сервер: " + SERVER_URL,
            text_color="gray",
            font=ctk.CTkFont(size=11),
        ).pack(anchor="w", pady=(0, 10))

        # ── Session duration picker ────────────────────────────────────
        dur_frame = ctk.CTkFrame(wrapper)
        dur_frame.pack(fill="x", pady=(0, 14))

        ctk.CTkLabel(
            dur_frame,
            text="Длительность сессии",
            font=ctk.CTkFont(size=14, weight="bold"),
        ).pack(anchor="w", padx=14, pady=(10, 6))

        dur_inner = ctk.CTkFrame(dur_frame, fg_color="transparent")
        dur_inner.pack(fill="x", padx=14, pady=(0, 12))

        # Button strip — one button per option, highlighted when selected.
        self._dur_buttons: dict[int, ctk.CTkButton] = {}
        btn_row = ctk.CTkFrame(dur_inner, fg_color="transparent")
        btn_row.pack(anchor="w")
        for mins in _DURATION_OPTIONS:
            secs = mins * 60
            b = ctk.CTkButton(
                btn_row,
                text=f"{mins} мин",
                width=72,
                height=30,
                fg_color="transparent",
                border_width=1,
                command=lambda s=secs: self._on_duration_select(s),
            )
            b.pack(side="left", padx=(0, 6))
            self._dur_buttons[secs] = b

        dur_status_row = ctk.CTkFrame(dur_inner, fg_color="transparent")
        dur_status_row.pack(fill="x", pady=(8, 0))

        self._dur_status = ctk.CTkLabel(
            dur_status_row, text="Загрузка…", text_color="gray", font=ctk.CTkFont(size=11)
        )
        self._dur_status.pack(side="left")

        self._dur_apply_btn = ctk.CTkButton(
            dur_status_row,
            text="Применить",
            width=110,
            height=28,
            state="disabled",
            command=self._on_duration_apply,
        )
        self._dur_apply_btn.pack(side="right")

        self._pending_duration: int | None = None

        # Fetch the current configured duration from server.
        threading.Thread(target=self._fetch_current_duration, daemon=True).start()

        # ── Upload form ────────────────────────────────────────────────
        upload_frame = ctk.CTkFrame(wrapper)
        upload_frame.pack(fill="x", pady=(0, 16))

        ctk.CTkLabel(
            upload_frame,
            text="Загрузить новое задание",
            font=ctk.CTkFont(size=14, weight="bold"),
        ).pack(anchor="w", padx=14, pady=(12, 8))

        inner = ctk.CTkFrame(upload_frame, fg_color="transparent")
        inner.pack(fill="x", padx=14, pady=(0, 14))

        ctk.CTkLabel(inner, text="Название задания", anchor="w").pack(fill="x")
        self._title_entry = ctk.CTkEntry(inner, placeholder_text="Например: Задание 17 — Рекурсия")
        self._title_entry.pack(fill="x", pady=(4, 10))

        ctk.CTkLabel(inner, text="Тип задания (ЕГЭ)", anchor="w").pack(fill="x")
        self._type_var = ctk.StringVar(value=_TASK_TYPES[0])
        self._type_menu = ctk.CTkOptionMenu(inner, values=_TASK_TYPES, variable=self._type_var)
        self._type_menu.pack(anchor="w", pady=(4, 10))

        ctk.CTkLabel(inner, text="Скриншот задания", anchor="w").pack(fill="x")
        self._paste_zone = ctk.CTkFrame(
            inner,
            height=_PREVIEW_MAX_H,
            fg_color=("gray80", "gray20"),
            corner_radius=8,
        )
        self._paste_zone.pack(fill="x", pady=(4, 4))
        self._paste_zone.pack_propagate(False)
        self._canvas = ctk.CTkCanvas(self._paste_zone, bg="#2b2b2b", highlightthickness=0)
        self._canvas.pack(expand=True, fill="both")
        self._canvas.bind("<Button-1>", lambda _: self.focus_set())
        self._draw_paste_hint()

        hint_row = ctk.CTkFrame(inner, fg_color="transparent")
        hint_row.pack(fill="x", pady=(2, 8))

        ctk.CTkLabel(
            hint_row,
            text="Ctrl+V — вставить скриншот из буфера",
            text_color="gray",
            font=ctk.CTkFont(size=11),
        ).pack(side="left")

        ctk.CTkButton(
            hint_row,
            text="📁  Открыть файл",
            width=150,
            height=26,
            fg_color="transparent",
            border_width=1,
            font=ctk.CTkFont(size=11),
            command=self._on_open_file,
        ).pack(side="right")

        ctk.CTkLabel(inner, text="Правильное решение (код учителя)", anchor="w").pack(fill="x")
        self._solution_box = ctk.CTkTextbox(inner, height=130, wrap="none")
        self._solution_box.pack(fill="x", pady=(4, 12))

        submit_row = ctk.CTkFrame(inner, fg_color="transparent")
        submit_row.pack(fill="x")

        self._submit_btn = ctk.CTkButton(
            submit_row,
            text="Загрузить задание",
            width=200,
            command=self._on_submit,
        )
        self._submit_btn.pack(side="left")

        self._status_label = ctk.CTkLabel(submit_row, text="", text_color="gray")
        self._status_label.pack(side="left", padx=14)

        # ── Task bank ─────────────────────────────────────────────────
        bank_frame = ctk.CTkFrame(wrapper)
        bank_frame.pack(fill="both", expand=True)

        bank_header = ctk.CTkFrame(bank_frame, fg_color="transparent")
        bank_header.pack(fill="x", padx=14, pady=(12, 6))

        ctk.CTkLabel(
            bank_header,
            text="Банк заданий",
            font=ctk.CTkFont(size=14, weight="bold"),
        ).pack(side="left")

        ctk.CTkButton(
            bank_header,
            text="Обновить",
            width=100,
            fg_color="transparent",
            border_width=1,
            command=lambda: threading.Thread(target=self._refresh_task_list, daemon=True).start(),
        ).pack(side="right")

        self._task_scroll = ctk.CTkScrollableFrame(bank_frame, fg_color="transparent")
        self._task_scroll.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        self._task_list_placeholder = ctk.CTkLabel(
            self._task_scroll,
            text="Задания ещё не загружены.",
            text_color="gray",
        )
        self._task_list_placeholder.pack(pady=12)

    # ------------------------------------------------------------------
    # Duration picker
    # ------------------------------------------------------------------

    def _fetch_current_duration(self) -> None:
        """Loads the currently configured session duration from the server."""
        try:
            resp = requests.get(f"{SERVER_URL}/config/session_duration", timeout=5)
            resp.raise_for_status()
            secs = resp.json().get("duration_seconds", SESSION_DURATION_SECONDS)
            # #region agent log
            import json, time
            with open("debug-9731b4.log", "a") as _f:
                _f.write(json.dumps({"sessionId":"9731b4","timestamp":int(time.time()*1000),"location":"teacher_panel.py:_fetch_current_duration:ok","message":"duration fetched ok","data":{"secs":secs},"hypothesisId":"B"}) + "\n")
            # #endregion
            self.after(0, lambda s=secs: self._apply_duration_ui(s, pending=False))
        except Exception as exc:
            # #region agent log
            import json, time
            with open("debug-9731b4.log", "a") as _f:
                _f.write(json.dumps({"sessionId":"9731b4","timestamp":int(time.time()*1000),"location":"teacher_panel.py:_fetch_current_duration:exc","message":"duration fetch failed","data":{"exc_type":type(exc).__name__,"exc_str":str(exc)[:300]},"hypothesisId":"B"}) + "\n")
            # #endregion
            self.after(0, lambda: self._dur_status.configure(
                text="Не удалось получить настройку с сервера.", text_color="orange"
            ))

    def _on_duration_select(self, duration_seconds: int) -> None:
        """Highlights the chosen button and arms the Apply button."""
        self._pending_duration = duration_seconds
        for secs, btn in self._dur_buttons.items():
            btn.configure(
                fg_color=("#3a7ebf", "#1f538d") if secs == duration_seconds else "transparent"
            )
        mins = duration_seconds // 60
        self._dur_status.configure(
            text=f"Выбрано: {mins} мин — нажми «Применить» чтобы сохранить.",
            text_color="gray",
        )
        self._dur_apply_btn.configure(state="normal")

    def _on_duration_apply(self) -> None:
        """Sends the chosen duration to the server."""
        if self._pending_duration is None:
            return
        self._dur_apply_btn.configure(state="disabled", text="Сохранение…")
        threading.Thread(
            target=self._do_apply_duration,
            args=(self._pending_duration,),
            daemon=True,
        ).start()

    def _do_apply_duration(self, duration_seconds: int) -> None:
        # [LOGIC-ANCHOR] POST /config/session_duration — only affects sessions started AFTER this call.
        try:
            resp = requests.post(
                f"{SERVER_URL}/config/session_duration",
                json={"duration_seconds": duration_seconds},
                timeout=5,
            )
            resp.raise_for_status()
            secs = resp.json().get("duration_seconds", duration_seconds)
            # #region agent log
            import json, time
            with open("debug-9731b4.log", "a") as _f:
                _f.write(json.dumps({"sessionId":"9731b4","timestamp":int(time.time()*1000),"location":"teacher_panel.py:_do_apply_duration:ok","message":"apply ok","data":{"secs":secs,"pending":self._pending_duration},"hypothesisId":"D"}) + "\n")
            # #endregion
            self.after(0, lambda s=secs: self._apply_duration_ui(s, pending=False))
        except Exception as exc:
            # #region agent log
            import json, time
            with open("debug-9731b4.log", "a") as _f:
                _f.write(json.dumps({"sessionId":"9731b4","timestamp":int(time.time()*1000),"location":"teacher_panel.py:_do_apply_duration:exc","message":"apply failed","data":{"exc_type":type(exc).__name__,"exc_len":len(str(exc)),"exc_preview":str(exc)[:120],"pending":self._pending_duration},"hypothesisId":"A,D"}) + "\n")
            # #endregion
            self.after(0, lambda e=exc: self._dur_status.configure(
                text=f"Ошибка: {e}", text_color="red"
            ))
            self.after(0, lambda: self._dur_apply_btn.configure(
                state="normal", text="Применить"
            ))

    def _apply_duration_ui(self, duration_seconds: int, pending: bool) -> None:
        """Updates buttons and status to reflect the server-confirmed duration."""
        for secs, btn in self._dur_buttons.items():
            btn.configure(
                fg_color=("#3a7ebf", "#1f538d") if secs == duration_seconds else "transparent"
            )
        mins = duration_seconds // 60
        self._dur_status.configure(
            text=f"Текущая настройка: {mins} мин. Студенты получат эту длительность при входе.",
            text_color="#4caf50" if not pending else "gray",
        )
        self._dur_apply_btn.configure(state="disabled", text="Применить")
        self._pending_duration = None

    # ------------------------------------------------------------------
    # Paste logic
    # ------------------------------------------------------------------

    def _on_open_file(self) -> None:
        """Opens a native file dialog to load a task screenshot from disk.

        Alternative to Ctrl+V for environments where the clipboard doesn't bridge
        to the OS (e.g. running inside WSL or a remote session).
        """
        path = filedialog.askopenfilename(
            title="Выберите изображение задания",
            filetypes=[
                ("Изображения", "*.png *.jpg *.jpeg *.bmp *.gif *.webp"),
                ("Все файлы", "*.*"),
            ],
        )
        if not path:
            return  # Dialog cancelled — do nothing.
        try:
            img = Image.open(path).convert("RGB")
        except Exception as exc:
            self._status_label.configure(
                text=f"Не удалось открыть файл: {exc}", text_color="orange"
            )
            return
        self._pasted_image = img
        self._status_label.configure(text="", text_color="gray")
        self._show_preview(self._pasted_image)

    def _on_paste(self, _event=None) -> None:
        """Grabs the current clipboard image and displays a preview."""
        img = ImageGrab.grabclipboard()
        if img is None:
            self._status_label.configure(
                text="В буфере обмена нет изображения. Сначала сделайте скриншот.",
                text_color="orange",
            )
            return
        if not isinstance(img, Image.Image):
            self._status_label.configure(
                text="Буфер содержит не изображение. Скопируйте скриншот задания.",
                text_color="orange",
            )
            return

        self._pasted_image = img.convert("RGB")
        self._status_label.configure(text="", text_color="gray")
        self._show_preview(self._pasted_image)

    def _draw_paste_hint(self) -> None:
        self._canvas.delete("all")
        self._canvas.create_text(
            _PREVIEW_MAX_W // 2,
            _PREVIEW_MAX_H // 2,
            text="Нажмите  Ctrl + V  чтобы вставить скриншот задания",
            fill="#666666",
            font=("Arial", 13),
            anchor="center",
        )

    def _show_preview(self, img: Image.Image) -> None:
        w, h = img.size
        scale = min(_PREVIEW_MAX_W / w, _PREVIEW_MAX_H / h, 1.0)
        preview = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        self._preview_photo = ImageTk.PhotoImage(preview)
        self._canvas.delete("all")
        self._canvas.create_image(
            _PREVIEW_MAX_W // 2,
            _PREVIEW_MAX_H // 2,
            image=self._preview_photo,
            anchor="center",
        )

    # ------------------------------------------------------------------
    # Upload
    # ------------------------------------------------------------------

    def _on_submit(self) -> None:
        title = self._title_entry.get().strip()
        if not title:
            self._status_label.configure(text="Введите название задания.", text_color="orange")
            return
        if self._pasted_image is None:
            self._status_label.configure(text="Вставьте скриншот задания (Ctrl+V).", text_color="orange")
            return

        self._submit_btn.configure(state="disabled", text="Отправка…")
        self._status_label.configure(text="", text_color="gray")
        threading.Thread(target=self._do_upload, daemon=True).start()

    def _do_upload(self) -> None:
        title = self._title_entry.get().strip()
        task_type = self._type_var.get()
        solution_code = self._solution_box.get("1.0", "end").strip()

        buf = io.BytesIO()
        self._pasted_image.save(buf, format="PNG")
        image_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        payload = {
            "title": title,
            "task_type": task_type,
            "image_b64": image_b64,
            "solution_code": solution_code,
        }

        try:
            resp = requests.post(f"{SERVER_URL}/tasks", json=payload, timeout=15)
            resp.raise_for_status()
            task_id = resp.json().get("task_id", "?")
            self.after(0, lambda: self._on_upload_success(task_id))
        except Exception as exc:
            self.after(0, lambda: self._on_upload_error(str(exc)))

    def _on_upload_success(self, task_id: int) -> None:
        self._submit_btn.configure(state="normal", text="Загрузить задание")
        self._status_label.configure(
            text=f"Задание #{task_id} загружено ✓  —  ИИ анализирует задачу в фоне…",
            text_color="#4caf50",
        )
        self._title_entry.delete(0, "end")
        self._solution_box.delete("1.0", "end")
        self._pasted_image = None
        self._preview_photo = None
        self._draw_paste_hint()
        threading.Thread(target=self._refresh_task_list, daemon=True).start()

    def _on_upload_error(self, error: str) -> None:
        self._submit_btn.configure(state="normal", text="Загрузить задание")
        self._status_label.configure(text=f"Ошибка: {error}", text_color="red")

    # ------------------------------------------------------------------
    # Task bank list
    # ------------------------------------------------------------------

    def _refresh_task_list(self) -> None:
        """Fetches the task list from the server and rebuilds the bank UI."""
        try:
            resp = requests.get(f"{SERVER_URL}/tasks", timeout=5)
            resp.raise_for_status()
            tasks = resp.json()
            self.after(0, lambda t=tasks: self._render_task_list(t))
        except Exception as exc:
            self.after(0, lambda: self._render_task_list_error(str(exc)))

    def _render_task_list(self, tasks: list[dict]) -> None:
        for widget in self._task_scroll.winfo_children():
            widget.destroy()

        if not tasks:
            ctk.CTkLabel(
                self._task_scroll,
                text="Задания ещё не загружены.",
                text_color="gray",
            ).pack(pady=12)
            return

        for task in tasks:
            self._add_task_row(task)

    def _render_task_list_error(self, error: str) -> None:
        for widget in self._task_scroll.winfo_children():
            widget.destroy()
        ctk.CTkLabel(
            self._task_scroll,
            text=f"Не удалось загрузить список: {error}",
            text_color="orange",
        ).pack(pady=12)

    def _add_task_row(self, task: dict) -> None:
        """Renders a single task row with title, analysis indicator, and delete button."""
        row = ctk.CTkFrame(self._task_scroll, fg_color=("gray88", "gray18"), corner_radius=6)
        row.pack(fill="x", pady=3, padx=2)

        analysis_dot = "🟢" if task.get("analysis_ready") else "🟡"
        ctk.CTkLabel(
            row,
            text=f"{analysis_dot}  [{task['task_type']}]  {task['title']}",
            anchor="w",
            font=ctk.CTkFont(size=12),
        ).pack(side="left", padx=12, pady=8, fill="x", expand=True)

        # [VIBE-CHECK] Delete is irreversible (except the DB) — no confirmation dialog here,
        # but the task is only unlinked from submissions, never deleted student work.
        ctk.CTkButton(
            row,
            text="Удалить",
            width=80,
            height=28,
            fg_color="#c0392b",
            hover_color="#922b21",
            font=ctk.CTkFont(size=11),
            command=lambda tid=task["id"]: self._on_delete_task(tid),
        ).pack(side="right", padx=10, pady=6)

    def _on_delete_task(self, task_id: int) -> None:
        threading.Thread(target=self._do_delete_task, args=(task_id,), daemon=True).start()

    def _do_delete_task(self, task_id: int) -> None:
        try:
            resp = requests.delete(f"{SERVER_URL}/tasks/{task_id}", timeout=5)
            resp.raise_for_status()
            self.after(0, lambda: threading.Thread(target=self._refresh_task_list, daemon=True).start())
        except Exception as exc:
            self.after(0, lambda: self._status_label.configure(
                text=f"Ошибка удаления: {exc}", text_color="red"
            ))


if __name__ == "__main__":
    _require_password("панели учителя")
    app = TeacherPanel()
    app.mainloop()
