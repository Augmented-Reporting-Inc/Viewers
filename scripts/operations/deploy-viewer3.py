#!/usr/bin/env python3
"""Managed Viewer3 release; host only, no application data or expanded config output."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time

ROOT = Path("/home/ubuntu/compose")
REGISTRY = "804220655312.dkr.ecr.ca-central-1.amazonaws.com"
IMAGE_PATTERN = re.compile(re.escape(REGISTRY + "/s3orth:") +
                           r"ohifar311-gha-[0-9a-f]{12}-[0-9]+@sha256:[0-9a-f]{64}")
OTHER_MANAGED = ("formapi", "auth", "worker", "scoring-worker")


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(args, **kwargs):
    # No full docker inspect, expanded Compose, AWS password or app logs in SSM output.
    return subprocess.run(args, check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, **kwargs).stdout


def runtime(service):
    fmt = '{{json .Config.Image}} {{json .State.Running}}'
    raw = run(["docker", "inspect", "--type", "container", "--format", fmt, service]).decode()
    decoder = json.JSONDecoder()
    image, end = decoder.raw_decode(raw)
    running, end = decoder.raw_decode(raw[end:].lstrip())
    require(running is True, service + " is not running")
    return image


def container_ids():
    rows = run(["docker", "ps", "-a", "--no-trunc", "--format", "{{.Names}} {{.ID}}"]).decode()
    return dict(row.split() for row in rows.splitlines() if row and not row.startswith("viewer3 "))


def compose(root, *args):
    return run(["python3", str(root / "scripts/operations/ar-compose.py"), "--ar-managed", *args],
               cwd=str(root))


def effective_images(root):
    services = json.loads(compose(root, "config", "--format", "json"))["services"]
    return {name: entry.get("image") for name, entry in services.items()}


def checked_files(root):
    manifest = root / "config/compose/manifest.json"
    expected = ["docker-compose.yml"]
    if (root / "config/live-scanning.formapi.override.yml").is_file():
        expected.append("config/live-scanning.formapi.override.yml")
    expected += [".ar-ses-invitation.override.yml", "config/compose/images.yml"]
    require(json.loads(manifest.read_text()) == {"files": expected, "version": 1},
            "Manifest differs from reviewed Viewer3 layout")
    files = [manifest] + [root / name for name in expected]
    for path in files:
        require(path.is_file() and not path.is_symlink(), "Missing or unsafe managed file")
    for service in OTHER_MANAGED + ("viewer3",):
        override = root / (".ar-" + service + "-deploy.override.yml")
        require(not override.exists() and not override.is_symlink(),
                "Retained deployment override: " + service)
    return files


def replace_viewer_pin(payload, previous, target):
    # Match the existing reviewed Compose layout only. No YAML reserialization,
    # interpolation, duplicate service selection or replacement of other pins.
    lines = payload.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines)
              if re.fullmatch(rb"  viewer3:[ \t]*(?:#[^\r\n]*)?\r?\n?", line)]
    require(len(starts) == 1, "Expected exactly one viewer3 service")
    start = starts[0]
    end = next((i for i in range(start + 1, len(lines))
                if re.fullmatch(rb"  [A-Za-z0-9_-]+:[^\r\n]*\r?\n?", lines[i])), len(lines))
    candidates = [i for i in range(start + 1, end)
                  if re.match(rb"    image:[ \t]*", lines[i])]
    require(len(candidates) == 1, "Expected exactly one viewer3 image")
    index = candidates[0]
    old = lines[index]
    prefix = b"    image: "
    ending = b"\r\n" if old.endswith(b"\r\n") else b"\n" if old.endswith(b"\n") else b""
    require(old == prefix + previous.encode("ascii") + ending,
            "Base viewer3 pin does not match expected runtime")
    lines[index] = prefix + target.encode("ascii") + ending
    return b"".join(lines)


def atomic_write(path, payload, metadata):
    fd, name = tempfile.mkstemp(prefix=".viewer3-pin-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchown(stream.fileno(), metadata.st_uid, metadata.st_gid)
            os.fchmod(stream.fileno(), stat.S_IMODE(metadata.st_mode))
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def ready(image, attempts=25):
    for _ in range(attempts):
        try:
            require(runtime("viewer3") == image, "Viewer3 runtime mismatch")
            run(["docker", "exec", "viewer3", "sh", "-c",
                 'port="${PORT:-80}"; wget -q -O /dev/null "http://127.0.0.1:${port}/"'],
                timeout=10)
            return True
        except (RuntimeError, subprocess.SubprocessError):
            time.sleep(2)
    return False


def pull_images(root, images):
    # Credentials live only in a private temporary Docker client config.
    with tempfile.TemporaryDirectory(prefix=".viewer3-ecr-", dir=root) as config:
        env = dict(os.environ, DOCKER_CONFIG=config)
        password = run(["aws", "ecr", "get-login-password", "--region", "ca-central-1"], timeout=60)
        run(["docker", "login", "--username", "AWS", "--password-stdin", REGISTRY],
            input=password, env=env, timeout=60)
        for image in images:
            try:
                run(["docker", "image", "inspect", "--format", "{{.Id}}", image], timeout=15)
            except subprocess.CalledProcessError:
                run(["docker", "pull", image], env=env, timeout=240)
                run(["docker", "image", "inspect", "--format", "{{.Id}}", image], timeout=15)


def deploy_locked(root, target, previous):
    files = checked_files(root)
    base = root / "docker-compose.yml"
    original = base.read_bytes()
    metadata = base.stat()
    candidate = replace_viewer_pin(original, previous, target)
    # Verify all other managed pins with the established state utility.
    state = root / "scripts/operations/compose-image-state.py"
    before = effective_images(root)
    require(before.get("viewer3") == previous and runtime("viewer3") == previous,
            "Viewer3 runtime/effective image drift; no changes made")
    for service in OTHER_MANAGED:
        image = runtime(service)
        require(before.get(service) == image, "Effective image drift: " + service)
        run(["python3", str(state), service, image, image], cwd=str(root))
    require(ready(previous, attempts=1), "Previous Viewer3 not ready")
    unrelated = container_ids()
    other_files = {path: path.read_bytes() for path in files if path != base}
    def unchanged():
        require(all(path.read_bytes() == data for path, data in other_files.items()),
                "Other managed configuration changed")
        require(container_ids() == unrelated, "Unrelated container identity changed")
    print("VIEWER3_PREFLIGHT_PASS", flush=True)
    if target == previous:
        return
    pull_images(root, (previous, target))
    unchanged()
    require(base.read_bytes() == original and effective_images(root) == before
            and runtime("viewer3") == previous, "State changed during image preparation")
    # The separate Viewer3 release owns this base pin; images.yml continues
    # to own only the four existing managed services. Keep protected snapshots.
    evidence = Path(tempfile.mkdtemp(prefix=".ar-viewer3-before-", dir=root))
    backup = evidence / "docker-compose.yml"
    with backup.open("xb") as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(original)
        stream.flush()
        os.fsync(stream.fileno())
    print("VIEWER3_RECOVERY_SNAPSHOT=" + str(evidence), flush=True)
    desired = dict(before, viewer3=target)
    try:
        atomic_write(base, candidate, metadata)
        # Validate effective configuration before any container recreation.
        require(effective_images(root) == desired, "Candidate effective image mismatch")
        unchanged()
        compose(root, "up", "-d", "--no-deps", "--pull", "never", "viewer3")
        require(ready(target), "Target Viewer3 readiness failed")
        require(base.read_bytes() == candidate and effective_images(root) == desired,
                "Target persisted/effective image mismatch")
        unchanged()
    except Exception:
        # Reconcile actual bytes even if rename/fsync reported an error.
        # Never overwrite an unexpected concurrent configuration.
        try:
            require(all(path.read_bytes() == data for path, data in other_files.items()),
                    "Other managed config changed; recovery requires review")
            actual = base.read_bytes()
            require(actual in (original, candidate), "Unexpected base state; recovery requires review")
            if actual != original:
                atomic_write(base, original, metadata)
            require(effective_images(root) == before, "Rollback effective image mismatch")
            if not ready(previous, attempts=1):
                compose(root, "up", "-d", "--no-deps", "--pull", "never", "viewer3")
            require(ready(previous) and base.read_bytes() == original
                    and effective_images(root) == before, "Rollback runtime/pin verification failed")
            unchanged()
            print("VIEWER3_ROLLBACK_VERIFIED", flush=True)
        except Exception:
            print("VIEWER3_ROLLBACK_UNVERIFIED; retain snapshot and reconcile before retry", flush=True)
        raise
    print("VIEWER3_DEPLOYMENT_PASS", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target")
    parser.add_argument("previous")
    args = parser.parse_args()
    try:
        require(os.geteuid() == 0, "Managed deployment requires root SSM context")
        require(IMAGE_PATTERN.fullmatch(args.target) and IMAGE_PATTERN.fullmatch(args.previous),
                "Expected service-specific immutable target and previous images")
        os.umask(0o077)
        marker = ROOT / "config/compose/managed-enabled"
        require(marker.is_file() and not marker.is_symlink(), "Managed activation missing")
        m = marker.stat()
        require(m.st_uid == 0 and stat.S_IMODE(m.st_mode) == 0o600
                and marker.read_text().strip() == "AR_MANAGED_DEPLOYMENT_V1",
                "Managed activation not verified")
        lock_path = ROOT / ".ar-deployment.lock"
        fd = os.open(lock_path, os.O_RDWR | os.O_NOFOLLOW)
        with os.fdopen(fd, "r+") as lock:
            info = os.fstat(lock.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_uid == 0
                    and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1
                    and os.path.samestat(info, lock_path.stat()), "Unsafe deployment lock")
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            deploy_locked(ROOT, args.target, args.previous)
    except RuntimeError as error:
        parser.exit(1, "Viewer3 deployment stopped: " + str(error) + "\n")
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        parser.exit(1, "Viewer3 deployment stopped; reconcile managed state before retry.\n")


if __name__ == "__main__":
    main()
