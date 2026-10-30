#!/usr/bin/env bash
# Ubuntu Docker-host deployment script delivered by SSM, never placed in the production image.
set -Eeuo pipefail
IMAGE="${1:?Usage: deploy-viewer3.sh <image@sha256:digest>}"
COMPOSE_DIR="${COMPOSE_DIR:-/home/ubuntu/compose}"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
WRAPPER="$COMPOSE_DIR/scripts/operations/ar-compose.py"
REGISTRY="804220655312.dkr.ecr.ca-central-1.amazonaws.com"

[[ "$IMAGE" =~ ^804220655312\.dkr\.ecr\.ca-central-1\.amazonaws\.com/s3orth:ohifar311-gha-[0-9a-f]{12}-[0-9]+@sha256:[0-9a-f]{64}$ ]] || { echo 'Refusing unpinned or unexpected viewer image' >&2; exit 2; }
[[ -f "$COMPOSE_FILE" && -f "$WRAPPER" ]] || { echo 'Missing Compose configuration or AR wrapper' >&2; exit 2; }
cd "$COMPOSE_DIR"

PREVIOUS_IMAGE="$(docker inspect viewer3 --format '{{.Config.Image}}')"
BACKUP="$(mktemp "$COMPOSE_DIR/.viewer3-compose-backup.XXXXXXXX.yml")"
cp -p "$COMPOSE_FILE" "$BACKUP"
DEPLOY_STARTED=false
rollback() {
  if [[ "$DEPLOY_STARTED" == true ]]; then
    echo 'Viewer3 deployment failed; restoring previous Compose image' >&2
    cp -p "$BACKUP" "$COMPOSE_FILE"
    python3 "$WRAPPER" config --quiet || true
    python3 "$WRAPPER" up -d --no-deps viewer3 || true
  fi
}
on_exit() {
  status=$?
  trap - EXIT
  if [[ "$status" -ne 0 ]]; then rollback; fi
  rm -f "$BACKUP"
  exit "$status"
}
trap on_exit EXIT

echo "PREVIOUS_IMAGE=$PREVIOUS_IMAGE"
echo "TARGET_IMAGE=$IMAGE"
aws ecr get-login-password --region ca-central-1 | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
docker pull "$IMAGE"

# Replace only services.viewer3.image in Compose; preserve file ownership and all other settings.
VIEWER3_IMAGE="$IMAGE" COMPOSE_FILE="$COMPOSE_FILE" python3 - <<'PY'
import os
import pathlib
import re
import stat
import tempfile
path = pathlib.Path(os.environ['COMPOSE_FILE'])
lines = path.read_text().splitlines(keepends=True)
starts = [i for i, line in enumerate(lines)
          if re.match(r'^  viewer3:\s*(?:#.*)?$', line.rstrip('\n'))]
if len(starts) != 1:
    raise SystemExit('Expected exactly one viewer3 service')
start = starts[0]
end = next((i for i in range(start+1, len(lines))
            if re.match(r'^  [A-Za-z0-9_-]+:\s*(?:#.*)?$', lines[i].rstrip('\n'))), len(lines))
images = [i for i in range(start+1, end) if re.match(r'^    image:\s*\S+', lines[i])]
if len(images) != 1:
    raise SystemExit('Expected exactly one viewer3.image property')
i = images[0]
lines[i] = '    image: ' + os.environ['VIEWER3_IMAGE'] + ('\r\n' if lines[i].endswith('\r\n') else '\n')
original = path.stat()
fd, temporary = tempfile.mkstemp(prefix='.viewer3-', suffix='.yml', dir=path.parent)
try:
    with os.fdopen(fd, 'w') as stream:
        stream.writelines(lines)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, stat.S_IMODE(original.st_mode))
    os.chown(temporary, original.st_uid, original.st_gid)
    os.replace(temporary, path)
except BaseException:
    if os.path.exists(temporary):
        os.unlink(temporary)
    raise
PY

DEPLOY_STARTED=true
python3 "$WRAPPER" config --quiet
python3 "$WRAPPER" up -d --no-deps viewer3
RUNNING_IMAGE="$(docker inspect viewer3 --format '{{.Config.Image}}')"
[[ "$RUNNING_IMAGE" == "$IMAGE" ]] || { echo 'Image mismatch' >&2; exit 1; }

ready=false
for attempt in $(seq 1 25); do
  if docker inspect viewer3 --format '{{.State.Running}}' | grep -qx true &&
     docker exec viewer3 sh -c 'wget -q -O /dev/null http://127.0.0.1:8080/' 2>/dev/null; then
    ready=true
    break
  fi
  sleep 2
done
[[ "$ready" == true ]] || { echo 'Viewer3 HTTP readiness failed' >&2; exit 1; }
echo "VIEWER3_DEPLOYMENT_PASS IMAGE=$RUNNING_IMAGE"
DEPLOY_STARTED=false
