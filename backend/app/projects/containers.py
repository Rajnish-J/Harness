"""One container per project, and its lifecycle.

Three things shape everything here.

**The SDK is synchronous.** Every call into it goes through `asyncio.to_thread`.
Miss one and it blocks the event loop for the duration -- which for `pull` on a
cold image is minutes, stalling every concurrent SSE stream in the process.

**Docker may not be there at all**, and that is a normal condition rather than a
crash. It might not be installed, or Docker Desktop might simply not be running.
`DockerUnavailableError` carries a sentence the operator can act on, and the
routes turn it into a 503 -- the project's files still work without it, because
the file tools read the host mount (see app/agent/exec_context.py).

**The database row is a cache, not the truth.** `docker rm` or a Docker Desktop
restart can remove a container without telling us, so `status()` reconciles
against the daemon rather than believing the row.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

#: Name prefix, so an orphaned container is findable with `docker ps`.
NAME_PREFIX = "harness-project-"

#: Kept alive by a no-op PID 1. Without this a container with no long-running
#: process exits immediately and there is nothing to `docker exec` into.
KEEPALIVE = ["sleep", "infinity"]

CONTAINER_WORKDIR = "/workspace"


class DockerUnavailableError(Exception):
    """No usable Docker daemon. The message is safe to show the operator."""


class ContainerError(Exception):
    """The daemon is there but the operation failed."""


@dataclass
class ContainerState:
    """What the daemon currently says, not what the database remembers."""

    exists: bool
    running: bool
    container_id: str | None = None
    image: str | None = None
    host_port: int | None = None
    status: str = "removed"


def container_name(project_id: str) -> str:
    return f"{NAME_PREFIX}{project_id}"


def _connect_blocking():
    import docker

    # from_env picks up DOCKER_HOST, and falls back to the platform default --
    # the npipe on Windows, the unix socket elsewhere.
    client = docker.from_env()
    client.ping()  # from_env is lazy; ping is what proves a daemon is there.
    return client


async def get_client():
    """A live Docker client, or DockerUnavailableError with a next action."""
    try:
        return await asyncio.to_thread(_connect_blocking)
    except ImportError as exc:  # pragma: no cover - the dep is pinned
        raise DockerUnavailableError(
            "The docker package is not installed. Run "
            "`pip install -r requirements.txt` in backend/."
        ) from exc
    except Exception as exc:  # noqa: BLE001 - docker raises several types here
        raise DockerUnavailableError(
            "Cannot reach the Docker daemon. Start Docker Desktop and wait for "
            "it to report Running, then try again. (If Docker is installed "
            "somewhere unusual, set DOCKER_HOST.)\n\n"
            f"{type(exc).__name__}: {exc}"
        ) from exc


async def docker_available() -> bool:
    """Cheap probe for the UI, so a status badge never raises."""
    try:
        await get_client()
        return True
    except DockerUnavailableError:
        return False


def _find_blocking(client, name: str):
    """The container for a project, or None. Absence is not an error."""
    import docker.errors

    try:
        return client.containers.get(name)
    except docker.errors.NotFound:
        return None


def _port_of(container, container_port: int) -> int | None:
    """The host port Docker chose, read back after start.

    Docker is asked for `None` (any free port) rather than being handed one we
    picked, because it already solves allocation and collision correctly.
    """
    try:
        bindings = (container.attrs.get("NetworkSettings") or {}).get("Ports") or {}
        entries = bindings.get(f"{container_port}/tcp") or []
        if entries and entries[0].get("HostPort"):
            return int(entries[0]["HostPort"])
    except (KeyError, ValueError, TypeError):
        pass
    return None


async def status(project_id: str, *, container_port: int = 3000) -> ContainerState:
    """Reconcile against the daemon. Never raises for a missing container."""
    client = await get_client()
    container = await asyncio.to_thread(
        _find_blocking, client, container_name(project_id)
    )
    if container is None:
        return ContainerState(exists=False, running=False)

    await asyncio.to_thread(container.reload)
    running = container.status == "running"
    return ContainerState(
        exists=True,
        running=running,
        container_id=container.id,
        image=(container.image.tags or [None])[0] if container.image else None,
        host_port=_port_of(container, container_port) if running else None,
        status=container.status,
    )


def _ensure_blocking(client, name: str, image: str, host_mount: Path, port: int):
    """Create-or-start, idempotently. Runs in a worker thread."""
    import docker.errors

    container = _find_blocking(client, name)

    if container is not None:
        container.reload()
        if container.status != "running":
            container.start()
            container.reload()
        return container

    try:
        client.images.get(image)
    except docker.errors.ImageNotFound:
        # First use of an image is a long pull. Streaming its progress would be
        # nicer; for now the caller's SSE says "pulling" and this blocks.
        logger.info("pulling image %s", image)
        client.images.pull(image)

    container = client.containers.run(
        image,
        command=KEEPALIVE,
        name=name,
        detach=True,
        working_dir=CONTAINER_WORKDIR,
        # str(): the SDK wants a string, and on Windows this is a WindowsPath.
        # Docker Desktop translates C:\... itself, provided the drive is shared.
        volumes={str(host_mount): {"bind": CONTAINER_WORKDIR, "mode": "rw"}},
        # None = let Docker pick a free host port, then read it back.
        ports={f"{port}/tcp": None},
        # Not a security boundary -- it is a convenience so a runaway build does
        # not take the host down with it.
        mem_limit="2g",
        auto_remove=False,
    )
    container.reload()
    return container


def _explain(exc: Exception) -> str:
    """Turn a daemon error into something with a next action in it."""
    text = str(exc)
    lowered = text.lower()
    if "drive has not been shared" in lowered or "is not shared from the host" in lowered:
        return (
            "Docker Desktop will not mount this drive. Add it under "
            "Settings > Resources > File sharing, then try again.\n\n" + text
        )
    if "port is already allocated" in lowered:
        return f"The published port is already in use.\n\n{text}"
    if "no such image" in lowered or "pull access denied" in lowered:
        return f"The image could not be pulled. Is there a network route?\n\n{text}"
    return text


async def ensure_container(
    project_id: str,
    host_mount: Path,
    *,
    image: str,
    container_port: int = 3000,
) -> ContainerState:
    """Start this project's container, creating it if necessary."""
    if not host_mount.is_dir():
        raise ContainerError(
            f"{host_mount} does not exist -- clone the project before starting it."
        )

    client = await get_client()
    try:
        container = await asyncio.to_thread(
            _ensure_blocking,
            client,
            container_name(project_id),
            image,
            host_mount,
            container_port,
        )
    except Exception as exc:  # noqa: BLE001 - several docker error types
        raise ContainerError(_explain(exc)) from exc

    return ContainerState(
        exists=True,
        running=container.status == "running",
        container_id=container.id,
        image=image,
        host_port=_port_of(container, container_port),
        status=container.status,
    )


async def stop_container(project_id: str, *, timeout: int = 10) -> ContainerState:
    """Stop, but keep the container so a restart is fast and state survives."""
    client = await get_client()
    container = await asyncio.to_thread(
        _find_blocking, client, container_name(project_id)
    )
    if container is None:
        return ContainerState(exists=False, running=False)

    await asyncio.to_thread(container.stop, timeout=timeout)
    await asyncio.to_thread(container.reload)
    return ContainerState(
        exists=True,
        running=False,
        container_id=container.id,
        status=container.status,
    )


async def remove_container(project_id: str) -> ContainerState:
    """Delete the container. The checkout on the host mount is untouched."""
    client = await get_client()
    container = await asyncio.to_thread(
        _find_blocking, client, container_name(project_id)
    )
    if container is None:
        return ContainerState(exists=False, running=False)

    await asyncio.to_thread(container.remove, force=True)
    return ContainerState(exists=False, running=False, status="removed")
