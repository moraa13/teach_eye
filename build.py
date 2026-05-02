"""
build.py — PyInstaller packaging script for Teacher's Eye.

Windows output (dist/):
  TeacherEye_Student/TeacherEye_Student.exe
  TeacherEye_Teacher/TeacherEye_Teacher.exe
  TeacherEye_Admin/TeacherEye_Admin.exe

Linux output (dist/):
  TeacherEye_Student/TeacherEye_Student   (ELF binary, chmod +x)
  TeacherEye_Teacher/TeacherEye_Teacher
  TeacherEye_Admin/TeacherEye_Admin
  + one .desktop file per app next to its binary

Usage (run from the project root with PyInstaller installed):
    python build.py

After building on Linux, run the generated install_linux.sh to copy the
.desktop launchers to your desktop so you can double-click to open each app.

Requirements:
    pip install pyinstaller

Each app is built as a single-directory bundle (--onedir) to keep startup fast.
"""

# [VIBE-CHECK] Test each executable on a clean machine (no Python installed) before
# distributing to the classroom. PIL, pystray, and customtkinter have DLL/SO dependencies
# that PyInstaller usually captures automatically, but always verify.

import os
import stat
import sys
import subprocess
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
ASSETS_DIR = ROOT / "assets"
ICON_PATH  = ASSETS_DIR / "tray_icon.png"   # optional — bundled if it exists

# ---------------------------------------------------------------------------
# Build targets
# ---------------------------------------------------------------------------

TARGETS = [
    {
        "name":   "TeacherEye_Student",
        "script": "client/app.py",
        "desc":   "Student client",
    },
    {
        "name":   "TeacherEye_Teacher",
        "script": "client/teacher_panel.py",
        "desc":   "Teacher upload panel",
    },
    {
        "name":   "TeacherEye_Admin",
        "script": "client/admin_dashboard.py",
        "desc":   "Admin dashboard",
    },
]

# ---------------------------------------------------------------------------
# Hidden imports that PyInstaller may miss with dynamic imports
# ---------------------------------------------------------------------------

# pystray uses a different backend per platform — only include the right one.
_PYSTRAY_BACKEND = "pystray._win32" if sys.platform == "win32" else "pystray._xorg"

HIDDEN_IMPORTS = [
    "PIL._tkinter_finder",
    _PYSTRAY_BACKEND,
    "customtkinter",
    "google.generativeai",
    "sqlalchemy.dialects.sqlite",
    "alembic",
]


def _add_data(src: Path, dst_folder: str) -> str:
    """Returns a PyInstaller --add-data argument string (src;dst on Windows)."""
    sep = ";" if sys.platform == "win32" else ":"
    return f"{src}{sep}{dst_folder}"


def build_target(target: dict, onedir: bool = True) -> None:
    """Invokes PyInstaller for one target application."""
    name   = target["name"]
    script = ROOT / target["script"]

    print(f"\n{'='*60}")
    print(f"Building: {name}  ({target['desc']})")
    print(f"{'='*60}")

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--name", name,
        "--distpath", str(ROOT / "dist"),
        "--workpath", str(ROOT / "build"),
        "--specpath", str(ROOT / "build"),
        "--onedir" if onedir else "--onefile",
        "--windowed",   # no console window for GUI apps
        # Bundle the shared/ and server/ packages so all imports resolve.
        "--add-data", _add_data(ROOT / "shared", "shared"),
        "--add-data", _add_data(ROOT / "server", "server"),
        "--add-data", _add_data(ROOT / "client", "client"),
    ]

    # Bundle assets folder if it exists.
    if ASSETS_DIR.exists():
        cmd += ["--add-data", _add_data(ASSETS_DIR, "assets")]

    # Hidden imports.
    for hi in HIDDEN_IMPORTS:
        cmd += ["--hidden-import", hi]

    cmd.append(str(script))

    result = subprocess.run(cmd, cwd=str(ROOT))
    if result.returncode != 0:
        print(f"[ERROR] Build failed for {name} (exit {result.returncode})")
        sys.exit(result.returncode)

    print(f"[OK] {name} built → dist/{name}/")


# ---------------------------------------------------------------------------
# Linux .desktop launcher generation
# ---------------------------------------------------------------------------

