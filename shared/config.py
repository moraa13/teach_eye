# [VIBE-CONTEXT]
# Role: Central configuration for the Teacher's Eye ecosystem — single source of truth for URLs, keys, and constants.
# State: Session 9 — CLASS_LETTER_ORDINALS maps every class in the teacher's schedule to its
#        within-grade ordinal; class_display_code() assembles the МЭШ-style numeric code shown to students.
# Why: Keeping all shared constants here prevents hardcoded values from scattering across server and client modules.

import hashlib

# ---------------------------------------------------------------------------
# Class roster — built from the teacher's schedule (photo 2026-03-07).
#
# Ordinal = alphabetical position of the class letter within its grade group.
# This is what makes the МЭШ-style numeric code:
#   display_code = grade_digits + class_ordinal + student_number_in_class
#   e.g.  8А student  3  →  813
#         9Я student 11  →  9811
#
# [VIBE-CHECK] Update this dict if the school roster changes next academic year.
# ---------------------------------------------------------------------------

# 6th grade:  Д(1) Е(2) З(3) И(4) Л(5)
# 8th grade:  А(1) Б(2) В(3) Д(4) Ч(5) Ш(6) Ю(7) Я(8)
# 9th grade:  А(1) Б(2) В(3) Д(4) Ч(5) Ш(6) Ю(7) Я(8)
# 11th grade: Ч(1)
CLASS_LETTER_ORDINALS: dict[str, int] = {
    "6Д": 1, "6Е": 2, "6З": 3, "6И": 4, "6Л": 5,
    "8А": 1, "8Б": 2, "8В": 3, "8Д": 4, "8Ч": 5, "8Ш": 6, "8Ю": 7, "8Я": 8,
    "9А": 1, "9Б": 2, "9В": 3, "9Д": 4, "9Ч": 5, "9Ш": 6, "9Ю": 7, "9Я": 8,
    "11Ч": 1,
}

# All class names sorted for use in a dropdown widget.
ALL_CLASSES: list[str] = sorted(CLASS_LETTER_ORDINALS.keys())


def class_display_code(class_name: str, student_number: int) -> str:
    """Assembles the МЭШ-style numeric code shown on the student screen and admin dashboard.

    Pattern: {grade_digits}{class_ordinal}{student_number_in_class}
    Unknown class names fall back to ordinal 0 so the code still renders (e.g. '803').
    """
    # [LOGIC-ANCHOR] Ordinal encodes which class within the grade — not a generic letter-to-number
    # mapping but the specific order from this teacher's actual roster.
    upper = class_name.strip().upper()
    ordinal = CLASS_LETTER_ORDINALS.get(upper, 0)
    grade = "".join(c for c in upper if c.isdigit())
    return f"{grade}{ordinal}{student_number}"


# Server
SERVER_URL = "http://127.0.0.1:8000"

# Session timing
# [LOGIC-ANCHOR] A single lesson session is capped at 45 minutes.
SESSION_DURATION_SECONDS = 45 * 60

# AI integration
# [STUB-FOR-VIBE] Replace with a real key before Session 3: Gemini AI Feedback.
GEMINI_API_KEY = "YOUR_GEMINI_API_KEY_HERE"

# Tray
TRAY_TOOLTIP = "Teacher's Eye — session active"

# ---------------------------------------------------------------------------
# Admin password — stored as SHA-256 hash, never in plain text.
#
# [LOGIC-ANCHOR] Only the hash lives in this file. The raw password is never
# stored or compared directly — check_admin_password() hashes the candidate
# before comparing, so a shoulder-surf of this file reveals nothing usable.
#
# To change the password:
#   python -c "import hashlib; print(hashlib.sha256(b'your_new_password').hexdigest())"
# then paste the output as ADMIN_PASSWORD_HASH below.
# ---------------------------------------------------------------------------

# Default password: "teacher123"
# [VIBE-CHECK] Replace this hash (and the default password) before deploying to a real classroom.
ADMIN_PASSWORD_HASH = hashlib.sha256(b"teacher123").hexdigest()


def check_admin_password(candidate: str) -> bool:
    """Returns True if the candidate string matches the stored admin password hash."""
    return hashlib.sha256(candidate.encode("utf-8")).hexdigest() == ADMIN_PASSWORD_HASH
