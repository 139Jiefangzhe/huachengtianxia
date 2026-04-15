# Platform Scripts

## Runtime Prerequisites

Install stage-2 tool dependencies under `platform/`:

```bash
cd platform
npm install
```

## Stage-1 Utilities

### `init-db.sh`

Ensures required PostgreSQL extensions:
- `pgcrypto`
- `uuid-ossp`

### `backup.sh`

Creates point-in-time backups for:
- PostgreSQL dump (`postgres.sql`)
- MinIO data tarball (`minio-data.tar.gz`)

### `migrate-data.mjs`

Legacy stage-1 migration entrypoint (kept for compatibility).

## Schema Bootstrap

### `bootstrap-directus-schema.mjs`

Creates/updates required stage-2 Directus collections and fields:

- Collections: `articles`, `projects`, `categories`, `reports`, `quotes`
- Shared migration fields: `old_slug`, `legacy_url`, `raw_html_backup`, `content_clean`, `migration_status`, `migration_errors`
- SEO fields: `seo_title`, `seo_description`, `seo_keywords`
- Category extras: `layout_config`, `target_route_override`
- Audit collections: `migration_audit`, `redirect_audit`

Examples:

```bash
node platform/scripts/bootstrap-directus-schema.mjs --url http://localhost:8055
node platform/scripts/bootstrap-directus-schema.mjs --url http://localhost:8055 --dry-run
```

## Stage-2 TypeScript Scripts

Run from repository root with `npm --prefix platform run <script>`.

### `migrate-content.ts`

Main migration pipeline for HTML parsing/cleaning/import.

Features:
- `dry-run` and `import` modes
- checkpoint resume via `migration_state.json`
- resource fingerprint dedupe (`sha256 -> directus_file_id`)
- quote extraction confidence tiers (`high|medium|low`)
- strict missing-assets gate with domain policy (`platform/config/allowed-domains.json`)
- standalone outputs: `reports/quote-confidence-report.json`, `scripts/image-dedup-cache.json`
- runtime pipeline fields (`pipeline_status`, `pipeline_attempts`, `quarantine_reason`)
- batch rollback on import failure (`--batch-size`)
- stale-import recovery integration (`--stale-timeout-min`)
- auto-archived report output (`--auto-archived-report`)

Examples:

```bash
npm --prefix platform run migrate -- --mode dry-run --input mirror/hctxf_full/hctxf.org --report reports/dry-run-full.json --asset-policy platform/config/allowed-domains.json --strict-missing-assets true
npm --prefix platform run migrate -- --mode import --resume --directus-url http://localhost:28055 --directus-token <TOKEN> --report reports/migration/import-report.json
```

### `generate-redirects.ts`

Builds 301 mapping files for legacy URLs.

Outputs:
- `platform/nginx/conf.d/redirects/legacy.map`
- `platform/nginx/conf.d/redirects.map` (compat)
- `platform/scripts/data/legacy_urls.json`
- conflict report (`reports/redirect-conflicts.json`)
- special route config (`config/special-routes.json`)

Examples:

```bash
npm --prefix platform run generate-redirects -- --expected-total 664
npm --prefix platform run generate-redirects -- --apply-nginx --nginx-test-cmd "docker exec hctxf-nginx nginx -t" --nginx-reload-cmd "docker exec hctxf-nginx nginx -s reload"
```

### `validate-redirects.ts`

Validates redirect map integrity and live 301 behavior via sample checks.

Example:

```bash
npm --prefix platform run validate-redirects -- --map platform/nginx/conf.d/redirects/legacy.map --expected-total 664 --sample-size 20 --base-url http://localhost:28080
```

### `validate-import.ts`

Verifies import totals in Directus against expected `nd/col/nr` counts.

Example:

```bash
npm --prefix platform run validate-import -- --directus-url http://localhost:28055 --expected-articles 604 --expected-categories 60
```

### `acceptance-stage2.ts`

Runs full automated stage-2 acceptance:

- Source data integrity
- Directus schema audit
- Migration dry-run simulation
- SEO redirect coverage
- Nginx syntax + redirect sampling

Example:

```bash
npm --prefix platform run acceptance-stage2 -- --strict-enum true
```

## Stage-3 M0 Utilities

### `verify-state-consistency.ts`

Validates `migration_status` and `pipeline_status` consistency across content collections.

### `recover-stale-imports.ts`

Marks long-running `pipeline_status=importing` records as failed so they can be retried.

### `auto-heal-migration.ts`

Retries failed pipeline rows and archives records that exceed max attempts. Generates `final_error_report.csv`.

### `assert-canary.ts`

Runs fail-fast canary assertions:
1. synthetic sample must pass
2. high-risk real subset must pass

### `generate-change-list.ts`

Generates changed route list from Directus `published + imported` content for snapshot refresh.

### `crawl-static-snapshot.ts`

Fetches route list and writes versioned static HTML snapshot.
