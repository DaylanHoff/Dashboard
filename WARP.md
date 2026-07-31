# Dashboard project rules

## Versioning (required)
- Treat `package.json` `version` as the app version shown to users (via `/api/config`).
- Whenever you change app behavior, UI, server code, dependencies, deploy config, or workflows in this repo, increment `package.json` `version` in the **same change**.
- Use semver:
  - **patch** (`x.y.Z`): bugfixes, small tweaks, dependency/deploy-only changes
  - **minor** (`x.Y.0`): new features/widgets/config options
  - **major** (`X.0.0`): breaking API/config/deploy changes
- Do not leave the version unchanged across functional commits.
- Mention the new version in the commit message when practical (e.g. `Bump to v1.0.2`).

## Deployment expectations
- Production runs on TrueNAS as custom app project `ix-dashboard` / container `kiosk-dashboard`.
- Image: `ghcr.io/daylanhoff/dashboard:latest`
- Compose include path on host:
  - `/mnt/.ix-apps/app_configs/dashboard/versions/1.0.0/templates/rendered/docker-compose.yaml`
  - includes `/mnt/PrimaryHDDs01/custom-apps/dashboard/compose.yaml`
- Runtime env file (not in git): `/mnt/PrimaryHDDs01/custom-apps/dashboard/.env`
- After a new image is published, deploy must **pull + force-recreate** the dashboard service with project name `ix-dashboard` (Watchtower alone is not the canonical path).
- Canonical automation on TrueNAS: `/mnt/PrimaryHDDs01/custom-apps/dashboard/auto-deploy.sh` via systemd timer `dashboard-auto-deploy.timer` (polls GHCR and force-recreates on digest change).
- TrueNAS API access from the app must use **JSON-RPC 2.0 over WSS** (`TRUENAS_PROTOCOL=https`). Plain `http`/`ws` can revoke API keys.

## Local agent / CI deploy command (canonical)
```bash
cd /mnt/.ix-apps/app_configs/dashboard/versions/1.0.0/templates/rendered
docker compose -p ix-dashboard -f docker-compose.yaml pull dashboard
docker compose -p ix-dashboard -f docker-compose.yaml up -d --force-recreate dashboard
```
