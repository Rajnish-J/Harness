"""Cloned repositories the agent can work inside.

Nothing in this package is a tool. `git_ops.py` can clone, fetch and check out
branches — all operations `app/agent/tools/git_tools.py` deliberately withholds
from the model — so it is reachable only from route handlers, behind an action
the operator took. See the docstring in `git_ops.py`.
"""
