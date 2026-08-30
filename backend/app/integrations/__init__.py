"""Clients for third-party APIs the harness talks to on the operator's behalf.

Separate from `app/agent/tools/` on purpose: nothing in here is callable by the
model. These are reached only from route handlers, behind an explicit action the
operator took in the UI. See the module docstring in `github.py`.
"""
