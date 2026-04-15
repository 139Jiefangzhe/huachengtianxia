# Stage-2 Operation Guide

## 1. Prepare Environment

```bash
cd /home/haoran/web_hctx/huachengtinaxia
npm --prefix platform install
```

Ensure containers are healthy:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

## 2. Bootstrap Directus Schema

```bash
node platform/scripts/bootstrap-directus-schema.mjs --url http://localhost:28055
```

This creates/updates stage-2 collections and fields (`quotes`, `seo_*`, `target_route_override`, audit tables).

## 3. Run Dry-Run Migration (Quality Gate)

```bash
npm --prefix platform run migrate -- \
  --mode dry-run \
  --input mirror/hctxf_full/hctxf.org \
  --report reports/dry-run-full.json \
  --missing-assets reports/missing_assets.csv \
  --quote-report reports/quote-confidence-report.json \
  --dedup-cache scripts/image-dedup-cache.json \
  --asset-policy platform/config/allowed-domains.json \
  --strict-missing-assets true \
  --expected-error-rate 0.05
```

Review outputs:
- `reports/dry-run-full.json`
- `reports/missing_assets.csv`
- `reports/quote-confidence-report.json`
- `scripts/image-dedup-cache.json`
- `reports/migration/migration_state.json`
- `reports/migration/fingerprint_map.json`

Gate rule:
- `error_rate > 0.05` => block import and fix parser/asset issues.
- `missing_assets_count > 0` (critical domains) => block import and resolve/approve manual ignore list.
- `error_rate <= 0.05` + `missing_assets_count == 0` => continue to import.

## 4. Run Import Migration

```bash
npm --prefix platform run migrate -- \
  --mode import \
  --resume \
  --directus-url http://localhost:28055 \
  --directus-token <DIRECTUS_STATIC_TOKEN> \
  --report reports/migration/import-report.json
```

All imported records are written with `migration_status=needs_review`.

## 5. Review in Directus Admin

### Article/Category Review
- Filter `migration_status = needs_review`.
- Check content blocks, image rendering, and broken assets.
- Approve by updating to `approved` or `published`.

### Quote Review
- Open `quotes` collection.
- Filter `confidence != high` or `review_status = needs_review`.
- Confirm questionable quote extraction before publish.

## 6. Generate and Apply Redirect Map

```bash
npm --prefix platform run generate-redirects -- \
  --special-routes config/special-routes.json \
  --conflict-report reports/redirect-conflicts.json \
  --strict-special-check true \
  --expected-total 664 \
  --directus-url http://localhost:28055 \
  --directus-email admin@example.com \
  --directus-password ChangeMe_123456 \
  --apply-nginx \
  --nginx-test-cmd "docker exec hctxf-nginx nginx -t" \
  --nginx-reload-cmd "docker exec hctxf-nginx nginx -s reload"
```

Primary output file:
- `platform/nginx/conf.d/redirects/legacy.map`
- `platform/scripts/data/legacy_urls.json`
- `reports/redirect-conflicts.json`

## 7. Validate Redirect Coverage

```bash
npm --prefix platform run validate-redirects -- \
  --map platform/nginx/conf.d/redirects/legacy.map \
  --expected-total 664 \
  --sample-size 20 \
  --base-url http://localhost:28080
```

Pass criteria:
- 664 mappings
- no duplicate keys
- sampled URLs return `301` with expected `Location`

## 8. Validate Import Consistency

```bash
npm --prefix platform run validate-import -- \
  --directus-url http://localhost:28055 \
  --expected-articles 604 \
  --expected-categories 60
```

Pass criteria:
- article count (`old_slug` starts with `nd`) == 604
- category count (`old_slug` starts with `col` or `nr`) == 60

## 9. Resume and Recovery

- Resume interrupted migration:

```bash
npm --prefix platform run migrate -- --mode import --resume
```

- Force clean restart:

```bash
npm --prefix platform run migrate -- --mode dry-run --reset-state
```

State files used for resume:
- `reports/migration/migration_state.json`
- `reports/migration/fingerprint_map.json`
