# Stage 1: Infra & Schema

## Objective

Build the phase-1 baseline:
- Docker runtime for Nginx, Next.js, Directus, Postgres, MinIO, Redis
- Directus schema extension baseline
- Nginx redirect map entrypoint
- Migration script and ops scripts skeleton

## Folder Structure

```text
frontend/
backend/
platform/
  docker/
  nginx/
  scripts/
  schema/
docs/
```

## Boot Commands

```bash
cp platform/.env.example platform/.env
docker compose --env-file platform/.env -f platform/docker/compose.yml -f platform/docker/override.dev.yml up -d --build
```

## Verify

```bash
# Nginx health
curl -f http://localhost:8080/healthz

# Frontend health
curl -f http://localhost:8080/health

# Directus health
curl -f http://localhost:8055/server/ping

# MinIO live probe
curl -f http://localhost:9000/minio/health/live
```

## Directus Schema Work (UI-first)

Apply required stage-1 schema fields and audit collections (idempotent):

```bash
node platform/scripts/bootstrap-directus-schema.mjs --url http://localhost:8055
```

In Directus UI, you can then review/adjust fields:

- `articles`, `projects`, `categories`, `reports`:
  - `old_slug` (unique)
  - `legacy_url`
  - `raw_html_backup`
  - `content_clean`
  - `migration_status`
  - `migration_errors`
- New collections:
  - `migration_audit`
  - `redirect_audit`

Set Public role read permission for `articles`, `projects`.

Then export snapshot to Git-tracked path:

```bash
docker compose --env-file platform/.env -f platform/docker/compose.yml exec -T -u root directus \
  npx directus schema snapshot --yes --format json /workspace/schema/directus-snapshot.json
```

## Notes

- Stage-2 primary redirect map path is `platform/nginx/conf.d/redirects/legacy.map`.
- `platform/nginx/conf.d/redirects.map` is kept as compatibility output for transitional tooling.
- Do not store secrets in Git; keep real values in `platform/.env`.
