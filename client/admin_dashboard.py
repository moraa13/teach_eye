# [VIBE-CONTEXT]
# Role: Real-time admin dashboard for Teacher's Eye — class overview, remote session control,
#       and CSV export.
# State: Session 10 — "Осталось" column shows time remaining per student; class separators
#        group rows visually so the teacher can quickly scan the class they're working with.
# Why: CustomTkinter keeps the stack homogeneous (no web server needed); auto-refresh
#      gives the teacher a live class overview without manual reloads.

"""
Usage (run from the project root while the server is running):

    python -m client.admin_dashboard
"""

import datetime as dt
import os
import sys
import threading

import customtkinter as ctk
import requests

from shared.config import check_admin_password, SERVER_URL, SESSION_DURATION_SECONDS

_REFRESH_INTERVAL_MS = 15_000
_ONLINE_COLOR  = "#4caf50"
_OFFLINE_COLOR = "#e74c3c"
_WORKING_COLOR = "#f39c12"
_DONE_COLOR    = "#4caf50"

# Best readable monospace font per platform — Consolas on Windows, fallback to Courier New.
_CODE_FONT = ctk.CTkFont(
    family="Consolas" if sys.platform == "win32" else "DejaVu Sans Mono",
    size=13,
)


# ---------------------------------------------------------------------------
# Auth guard
# ---------------------------------------------------------------------------

def _require_password() -> None:
    """Blocking password dialog before the main window opens. Exits on wrong password."""
    guard = ctk.CTk()
    guard.withdraw()
    dialog = ctk.CTkInputDialog(
        text="Введите пароль для доступа к панели администратора:",
        title="Teacher's Eye — Доступ",
    )
    candidate = dialog.get_input()
    guard.destroy()

    if candidate is None:
        sys.exit(0)

    # [LOGIC-ANCHOR] Hash comparison — plain-text candidate is never stored or logged.
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


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

