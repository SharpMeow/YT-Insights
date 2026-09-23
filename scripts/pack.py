#!/usr/bin/env python3
"""Build dist/yt-insights-<version>.zip for Load unpacked."""
from __future__ import annotations
import json, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "manifest.json").read_text())["version"]
OUT_DIR = ROOT / "dist"
ZIP_PATH = OUT_DIR / f"yt-insights-{VERSION}.zip"
INCLUDE = [
    "manifest.json",
    "content.css",
    "LICENSE",
    "README.md",
    "PRIVACY.md",
    "SECURITY.md",
    "CHANGELOG.md",
]
INCLUDE_DIRS = ["js", "icons", "docs"]

def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in INCLUDE:
            path = ROOT / name
            if path.is_file():
                zf.write(path, f"yt-insights/{name}")
        for dirname in INCLUDE_DIRS:
            base = ROOT / dirname
            if not base.exists():
                continue
            for path in sorted(base.rglob("*")):
                if path.is_file():
                    zf.write(path, f"yt-insights/{path.relative_to(ROOT).as_posix()}")
    print(ZIP_PATH)

if __name__ == "__main__":
    main()
