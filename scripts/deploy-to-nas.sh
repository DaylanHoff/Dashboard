#!/usr/bin/env bash
# Build the Dashboard image and deploy it to TrueNAS over SSH.
# Replaces GitHub Actions + GHCR + Watchtower.
#
# Modes:
#   1) Local Docker available  → build here, docker save | scp | load on NAS
#   2) No local Docker         → rsync sources to NAS and build there
#
# Usage:
#   ./scripts/deploy-to-nas.sh
#   TRUENAS_HOST=10.0.0.16 ./scripts/deploy-to-nas.sh
#   ./scripts/deploy-to-nas.sh --no-cache
#   ./scripts/deploy-to-nas.sh --remote-build   # force build on NAS
#
# Prerequisites:
#   - SSH key access to TrueNAS root (default: ~/.ssh/truenas_root_rsa)
#   - Remote compose at DASHBOARD_REMOTE_DIR/compose.yaml
#   - Docker on this machine OR on the NAS

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TRUENAS_HOST="${TRUENAS_HOST:-10.0.0.16}"
TRUENAS_USER="${TRUENAS_USER:-root}"
SSH_KEY="${TRUENAS_SSH_KEY:-$HOME/.ssh/truenas_root_rsa}"
IMAGE_NAME="${DASHBOARD_IMAGE:-dashboard:local}"
REMOTE_DIR="${DASHBOARD_REMOTE_DIR:-/mnt/PrimaryHDDs01/custom-apps/dashboard}"
REMOTE_BUILD_DIR="${DASHBOARD_REMOTE_BUILD_DIR:-/mnt/PrimaryHDDs01/custom-apps/dashboard/src}"
COMPOSE_FILE="${DASHBOARD_COMPOSE_FILE:-compose.yaml}"
COMPOSE_PROJECT="${DASHBOARD_COMPOSE_PROJECT:-ix-dashboard}"
SERVICE="${DASHBOARD_COMPOSE_SERVICE:-dashboard}"
CONTAINER_NAME="${DASHBOARD_CONTAINER:-kiosk-dashboard}"
NO_CACHE=0
FORCE_REMOTE_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --no-cache) NO_CACHE=1 ;;
    --remote-build) FORCE_REMOTE_BUILD=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "$SSH_KEY" ]]; then
  echo "SSH key not found: $SSH_KEY" >&2
  exit 1
fi

SSH=(ssh -o BatchMode=yes -o ConnectTimeout=20 -i "$SSH_KEY" "${TRUENAS_USER}@${TRUENAS_HOST}")
SCP=(scp -o BatchMode=yes -o ConnectTimeout=20 -i "$SSH_KEY")

log() { printf '[deploy] %s\n' "$*"; }

log "checking SSH ${TRUENAS_USER}@${TRUENAS_HOST}"
"${SSH[@]}" 'hostname; cat /etc/version; docker version --format "{{.Server.Version}}" >/dev/null'

HAVE_LOCAL_DOCKER=0
if [[ "$FORCE_REMOTE_BUILD" -eq 0 ]] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  HAVE_LOCAL_DOCKER=1
fi

remote_recreate() {
  "${SSH[@]}" bash -s <<EOF
set -euo pipefail
REMOTE_DIR=$(printf '%q' "$REMOTE_DIR")
COMPOSE_FILE=$(printf '%q' "$COMPOSE_FILE")
COMPOSE_PROJECT=$(printf '%q' "$COMPOSE_PROJECT")
SERVICE=$(printf '%q' "$SERVICE")
IMAGE_NAME=$(printf '%q' "$IMAGE_NAME")
CONTAINER_NAME=$(printf '%q' "$CONTAINER_NAME")

if [[ ! -f "\$REMOTE_DIR/\$COMPOSE_FILE" ]]; then
  echo "missing compose file \$REMOTE_DIR/\$COMPOSE_FILE" >&2
  exit 1
fi

cd "\$REMOTE_DIR"
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose -p "\$COMPOSE_PROJECT" -f "\$COMPOSE_FILE")
else
  COMPOSE=(docker-compose -p "\$COMPOSE_PROJECT" -f "\$COMPOSE_FILE")
