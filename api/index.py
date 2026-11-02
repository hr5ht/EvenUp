# Vercel entry point: vercel.json sends every path here and the runtime serves this ASGI app.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # so `app` (the package) imports

from app.main import app  # noqa: E402,F401
