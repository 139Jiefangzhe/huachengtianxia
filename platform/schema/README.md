# Directus Schema

This directory stores schema artifacts.

## Current status

- `directus-snapshot.json` stores the stage-2 schema snapshot (exported from Directus).
- Snapshot includes `quotes`, `seo_*`, `target_route_override`, and migration audit structures.
- Regenerate it whenever schema changes.

## Export real snapshot

After creating/updating collections and fields (UI or `platform/scripts/bootstrap-directus-schema.mjs`):

```bash
docker compose --env-file platform/.env -f platform/docker/compose.yml exec -T -u root directus \
  npx directus schema snapshot --yes --format json /workspace/schema/directus-snapshot.json
```

## Apply snapshot in a fresh environment

```bash
docker compose --env-file platform/.env -f platform/docker/compose.yml exec -T directus \
  npx directus schema apply /workspace/schema/directus-snapshot.json
```
