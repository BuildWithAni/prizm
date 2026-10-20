"""Locates toolchains for student code — PATH first, then known install spots.

winget installs land on PATH only for *new* processes, and the Kotlin compiler
/ .NET SDK are portable installs that never touch PATH, so the runner also
knows their conventional locations.
"""

from __future__ import annotations

import functools
import os
import shutil
from pathlib import Path

try:
    import winreg
except ImportError:  # non-Windows dev box
    winreg = None  # type: ignore[assignment]

# services/api/app/execution/toolchain.py -> parents[4] == repo root
_REPO_ROOT = Path(__file__).resolve().parents[4]

_EXTRA_DIRS: dict[str, list[Path]] = {
    "kotlinc": [
        _REPO_ROOT / "tools" / "kotlin" / "kotlinc" / "bin",
        Path.home() / "tools" / "kotlin" / "kotlinc" / "bin",
    ],
    "dotnet": [
        Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "dotnet",
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "dotnet",
    ],
}

_EXECUTABLES = {
    "kotlinc": ("kotlinc.bat", "kotlinc"),
    "dotnet": ("dotnet.exe", "dotnet"),
    "ruby": ("ruby.exe",),
    "php": ("php.exe",),
    "node": ("node.exe",),
    "go": ("go.exe",),
}


@functools.lru_cache(maxsize=1)
def _registry_path() -> str:
    """Machine + User PATH from the registry — the fresh post-install value."""
    if winreg is None:
        return ""
    parts: list[str] = []
    for root, sub in (
        (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
        (winreg.HKEY_CURRENT_USER, "Environment"),
    ):
        try:
            with winreg.OpenKey(root, sub) as key:
                value, _ = winreg.QueryValueEx(key, "Path")
                if isinstance(value, str):
                    parts.append(value)
        except OSError:
            continue
    return ";".join(p for p in parts if p)


def _path_dirs(*extra: str) -> list[str]:
    """Deduplicated dirs from process PATH + caller extras + registry PATH."""
    raw = os.pathsep.join([os.environ.get("PATH", ""), *extra, _registry_path()])
    seen: set[str] = set()
    out: list[str] = []
    for entry in raw.split(os.pathsep):
        entry = os.path.expandvars(entry.strip().strip('"'))
        if not entry:
            continue
        key = entry.lower()
        if key in seen:
            continue
        try:
            if not Path(entry).is_dir():
                continue
        except OSError:
            continue
        seen.add(key)
        out.append(entry)
    return out


def find_tool(name: str) -> str | None:
    """Absolute path of `name`, or None when it is not installed anywhere.

    Checks the process PATH first, then the *registry* PATH (a server started
    before `winget install` won't see the new entry in its own environment),
    then known portable-install spots.
    """
    found = shutil.which(name)
    if found:
        return found
    executables = _EXECUTABLES.get(name, (name, f"{name}.exe"))
    for directory in _path_dirs():
        for exe in executables:
            hit = Path(directory) / exe
            if hit.is_file():
                return str(hit)
    candidates = _EXTRA_DIRS.get(name)
    if not candidates:
        return None
    for exe in executables:
        for directory in candidates:
            hit = directory / exe
            if hit.is_file():
                return str(hit)
    return None


def kotlin_home() -> Path | None:
    """Root of the Kotlin distribution (for its stdlib jar), if installed."""
    kotlinc = find_tool("kotlinc")
    if not kotlinc:
        return None
    return Path(kotlinc).resolve().parent.parent


def find_dotnet() -> str | None:
    """A dotnet host that actually ships an SDK.

    Machines often have a runtime-only install earlier on PATH that answers
    `dotnet build` with "No .NET SDKs were found" — prefer any candidate with
    a sibling `sdk/` directory (the side-by-side SDK install).
    """
    candidates: list[Path] = []
    found = shutil.which("dotnet")
    if found:
        candidates.append(Path(found))
    for directory in _path_dirs():
        for exe in ("dotnet.exe", "dotnet"):
            hit = Path(directory) / exe
            if hit.is_file():
                candidates.append(hit)
                break
    for extra in _EXTRA_DIRS.get("dotnet", []):
        hit = extra / "dotnet.exe"
        if hit.is_file():
            candidates.append(hit)
    uniq: list[Path] = []
    seen: set[str] = set()
    for cand in candidates:
        key = str(cand).lower()
        if key not in seen:
            seen.add(key)
            uniq.append(cand)
    for cand in uniq:
        try:
            if (cand.parent / "sdk").is_dir():
                return str(cand)
        except OSError:
            continue
    return str(uniq[0]) if uniq else None


def modern_mingw_bin() -> Path | None:
    """Newest WinLibs/MSYS2 MinGW-w64 bin dir — beats ancient PATH shadow-ers."""
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    if base.is_dir():
        for pkg in sorted(base.glob("BrechtSanders.WinLibs*")):
            for candidate in (pkg / "mingw64" / "bin", pkg / "mingw32" / "bin"):
                if (candidate / "gcc.exe").is_file():
                    return candidate
    for extra in (Path(r"C:\msys64\ucrt64\bin"), Path(r"C:\msys64\mingw64\bin")):
        if (extra / "gcc.exe").is_file():
            return extra
    return None


def find_gcc(cpp: bool = False) -> str | None:
    """Modern gcc/g++ first (WinLibs), then PATH."""
    name = "g++" if cpp else "gcc"
    mingw = modern_mingw_bin()
    if mingw:
        hit = mingw / f"{name}.exe"
        if hit.is_file():
            return str(hit)
    return shutil.which(name)


def find_gdb() -> str | None:
    """Modern gdb first (WinLibs ships Python-enabled 18.x), then PATH."""
    mingw = modern_mingw_bin()
    if mingw:
        hit = mingw / "gdb.exe"
        if hit.is_file():
            return str(hit)
    return shutil.which("gdb")


def augment_path_env(env: dict[str, str]) -> dict[str, str]:
    """Return env with toolchain dirs prepended/appended to PATH.

    The modern MinGW goes FIRST so gcc/g++/gdb resolve to WinLibs rather than
    an ancient C:\MinGW shadow earlier in the system PATH.
    """
    env = dict(env)
    prepend: list[str] = []
    append: list[str] = []
    mingw = modern_mingw_bin()
    if mingw:
        prepend.append(str(mingw))
    kotlinc_home = kotlin_home()
    if kotlinc_home:
        append.append(str(kotlinc_home / "bin"))
    dotnet_dir = find_dotnet()
    if dotnet_dir:
        # SDK host dir first so children resolve the SDK-capable `dotnet`.
        prepend.insert(0, str(Path(dotnet_dir).parent))
    current = env.get("PATH", "")
    if prepend:
        current = os.pathsep.join(prepend) + os.pathsep + current
    if append:
        current = current + os.pathsep + os.pathsep.join(append)
    env["PATH"] = current
    return env
