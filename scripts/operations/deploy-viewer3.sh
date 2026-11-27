#!/usr/bin/env bash
# Managed Ubuntu/Docker host entry point. Never ship with the application image.
set -Eeuo pipefail
exec python3 "$(dirname -- "$0")/deploy-viewer3.py" "$@"
