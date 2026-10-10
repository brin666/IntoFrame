"""Serve built experiment and existing local media on one origin (port 5190)."""

from pathlib import Path
import sys

import uvicorn
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from main import app  # noqa: E402  - same API and media routes as the normal local server

app.mount("/", StaticFiles(directory=ROOT / "dist", html=True))

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=5190)
