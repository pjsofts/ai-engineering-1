# tools.py — the agent's hands, for one small Python project.
#
# The model sees each function's name, parameters and docstring, nothing else.
#
#   look:    list_files  read_file  grep_search      (safe: they change nothing)
#   change:  write_file  edit_file                    (they change the project)
#   check:   run_tests                                (runs the project's tests)
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
WORKSPACE = HERE / "workspace"          # the only folder the agent may touch
SAMPLE = HERE / "sample_project"        # a clean copy, to start again
MYCODE_HOME = HERE / "home"             # stands in for ~/.mycode (step 5, 6)
PROTECTED = "checks/"                   # the harness's checks (step 3)
TIMEOUT = 20                            # seconds, for the tests


# ---- look --------------------------------------------------------------------

def list_files() -> str:
    """List every file in the project."""
    paths = [path.relative_to(WORKSPACE).as_posix() for path in project_files()]
    return "\n".join(paths)


def read_file(path: str) -> str:
    """Read one file of the project."""
    try:
        return inside_workspace(path).read_text()
    except FileNotFoundError:
        return f"Error: file not found: {path}"


def grep_search(pattern: str) -> str:
    """Find the lines that contain this exact text, in every file of the project."""
    matches = []
    for path in project_files():
        for number, line in enumerate(path.read_text().splitlines(), start=1):
            if pattern.lower() in line.lower():
                name = path.relative_to(WORKSPACE).as_posix()
                matches.append(f"{name}:{number}: {line.strip()}")
    return "\n".join(matches) or f"No lines contain '{pattern}'."


# ---- change ------------------------------------------------------------------

def write_file(path: str, content: str) -> str:
    """Create a file, or replace everything in it."""
    if path.startswith(PROTECTED):
        return f"Error: {PROTECTED} belongs to the harness. You can't change it."
    file = inside_workspace(path)
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(real_newlines(content))
    return f"Wrote {path} ({len(content.splitlines())} lines)"


def edit_file(path: str, old: str, new: str) -> str:
    """Replace the text `old` with `new` in one file.
    Copy `old` exactly from the file, with its spaces. It must appear exactly once."""
    if path.startswith(PROTECTED):
        return f"Error: {PROTECTED} belongs to the harness. You can't change it."
    file = inside_workspace(path)
    text = file.read_text()
    old, new = real_newlines(old), real_newlines(new)
    if text.count(old) != 1:
        return f"Error: that text is in {path} {text.count(old)} times, not once."
    file.write_text(text.replace(old, new))
    return f"Edited {path}"


# ---- check -------------------------------------------------------------------

def run_tests() -> str:
    """Run all the tests in tests/. Use it to check your work before you say it is done."""
    return run_command("python -m unittest discover -s tests -t .")


# ---- helpers (not tools) -----------------------------------------------------

def run_command(command):
    """Run a command in the project folder. Returns 'PASSED' or 'FAILED' and the output."""
    # "python" means the Python running this code
    command = command.replace("python ", f"{sys.executable} ", 1)
    try:
        result = subprocess.run(command, shell=True, cwd=WORKSPACE,
                                capture_output=True, text=True, timeout=TIMEOUT)
    except subprocess.TimeoutExpired:
        return f"FAILED\nStopped after {TIMEOUT} seconds. Do the tests sleep?"
    verdict = "PASSED" if result.returncode == 0 else "FAILED"
    return f"{verdict}\n{(result.stdout + result.stderr).strip()[-1500:]}"


def real_newlines(text):
    """Small models sometimes send \\n (a backslash and an n) instead of a new line."""
    if "\n" not in text and "\\n" in text:
        return text.replace("\\n", "\n")
    return text


def changed_files():
    """Which files are new or different from the clean copy?"""
    changed = []
    for path in project_files():
        name = path.relative_to(WORKSPACE).as_posix()
        original = SAMPLE / name
        if not original.exists():
            changed.append(f"{name} (new)")
        elif original.read_text() != path.read_text() and name != "features.json":
            changed.append(name)
    return changed


def project_files():
    return sorted(path for path in WORKSPACE.rglob("*")
                  if path.is_file() and "__pycache__" not in path.parts)


def inside_workspace(path):
    """Turn a path from the model into a real path. Refuse anything outside the project."""
    full_path = (WORKSPACE / path).resolve()
    if not full_path.is_relative_to(WORKSPACE.resolve()):
        raise PermissionError(f"{path} is outside the project")
    return full_path


def reset_workspace():
    """Start every run from the same clean project, with no sessions or memory."""
    shutil.rmtree(MYCODE_HOME, ignore_errors=True)
    shutil.rmtree(WORKSPACE, ignore_errors=True)
    shutil.copytree(SAMPLE, WORKSPACE, ignore=shutil.ignore_patterns("__pycache__"))


LOOK = [list_files, read_file, grep_search]
CHANGE = [write_file, edit_file]
CHECK = [run_tests]
