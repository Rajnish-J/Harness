# {{project_name}}

A command line tool.

## Run it

```
python -m venv .venv
.venv/bin/pip install -e .
.venv/bin/{{package_slug}} Ada
```

Or without installing: `python -m {{package_slug}}` from `src/`.

## Test it

```
.venv/bin/python -m pytest -q
```