class AdminDashboard(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Teacher's Eye — Обзор класса")
        self.geometry("1160x700")
        self.minsize(960, 560)
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self._selected_row: dict | None = None
        self._row_frames: list[ctk.CTkFrame] = []

        self._build_ui()
        self._load_stats()
        self._schedule_refresh()


    # ------------------------------------------------------------------
    # UI construction
    # ------------------------------------------------------------------

    def _build_ui(self) -> None:
        # ── Top bar ────────────────────────────────────────────────────
        top = ctk.CTkFrame(self, height=50, corner_radius=0)
        top.pack(fill="x")
        top.pack_propagate(False)

        ctk.CTkLabel(
            top,
            text="Teacher's Eye — Обзор класса",
            font=ctk.CTkFont(size=15, weight="bold"),
        ).pack(side="left", padx=16, pady=10)

        self._last_updated_label = ctk.CTkLabel(
            top, text="", text_color="gray", font=ctk.CTkFont(size=11)
        )
        self._last_updated_label.pack(side="right", padx=16)

        ctk.CTkButton(
            top, text="Обновить", width=110, height=32,
            fg_color="transparent", border_width=1,
            command=self._load_stats,
        ).pack(side="right", padx=4, pady=9)

        ctk.CTkButton(
            top, text="Экспорт в CSV", width=130, height=32,
            fg_color="transparent", border_width=1,
            command=self._export_csv,
        ).pack(side="right", padx=4, pady=9)

        # ── Main split ─────────────────────────────────────────────────
        content = ctk.CTkFrame(self, fg_color="transparent")
        content.pack(expand=True, fill="both", padx=10, pady=8)
        content.columnconfigure(0, weight=0, minsize=430)
        content.columnconfigure(1, weight=1)
        content.rowconfigure(0, weight=1)

        # Left — student table
        left = ctk.CTkFrame(content)
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        left.rowconfigure(1, weight=1)
        left.columnconfigure(0, weight=1)

        header = ctk.CTkFrame(left, fg_color=("gray75", "gray25"), corner_radius=0)
        header.grid(row=0, column=0, sticky="ew")
        for col, (label, w) in enumerate([
            ("", 18), ("Код", 60), ("Ученик / Класс", 140), ("Задание", 90), ("Статус", 62), ("Осталось", 64), ("В сети", 64),
        ]):
            ctk.CTkLabel(
                header, text=label,
                font=ctk.CTkFont(size=11, weight="bold"),
                text_color="gray", width=w, anchor="w",
            ).grid(row=0, column=col, padx=(8 if col == 0 else 4, 4), pady=6, sticky="w")

        self._student_scroll = ctk.CTkScrollableFrame(left, fg_color="transparent")
        self._student_scroll.grid(row=1, column=0, sticky="nsew")

        # Right — detail panel
        right = ctk.CTkFrame(content)
        right.grid(row=0, column=1, sticky="nsew")
        right.columnconfigure(0, weight=1)
        # row 4 (code box) takes most space; row 6 (AI feedback) also grows
        right.rowconfigure(4, weight=3)
        right.rowconfigure(6, weight=1)

        # ── Row 0: name label + history button side-by-side ──────────
        header_row = ctk.CTkFrame(right, fg_color="transparent")
        header_row.grid(row=0, column=0, sticky="ew", padx=14, pady=(12, 2))
        header_row.columnconfigure(0, weight=1)

        self._detail_name = ctk.CTkLabel(
            header_row, text="← Нажмите на ученика",
            font=ctk.CTkFont(size=14, weight="bold"), anchor="w",
        )
        self._detail_name.grid(row=0, column=0, sticky="ew")

        self._history_btn = ctk.CTkButton(
            header_row,
            text="📋  История",
            width=120, height=28,
            fg_color="transparent", border_width=1,
            state="disabled",
            command=self._open_history_window,
        )
        self._history_btn.grid(row=0, column=1, sticky="e", padx=(10, 0))

        # ── Row 1: session meta ───────────────────────────────────────
        self._detail_meta = ctk.CTkLabel(
            right, text="", text_color="gray", anchor="w", font=ctk.CTkFont(size=11)
        )
        self._detail_meta.grid(row=1, column=0, sticky="ew", padx=14, pady=(0, 4))

        # ── Row 2: actions ────────────────────────────────────────────
        self._terminate_btn = ctk.CTkButton(
            right,
            text="🛑  Завершить сессию",
            width=200, height=30,
            fg_color="#c0392b", hover_color="#922b21",
            state="disabled",
            command=self._on_terminate,
        )
        self._terminate_btn.grid(row=2, column=0, sticky="w", padx=14, pady=(0, 8))

        # ── Row 3: code section label ─────────────────────────────────
        ctk.CTkLabel(
            right, text="КОД УЧЕНИКА",
            font=ctk.CTkFont(size=10, weight="bold"), text_color="gray", anchor="w",
        ).grid(row=3, column=0, sticky="ew", padx=14, pady=(0, 2))

        # ── Row 4: code viewer (expands) ──────────────────────────────
        self._code_box = ctk.CTkTextbox(
            right, state="disabled", wrap="none",
            font=_CODE_FONT,
        )
        self._code_box.grid(row=4, column=0, sticky="nsew", padx=14, pady=(0, 6))

        # ── Row 5: AI feedback label ──────────────────────────────────
        ctk.CTkLabel(
            right, text="СОВЕТ ОТ ИИ",
            font=ctk.CTkFont(size=10, weight="bold"), text_color="gray", anchor="w",
        ).grid(row=5, column=0, sticky="ew", padx=14, pady=(4, 2))

        # ── Row 6: AI feedback box ────────────────────────────────────
        self._feedback_box = ctk.CTkTextbox(
            right, state="disabled", wrap="word", height=110, font=ctk.CTkFont(size=12)
        )
        self._feedback_box.grid(row=6, column=0, sticky="nsew", padx=14, pady=(0, 12))

    # ------------------------------------------------------------------
    # Data loading & auto-refresh
    # ------------------------------------------------------------------

    def _schedule_refresh(self) -> None:
        self.after(_REFRESH_INTERVAL_MS, self._auto_refresh)

    def _auto_refresh(self) -> None:
        self._load_stats()
        self._schedule_refresh()

    def _load_stats(self) -> None:
        threading.Thread(target=self._fetch_stats, daemon=True).start()

    def _fetch_stats(self) -> None:
        try:
            resp = requests.get(f"{SERVER_URL}/admin/stats", timeout=8)
            resp.raise_for_status()
            self.after(0, lambda d=resp.json(): self._render_stats(d))
        except Exception as exc:
            self.after(0, lambda: self._last_updated_label.configure(
                text=f"Ошибка: {exc}", text_color="red"
            ))

    # ------------------------------------------------------------------
    # Rendering
    # ------------------------------------------------------------------

    def _render_stats(self, rows: list[dict]) -> None:
        for w in self._student_scroll.winfo_children():
            w.destroy()
        self._row_frames.clear()

        if not rows:
            ctk.CTkLabel(
                self._student_scroll, text="Нет студентов с сессиями.", text_color="gray"
            ).pack(pady=20)
        else:
            # [LOGIC-ANCHOR] Rows are pre-sorted by class_name on the server; we insert a
            # visual separator header each time the class changes so the teacher can scan
            # one class at a time without reading the sub-labels on every row.
            current_class: str | None = None
            for row_data in rows:
                cls = row_data.get("class_name") or ""
                if cls != current_class:
                    current_class = cls
                    self._add_class_separator(cls)
                self._add_student_row(row_data)

        now_str = dt.datetime.now().strftime("%H:%M:%S")
        self._last_updated_label.configure(text=f"Обновлено: {now_str}", text_color="gray")

        # Refresh detail panel if a student is already selected.
        if self._selected_row is not None:
            sel_id = self._selected_row.get("student_id")
            updated = next((r for r in rows if r["student_id"] == sel_id), None)
            if updated:
                self._selected_row = updated
                self._render_detail(updated)

    def _add_class_separator(self, class_name: str) -> None:
        """Renders a coloured header strip between class groups in the student list."""
        label = class_name if class_name else "Без класса"
        sep = ctk.CTkFrame(
            self._student_scroll,
            fg_color=("#1f538d", "#1a3a5c"),
            corner_radius=3,
            height=24,
        )
        sep.pack(fill="x", padx=2, pady=(6, 1))
        sep.pack_propagate(False)
        ctk.CTkLabel(
            sep,
            text=f"  {label}",
            font=ctk.CTkFont(size=11, weight="bold"),
            text_color="#80c8ff",
            anchor="w",
        ).pack(side="left", padx=6, pady=2)

    def _add_student_row(self, row: dict) -> None:
        is_online     = row.get("online", False)
        has_sub       = row.get("solution_text") is not None
        sess_active   = row.get("session_status") == "active"
        sess_term     = row.get("session_status") == "terminated"

        dot_color = _ONLINE_COLOR if is_online else _OFFLINE_COLOR

        if sess_term:
            status_text, status_color = "Прерван", "#e74c3c"
        elif not sess_active:
            status_text, status_color = "Завершил", "gray"
        elif has_sub:
            status_text, status_color = "Сдал", _DONE_COLOR
        else:
            status_text, status_color = "Решает", _WORKING_COLOR

        last_seen_str = "—"
        if row.get("last_seen"):
            try:
                ts = dt.datetime.fromisoformat(row["last_seen"])
                last_seen_str = ts.strftime("%H:%M:%S")
            except Exception:
                pass

        task_title = row.get("task_title") or "—"
        if len(task_title) > 14:
            task_title = task_title[:13] + "…"

        # Compute time remaining for active sessions.
        remaining_str = "—"
        remaining_color = "gray"
        if sess_active and row.get("session_start"):
            try:
                start_utc = dt.datetime.fromisoformat(row["session_start"])
                duration  = row.get("duration_seconds") or SESSION_DURATION_SECONDS
                elapsed   = (dt.datetime.utcnow() - start_utc).total_seconds()
                remaining = max(0, int(duration - elapsed))
                rm, rs    = divmod(remaining, 60)
                remaining_str = f"{rm}:{rs:02d}"
                if remaining < 300:        # < 5 min — red alert
                    remaining_color = "#e74c3c"
                elif remaining < 900:      # < 15 min — orange warning
                    remaining_color = "#f39c12"
                else:
                    remaining_color = ("gray70", "gray60")
            except Exception:
                pass

        # [LOGIC-ANCHOR] МЭШ-style display code is the primary visual identifier — the teacher
        # reads it off the student's screen and finds the matching row here instantly.
        display_code = row.get("session_display_code") or "—"
        class_name   = row.get("class_name") or ""

        frame = ctk.CTkFrame(
            self._student_scroll, fg_color=("gray85", "gray20"),
            corner_radius=4, cursor="hand2",
        )
        frame.pack(fill="x", pady=2, padx=2)

        ctk.CTkLabel(frame, text="●", text_color=dot_color, width=18,
                     font=ctk.CTkFont(size=14)
                     ).grid(row=0, column=0, rowspan=2, padx=(8, 4), pady=4)
        ctk.CTkLabel(frame, text=display_code, anchor="center", width=60,
                     text_color="#80c8ff", font=ctk.CTkFont(size=14, weight="bold")
                     ).grid(row=0, column=1, rowspan=2, padx=4, pady=4)

        # Student name on top row, class name as small sub-label below
        ctk.CTkLabel(frame, text=row["student_name"], anchor="w", width=150,
                     font=ctk.CTkFont(size=12)
                     ).grid(row=0, column=2, padx=4, pady=(6, 0), sticky="w")
        ctk.CTkLabel(frame, text=class_name, anchor="w", width=150,
                     text_color="#80c8ff", font=ctk.CTkFont(size=10)
                     ).grid(row=1, column=2, padx=4, pady=(0, 5), sticky="w")

        ctk.CTkLabel(frame, text=task_title, anchor="w", width=90,
                     text_color="gray", font=ctk.CTkFont(size=11)
                     ).grid(row=0, column=3, rowspan=2, padx=4, pady=4, sticky="w")
        ctk.CTkLabel(frame, text=status_text, text_color=status_color, width=62,
                     font=ctk.CTkFont(size=11)
                     ).grid(row=0, column=4, rowspan=2, padx=4, pady=4)
        # [LOGIC-ANCHOR] Time remaining — red < 5 min, orange < 15 min, gray otherwise.
        ctk.CTkLabel(frame, text=remaining_str, text_color=remaining_color,
                     width=64, font=ctk.CTkFont(size=11, weight="bold"),
                     ).grid(row=0, column=5, rowspan=2, padx=4, pady=4)
        ctk.CTkLabel(frame, text=last_seen_str, anchor="e", width=64,
                     text_color="gray", font=ctk.CTkFont(size=11)
                     ).grid(row=0, column=6, rowspan=2, padx=(4, 10), pady=4, sticky="e")

        # [LOGIC-ANCHOR] Clicking anywhere on the row (any column) selects the student.
        frame.bind("<Button-1>", lambda _e, r=row: self._on_row_click(r))
        for child in frame.winfo_children():
            child.bind("<Button-1>", lambda _e, r=row: self._on_row_click(r))

        self._row_frames.append(frame)

    def _on_row_click(self, row: dict) -> None:
        self._selected_row = row
        self._render_detail(row)

    # ------------------------------------------------------------------
    # History popup
    # ------------------------------------------------------------------

    def _open_history_window(self) -> None:
        """Opens a standalone popup showing all submissions for the selected student."""
        if self._selected_row is None:
            return
        session_id = self._selected_row.get("session_id")
        if not session_id:
            return

        name = self._selected_row.get("student_name", "Ученик")
        display_code = self._selected_row.get("session_display_code") or ""

        win = ctk.CTkToplevel(self)
        win.title(f"История сдач — {name}")
        win.geometry("680x560")
        win.grab_set()
        win.columnconfigure(0, weight=1)
        win.rowconfigure(2, weight=1)
        win.rowconfigure(4, weight=2)

        ctk.CTkLabel(
            win,
            text=f"История сдач  •  {name}" + (f"  [{display_code}]" if display_code else ""),
            font=ctk.CTkFont(size=14, weight="bold"),
            anchor="w",
        ).grid(row=0, column=0, sticky="ew", padx=16, pady=(14, 4))

        ctk.CTkLabel(
            win, text="СДАЧИ",
            font=ctk.CTkFont(size=10, weight="bold"), text_color="gray", anchor="w",
        ).grid(row=1, column=0, sticky="ew", padx=16, pady=(0, 2))

        scroll = ctk.CTkScrollableFrame(win, fg_color="transparent", height=160)
        scroll.grid(row=2, column=0, sticky="nsew", padx=12, pady=(0, 6))

        loading_lbl = ctk.CTkLabel(
            scroll, text="Загрузка…", text_color="gray", font=ctk.CTkFont(size=11)
        )
        loading_lbl.pack(pady=16)

        ctk.CTkLabel(
            win, text="КОД ВЫБРАННОЙ СДАЧИ",
            font=ctk.CTkFont(size=10, weight="bold"), text_color="gray", anchor="w",
        ).grid(row=3, column=0, sticky="ew", padx=16, pady=(4, 2))

        popup_code = ctk.CTkTextbox(win, state="disabled", wrap="none", font=_CODE_FONT)
        popup_code.grid(row=4, column=0, sticky="nsew", padx=12, pady=(0, 12))

        def _load_into_popup(sub: dict) -> None:
            code = sub.get("solution_text") or "(пусто)"
            popup_code.configure(state="normal")
            popup_code.delete("1.0", "end")
            popup_code.insert("1.0", code)
            popup_code.configure(state="disabled")

        def _render_popup_history(submissions: list[dict]) -> None:
            for w in scroll.winfo_children():
                w.destroy()
            if not submissions:
                ctk.CTkLabel(
                    scroll, text="Нет сдач в этой сессии.",
                    text_color="gray", font=ctk.CTkFont(size=11),
                ).pack(pady=12)
                return
            for sub in submissions:
                time_str = "—"
                if sub.get("submitted_at"):
                    try:
                        ts = dt.datetime.fromisoformat(sub["submitted_at"])
                        time_str = ts.strftime("%H:%M:%S")
                    except Exception:
                        pass
                ai_badge = "✓ ИИ" if sub.get("ai_feedback") else "⏳"
                label = f"{time_str}   [{sub.get('task_type') or '—'}]   {ai_badge}"
                ctk.CTkButton(
                    scroll,
                    text=label,
                    anchor="w",
                    fg_color="transparent",
                    hover_color=("gray75", "gray28"),
                    font=ctk.CTkFont(size=11),
                    height=30,
                    command=lambda s=sub: _load_into_popup(s),
                ).pack(fill="x", pady=1, padx=2)

        def _fetch_for_popup() -> None:
            try:
                resp = requests.get(
                    f"{SERVER_URL}/admin/sessions/{session_id}/submissions", timeout=8
                )
                resp.raise_for_status()
                win.after(0, lambda d=resp.json(): _render_popup_history(d))
            except Exception as exc:
                win.after(0, lambda: loading_lbl.configure(
                    text=f"Ошибка: {exc}", text_color="red"
                ))

        threading.Thread(target=_fetch_for_popup, daemon=True).start()

    def _render_detail(self, row: dict) -> None:
        """Fills the right panel header and code/feedback with the student's latest submission."""
        name         = row["student_name"]
        class_name   = row.get("class_name") or ""
        display_code = row.get("session_display_code")
        code_badge   = f"  [{display_code}]" if display_code else ""
        task         = row.get("task_title") or "задание не выбрано"
        task_type    = row.get("task_type") or ""
        status       = row.get("session_status", "")

        status_labels = {"active": "активна", "ended": "завершена", "terminated": "прервана учителем"}
        status_str = status_labels.get(status, status)

        sub_time = ""
        if row.get("submitted_at"):
            try:
                ts = dt.datetime.fromisoformat(row["submitted_at"])
                sub_time = f"  •  сдано в {ts.strftime('%H:%M:%S')}"
            except Exception:
                pass

        online_marker = "🟢 онлайн" if row.get("online") else "🔴 офлайн"
        class_badge   = f"  •  {class_name}" if class_name else ""
        self._detail_name.configure(text=f"{name}{code_badge}{class_badge}  —  {online_marker}")
        self._detail_meta.configure(
            text=f"Сессия: {status_str}  •  [{task_type}] {task}{sub_time}"
        )

        # Enable terminate only for truly active sessions.
        can_terminate = status == "active"
        self._terminate_btn.configure(state="normal" if can_terminate else "disabled")
        self._history_btn.configure(state="normal")

        code = row.get("solution_text") or "(нет решений)"
        self._code_box.configure(state="normal")
        self._code_box.delete("1.0", "end")
        self._code_box.insert("1.0", code)
        self._code_box.configure(state="disabled")

        feedback = row.get("ai_feedback") or "(ИИ-совет ещё не готов или задание не сдано)"
        self._feedback_box.configure(state="normal")
        self._feedback_box.delete("1.0", "end")
        self._feedback_box.insert("1.0", feedback)
        self._feedback_box.configure(state="disabled")

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------

    def _on_terminate(self) -> None:
        """Sends a terminate request for the selected student's session."""
        if self._selected_row is None:
            return
        session_id = self._selected_row.get("session_id")
        if session_id is None:
            return

        self._terminate_btn.configure(state="disabled", text="Завершение…")
        threading.Thread(target=self._do_terminate, args=(session_id,), daemon=True).start()

    def _do_terminate(self, session_id: int) -> None:
        try:
            resp = requests.post(
                f"{SERVER_URL}/admin/sessions/{session_id}/terminate", timeout=5
            )
            resp.raise_for_status()
            self.after(0, lambda: self._terminate_btn.configure(
                text="🛑  Завершить сессию", state="disabled"
            ))
            self.after(0, self._load_stats)
        except Exception as exc:
            self.after(0, lambda: self._last_updated_label.configure(
                text=f"Ошибка завершения: {exc}", text_color="red"
            ))
            self.after(0, lambda: self._terminate_btn.configure(
                text="🛑  Завершить сессию", state="normal"
            ))

    def _export_csv(self) -> None:
        """Downloads today's CSV from the server and saves it to the Desktop."""
        threading.Thread(target=self._do_export_csv, daemon=True).start()

    def _do_export_csv(self) -> None:
        try:
            resp = requests.get(f"{SERVER_URL}/admin/export/csv", timeout=15)
            resp.raise_for_status()

            # Save next to the user's Desktop so it's easy to find.
            desktop = os.path.join(os.path.expanduser("~"), "Desktop")
            os.makedirs(desktop, exist_ok=True)
            filename = f"teachereye_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            path = os.path.join(desktop, filename)
            with open(path, "wb") as f:
                f.write(resp.content)

            self.after(0, lambda p=path: self._last_updated_label.configure(
                text=f"CSV сохранён: {p}", text_color="#4caf50"
            ))
        except Exception as exc:
            self.after(0, lambda: self._last_updated_label.configure(
                text=f"Ошибка экспорта: {exc}", text_color="red"
            ))


if __name__ == "__main__":
    _require_password()
    app = AdminDashboard()
    app.mainloop()