fi

# Ensure image tag exists
if ! docker image inspect "\$IMAGE_NAME" >/dev/null 2>&1; then
  echo "image \$IMAGE_NAME not found on NAS" >&2
  exit 1
fi

"\${COMPOSE[@]}" up -d --force-recreate --no-deps "\$SERVICE"
sleep 2

status="\$(docker ps --filter "name=\${CONTAINER_NAME}" --format '{{.Names}} {{.Image}} {{.Status}}' || true)"
echo "status: \${status}"

if body="\$(curl -fsS --max-time 20 http://127.0.0.1:1337/api/config 2>/dev/null)"; then
  ver="\$(printf '%s' "\$body" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("version",""))' 2>/dev/null || true)"
  echo "health: /api/config ok version=\${ver:-unknown}"
else
  echo "warn: /api/config health check failed" >&2
  docker logs "\$CONTAINER_NAME" --tail 50 >&2 || true
  exit 1
fi

printf '%s %s\\n' "\$(date -Is)" "\$IMAGE_NAME" >> "\$REMOTE_DIR/.last-local-deploy"
EOF
}

if [[ "$HAVE_LOCAL_DOCKER" -eq 1 ]]; then
  BUILD_ARGS=(build -t "$IMAGE_NAME")
  if [[ "$NO_CACHE" -eq 1 ]]; then
    BUILD_ARGS+=(--no-cache)
  fi
  BUILD_ARGS+=("$ROOT")

  log "building $IMAGE_NAME locally"
  docker "${BUILD_ARGS[@]}"

  TMP_TAR="$(mktemp -t dashboard-image.XXXXXX.tar)"
  cleanup() { rm -f "$TMP_TAR"; }
  trap cleanup EXIT

  log "saving image to $TMP_TAR"
  docker save -o "$TMP_TAR" "$IMAGE_NAME"

  REMOTE_TAR="/tmp/dashboard-image-$$.tar"
  log "copying image to NAS ($REMOTE_TAR)"
  "${SCP[@]}" "$TMP_TAR" "${TRUENAS_USER}@${TRUENAS_HOST}:${REMOTE_TAR}"

  log "loading image on NAS"
  "${SSH[@]}" "docker load -i $(printf '%q' "$REMOTE_TAR") && rm -f $(printf '%q' "$REMOTE_TAR")"
else
  log "local Docker not available — rsync + build on NAS"
  if ! command -v rsync >/dev/null 2>&1; then
    echo "rsync is required for remote builds" >&2
    exit 1
  fi

  log "syncing sources → ${TRUENAS_USER}@${TRUENAS_HOST}:${REMOTE_BUILD_DIR}"
  "${SSH[@]}" "mkdir -p $(printf '%q' "$REMOTE_BUILD_DIR")"
  rsync -az --delete \
    -e "ssh -o BatchMode=yes -o ConnectTimeout=20 -i ${SSH_KEY}" \
    --exclude '.git/' \
    --exclude 'node_modules/' \
    --exclude 'data/layout.json' \
    --exclude 'data/sources.json' \
    --exclude '.env' \
    --exclude '*.tar' \
    "$ROOT/" "${TRUENAS_USER}@${TRUENAS_HOST}:${REMOTE_BUILD_DIR}/"

  NO_CACHE_FLAG=""
  if [[ "$NO_CACHE" -eq 1 ]]; then
    NO_CACHE_FLAG="--no-cache"
  fi

  log "building $IMAGE_NAME on NAS"
  "${SSH[@]}" bash -s <<EOF
set -euo pipefail
cd $(printf '%q' "$REMOTE_BUILD_DIR")
docker build $NO_CACHE_FLAG -t $(printf '%q' "$IMAGE_NAME") .
EOF
fi

log "recreating container"
remote_recreate

log "done — dashboard should be at http://${TRUENAS_HOST}:1337"
log "note: if TrueNAS widget fails auth, create a new API key (old keys may be revoked for insecure transport)"
