# [VIBE-CONTEXT]
# Role: Executes short-lived Python snippets for Lesson Mode and returns structured output,
#        interpreter errors, and friendly human-readable explanations for common mistakes.
# State: Session 11 — initial embedded runner foundation; synchronous local execution with a
#        strict timeout, no AI layer yet, and friendly error mapping for classroom use.
# Why: An internal runner removes the need to bounce through IDLE or PyCharm and gives the
#      teacher a stable contract for future Tauri-based student coding screens.

from __future__ import annotations

import subprocess
import sys
import tempfile
import time
from pathlib import Path

RUN_TIMEOUT_SECONDS = 3


def explain_python_error(stderr_text: str) -> str | None:
    """Maps common Python failures to short, student-friendly hints."""
    if not stderr_text:
        return None

    if "SyntaxError" in stderr_text:
        if ":" in stderr_text:
            return "Похоже, в синтаксисе что-то не так. Проверь двоеточия, скобки и порядок конструкции."
        return "Похоже, Python не смог прочитать строку. Проверь синтаксис и лишние символы."
    if "IndentationError" in stderr_text:
        return "Проверь отступы: Python очень чувствителен к пробелам в блоках."
    if "NameError" in stderr_text:
        return "Кажется, используется имя переменной или функции, которое еще не объявлено."
    if "TypeError" in stderr_text:
        return "Судя по всему, операция выполнена с неподходящим типом данных."
    if "ZeroDivisionError" in stderr_text:
        return "Здесь произошло деление на ноль. Проверь вычисления перед запуском."
    if "ValueError" in stderr_text:
        return "Одно из значений оказалось не таким, как ожидала программа."
    return "Запуск не удался. Посмотри на текст ошибки ниже и проверь проблемное место."


def run_python_code(source_code: str, timeout_seconds: int = RUN_TIMEOUT_SECONDS) -> dict[str, object]:
    """Executes Python code in an isolated subprocess and returns structured run results."""
    started = time.perf_counter()

    with tempfile.TemporaryDirectory(prefix="teachereye_run_") as tmpdir:
        script_path = Path(tmpdir) / "student_code.py"
        script_path.write_text(source_code or "", encoding="utf-8")

        try:
            result = subprocess.run(
                [sys.executable, "-I", "-B", str(script_path)],
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                cwd=tmpdir,
            )
            duration_ms = int((time.perf_counter() - started) * 1000)
            stderr_text = result.stderr or ""
            stdout_text = result.stdout or ""
            status = "ok" if result.returncode == 0 else "error"
            return {
                "status": status,
                "exit_code": result.returncode,
                "stdout_text": stdout_text,
                "stderr_text": stderr_text,
                "friendly_error": None if status == "ok" else explain_python_error(stderr_text),
                "duration_ms": duration_ms,
            }
        except subprocess.TimeoutExpired as exc:
            duration_ms = int((time.perf_counter() - started) * 1000)
            stdout_text = exc.stdout or ""
            stderr_text = exc.stderr or ""
            return {
                "status": "timeout",
                "exit_code": None,
                "stdout_text": stdout_text,
                "stderr_text": stderr_text,
                "friendly_error": (
                    "Программа выполняется слишком долго. Возможно, цикл не заканчивается "
                    "или код ждет слишком много времени."
                ),
                "duration_ms": duration_ms,
            }
