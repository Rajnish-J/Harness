# {{project_name}}

A FastAPI service.

## Run it

```
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --reload
```

Then open http://127.0.0.1:8000/health — interactive docs are at `/docs`.

## Test it

```
.venv/bin/python -m pytest -q
```
