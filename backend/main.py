"""Entrypoint shim so `uvicorn main:app` keeps working.

All assembly lives in app/main.py.
"""

from app.main import app

__all__ = ["app"]