_DESKTOP_TEMPLATE = """\
[Desktop Entry]
Version=1.0
Name={name}
Comment={comment}
Exec={exec_path}
Icon={icon_path}
Type=Application
Terminal=false
Categories=Education;
"""

_DESKTOP_META = {
    "TeacherEye_Student": {
        "name": "TeacherEye — Ученик",
        "comment": "Клиент ученика для Teacher's Eye",
    },
    "TeacherEye_Teacher": {
        "name": "TeacherEye — Учитель",
        "comment": "Панель загрузки заданий Teacher's Eye",
    },
    "TeacherEye_Admin": {
        "name": "TeacherEye — Дашборд",
        "comment": "Административный дашборд Teacher's Eye",
    },
}


def generate_linux_desktop_files(dist_dir: Path) -> None:
    """Creates a .desktop file next to each Linux binary in dist/ and chmod +x the binaries."""
    icon_path = dist_dir.parent / "assets" / "tray_icon.png"
    desktop_files: list[Path] = []

    for target in TARGETS:
        app_name   = target["name"]
        app_dir    = dist_dir / app_name
        binary     = app_dir / app_name
        desktop_f  = app_dir / f"{app_name}.desktop"
        meta       = _DESKTOP_META.get(app_name, {"name": app_name, "comment": ""})

        if not binary.exists():
            print(f"[WARN] Binary not found, skipping .desktop: {binary}")
            continue

        # Make the binary executable.
        binary.chmod(binary.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

        content = _DESKTOP_TEMPLATE.format(
            name=meta["name"],
            comment=meta["comment"],
            exec_path=str(binary.resolve()),
            icon_path=str(icon_path.resolve()) if icon_path.exists() else "",
        )
        desktop_f.write_text(content, encoding="utf-8")
        # .desktop files themselves must be executable to be launched by file managers.
        desktop_f.chmod(desktop_f.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP)
        desktop_files.append(desktop_f)
        print(f"[OK] .desktop → {desktop_f}")

    # Write install_linux.sh at the project root.
    install_sh = dist_dir.parent / "install_linux.sh"
    lines = [
        "#!/bin/bash",
        "# Generated by build.py — copies Teacher's Eye launchers to the Desktop.",
        'DESKTOP="$HOME/Desktop"',
        'mkdir -p "$DESKTOP"',
    ]
    for df in desktop_files:
        lines.append(f'cp -f "{df.resolve()}" "$DESKTOP/"')
        lines.append(f'chmod +x "$DESKTOP/{df.name}"')
    lines += [
        'echo "Ярлыки скопированы на рабочий стол. Двойной клик → запуск."',
    ]
    install_sh.write_text("\n".join(lines) + "\n", encoding="utf-8")
    install_sh.chmod(install_sh.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP)
    print(f"\n[OK] install_linux.sh → {install_sh}")
    print("     Run it once to put launchers on the Desktop:")
    print(f"     bash {install_sh}")


def main() -> None:
    print("Teacher's Eye — PyInstaller build script")
    print(f"Root: {ROOT}")
    print(f"Platform: {sys.platform}")

    # Verify PyInstaller is available.
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("\n[ERROR] PyInstaller is not installed.")
        print("Run:  pip install pyinstaller")
        sys.exit(1)

    # Verify we are running from the project root.
    if not (ROOT / "shared" / "config.py").exists():
        print("[ERROR] Run this script from the project root (where shared/ lives).")
        sys.exit(1)

    # [VIBE-CHECK] The server (FastAPI) is NOT packaged here — it is expected to run
    # as a normal Python process on the teacher's machine. Only the GUI clients are
    # distributed as executables to student/teacher computers.
    print("\nNote: The FastAPI server is not packaged — run it with:")
    print("  uvicorn server.main:app --host 0.0.0.0 --port 8000\n")

    for target in TARGETS:
        build_target(target)

    dist_dir = ROOT / "dist"

    if sys.platform != "win32":
        print("\nGenerating Linux .desktop launchers…")
        generate_linux_desktop_files(dist_dir)

    print("\n✓  All builds complete. Executables are in the dist/ folder.")


if __name__ == "__main__":
    main()
