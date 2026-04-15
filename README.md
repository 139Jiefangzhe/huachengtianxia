# HCTXF Repo Scaffold

This repository currently contains:

- `mirror/`: legacy site mirror assets
- `reports/`: migration analysis and architecture docs
- `platform/`: infrastructure, schema bootstrap, and stage-2 migration tooling
- `frontend/`: Next.js frontend scaffold (stage 1)
- `backend/`: optional custom backend placeholder
- `docs/`: implementation notes

## Stage 1 quick start

1. Copy env template:

```bash
cp platform/.env.example platform/.env
```

2. Start infra:

```bash
docker compose --env-file platform/.env -f platform/docker/compose.yml -f platform/docker/override.dev.yml up -d --build
```

3. Open services:

- Site gateway: `http://localhost:8080`
- Directus: `http://localhost:8055`
- MinIO Console (via Nginx): `http://localhost:9001`

4. Bootstrap Directus stage-1 schema:

```bash
node platform/scripts/bootstrap-directus-schema.mjs --url http://localhost:8055
```

For stage-2 migration and QA operations, see `docs/operation-guide.md`.
