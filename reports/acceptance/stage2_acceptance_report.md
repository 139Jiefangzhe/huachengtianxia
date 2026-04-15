# HCTXF Stage-2 自动化验收报告

- 生成时间: 2026-04-15T03:32:00.889Z
- 总体结论: **FAIL**
- 步骤统计: PASS=5, WARN=0, FAIL=1

## 输入信息

- manifest: `/home/haoran/web_hctx/huachengtinaxia/reports/frontend_extract/frontend_file_manifest.csv`
- layout map: `/home/haoran/web_hctx/huachengtinaxia/reports/frontend_extract/layout_signature_mapping.csv`
- layout architecture: `/home/haoran/web_hctx/huachengtinaxia/reports/frontend_extract/layout_architecture.md`
- Directus: `http://localhost:28055`
- Nginx base URL: `http://localhost:28080`

## 1. Source Data Integrity (PASS)

| Check | Status | Detail |
|---|---|---|
| core_page_counts | PASS | nd/col/nr/index match expected (665) |
| core_total_665 | PASS | actual=665, expected=665 |

Evidence:
```json
{
  "manifest_path": "/home/haoran/web_hctx/huachengtinaxia/reports/frontend_extract/frontend_file_manifest.csv",
  "page_family_counts": {
    "": 1130,
    "other": 35,
    "col": 39,
    "index": 1,
    "nd": 604,
    "nr": 21
  },
  "expected": {
    "nd": 604,
    "col": 39,
    "nr": 21,
    "index": 1
  },
  "actual": {
    "nd": 604,
    "col": 39,
    "nr": 21,
    "index": 1
  },
  "core_total_actual": 665,
  "core_total_expected": 665
}
```

## 2. Directus Schema Audit (PASS)

| Check | Status | Detail |
|---|---|---|
| required_collections | PASS | All required collections exist |
| required_fields | PASS | All required fields exist |
| old_slug_unique_index | PASS | All old_slug fields are unique |
| migration_status_enum | PASS | Enum tokens detected in field metadata |

Evidence:
```json
{
  "directus_url": "http://localhost:28055",
  "collections_count": 33,
  "missing_collections": [],
  "missing_fields": [],
  "unique_old_slug": {
    "articles": true,
    "projects": true,
    "categories": true,
    "reports": true
  },
  "migration_status_meta": {
    "options": {
      "choices": [
        {
          "text": "draft_raw",
          "value": "draft_raw"
        },
        {
          "text": "cleaned",
          "value": "cleaned"
        },
        {
          "text": "needs_review",
          "value": "needs_review"
        },
        {
          "text": "approved",
          "value": "approved"
        },
        {
          "text": "published",
          "value": "published"
        }
      ],
      "allowNone": true
    },
    "validation": null,
    "note": "draft_raw/cleaned/needs_review/approved/published"
  }
}
```

## 3. Dry-Run Simulation (FAIL)

| Check | Status | Detail |
|---|---|---|
| dry_run_execution | FAIL | Dry-run command failed (code=1) |

Errors:
- dry_run_execution: Dry-run command failed (code=1)
- [migrate-content] fatal: Error: Dry-run blocked: error_rate=0.0887 exceeds threshold=0.0500
    at main (/home/haoran/web_hctx/huachengtinaxia/platform/scripts/migrate-content.ts:1501:11)


Evidence:
```json
{
  "command": "npm --prefix platform run migrate -- --mode dry-run --input \"/home/haoran/web_hctx/huachengtinaxia/mirror/hctxf_full/hctxf.org\" --manifest \"/home/haoran/web_hctx/huachengtinaxia/reports/frontend_extract/frontend_file_manifest.csv\" --layout-map \"/home/haoran/web_hctx/huachengtinaxia/reports/frontend_extract/layout_signature_mapping.csv\" --report \"/tmp/hctxf_acceptance/dry-run-report.json\" --state \"/tmp/hctxf_acceptance/migration_state.json\" --fingerprint-map \"/tmp/hctxf_acceptance/fingerprint_map.json\" --dedup-cache \"/tmp/hctxf_acceptance/image-dedup-cache.json\" --missing-assets \"/tmp/hctxf_acceptance/missing_assets.csv\" --quote-report \"/tmp/hctxf_acceptance/quote-confidence-report.json\" --asset-policy \"/home/haoran/web_hctx/huachengtinaxia/platform/config/allowed-domains.json\" --strict-missing-assets true --expected-error-rate 0.05 --retry 1 --reset-state",
  "exit_code": 1,
  "stdout_tail": "\n> hctxf-platform-tools@0.1.0 migrate\n> tsx scripts/migrate-content.ts --mode dry-run --input /home/haoran/web_hctx/huachengtinaxia/mirror/hctxf_full/hctxf.org --manifest /home/haoran/web_hctx/huachengtinaxia/reports/frontend_extract/frontend_file_manifest.csv --layout-map /home/haoran/web_hctx/huachengtinaxia/reports/frontend_extract/layout_signature_mapping.csv --report /tmp/hctxf_acceptance/dry-run-report.json --state /tmp/hctxf_acceptance/migration_state.json --fingerprint-map /tmp/hctxf_acceptance/fingerprint_map.json --dedup-cache /tmp/hctxf_acceptance/image-dedup-cache.json --missing-assets /tmp/hctxf_acceptance/missing_assets.csv --quote-report /tmp/hctxf_acceptance/quote-confidence-report.json --asset-policy /home/haoran/web_hctx/huachengtinaxia/platform/config/allowed-domains.json --strict-missing-assets true --expected-error-rate 0.05 --retry 1 --reset-state\n\n[migrate-content] mode=dry-run input=/home/haoran/web_hctx/huachengtinaxia/mirror/hctxf_full/hctxf.org concurrency=5\n[migrate-content] processed=25/665\n[migrate-content] processed=50/665\n[migrate-content] processed=75/665\n[migrate-content] processed=100/665\n[migrate-content] processed=125/665\n[migrate-content] processed=150/665\n[migrate-content] processed=175/665\n[migrate-content] processed=200/665\n[migrate-content] processed=225/665\n[migrate-content] processed=250/665\n[migrate-content] processed=275/665\n[migrate-content] processed=300/665\n[migrate-content] processed=325/665\n[migrate-content] processed=350/665\n[migrate-content] processed=375/665\n[migrate-content] processed=400/665\n[migrate-content] processed=425/665\n[migrate-content] processed=450/665\n[migrate-content] processed=475/665\n[migrate-content] processed=500/665\n[migrate-content] processed=525/665\n[migrate-content] processed=550/665\n[migrate-content] processed=575/665\n[migrate-content] processed=600/665\n[migrate-content] processed=625/665\n[migrate-content] processed=650/665\n[migrate-content] done report=/tmp/hctxf_acceptance/dry-run-report.json\n[migrate-content] quote report=/tmp/hctxf_acceptance/quote-confidence-report.json\n[migrate-content] auto archived report=/home/haoran/web_hctx/huachengtinaxia/reports/migration/auto_archived_report.csv\n[migrate-content] totals={\"total\":665,\"success\":606,\"needs_review\":59,\"failed\":59} error_rate=0.0887\n[migrate-content] missing_assets critical=0, low=2, total=2\n",
  "stderr_tail": "[migrate-content] fatal: Error: Dry-run blocked: error_rate=0.0887 exceeds threshold=0.0500\n    at main (/home/haoran/web_hctx/huachengtinaxia/platform/scripts/migrate-content.ts:1501:11)\n"
}
```

## 4. SEO Redirect Coverage (PASS)

| Check | Status | Detail |
|---|---|---|
| mapping_count_gte_664 | PASS | generated=664, required>=664 |
| mapping_coverage_100pct | PASS | coverage=100.00%, mapped=664/664 |
| route_pattern_rules | PASS | All mapping rules match expected patterns |
| special_route_conflict_free | PASS | conflicts=0, high_risk_missing_override=0 |

Evidence:
```json
{
  "command": "npm --prefix platform run generate-redirects -- --input \"/home/haoran/web_hctx/huachengtinaxia/mirror/hctxf_full/hctxf.org\" --manifest \"/home/haoran/web_hctx/huachengtinaxia/reports/frontend_extract/frontend_file_manifest.csv\" --layout-map \"/home/haoran/web_hctx/huachengtinaxia/reports/frontend_extract/layout_signature_mapping.csv\" --migration-report \"/tmp/hctxf_acceptance/dry-run-report.json\" --special-routes \"/home/haoran/web_hctx/huachengtinaxia/config/special-routes.json\" --conflict-report \"/tmp/hctxf_acceptance/redirect_conflicts.json\" --strict-special-check true --output-map \"/tmp/hctxf_acceptance/legacy.map\" --compat-map \"/tmp/hctxf_acceptance/redirects.map\" --output-json \"/tmp/hctxf_acceptance/legacy_urls.json\" --expected-total 664 --directus-url \"http://localhost:28055\" --directus-email \"admin@example.com\" --directus-password \"ChangeMe_123456\"",
  "exit_code": 0,
  "old_urls_from_layout": 664,
  "generated_entries": 664,
  "coverage": 1,
  "unmapped_urls": [],
  "unmapped_count": 0,
  "invalid_rule_count": 0,
  "invalid_rule_samples": [],
  "special_route_conflicts": 0,
  "high_risk_missing_override": 0,
  "redirect_conflict_temp": "/tmp/hctxf_acceptance/redirect_conflicts.json",
  "redirect_map_temp": "/tmp/hctxf_acceptance/legacy.map",
  "redirect_json_temp": "/tmp/hctxf_acceptance/legacy_urls.json"
}
```

## 5. Nginx Config Check (PASS)

| Check | Status | Detail |
|---|---|---|
| legacy_map_exists_non_empty | PASS | exists=true, size=19935 |
| nginx_syntax | PASS | nginx -t passed |
| sample_redirects | PASS | All sample redirects passed |

Evidence:
```json
{
  "legacy_map_path": "/home/haoran/web_hctx/huachengtinaxia/platform/nginx/conf.d/redirects/legacy.map",
  "legacy_map_size": 19935,
  "nginx_test": {
    "code": 0,
    "stdout": "",
    "stderr": "nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful"
  },
  "base_url": "http://localhost:28080",
  "col3b75_override": null,
  "samples": [
    {
      "url": "/nd004c.html",
      "status": 301,
      "location": "/news/nd004c",
      "pass": true,
      "rule": "location starts with /news/"
    },
    {
      "url": "/col0a4e.html",
      "status": 301,
      "location": "/news/category/col0a4e",
      "pass": true,
      "rule": "location starts with /news/category/"
    },
    {
      "url": "/col3b75.html",
      "status": 301,
      "location": "/transparency",
      "pass": true,
      "rule": "location equals /transparency or starts with /news/category/"
    },
    {
      "url": "/nr.html",
      "status": 301,
      "location": "/news/category/nr",
      "pass": true,
      "rule": "location starts with /news/category/"
    },
    {
      "url": "/nr0b2e.html",
      "status": 301,
      "location": "/news/category/nr0b2e",
      "pass": true,
      "rule": "location starts with /news/category/"
    }
  ]
}
```

## 6. Deliverables Check (PASS)

| Check | Status | Detail |
|---|---|---|
| required_deliverables | PASS | All required deliverables exist and non-empty |
| dry_run_full_missing_assets_zero | PASS | reports/dry-run-full.json missing_assets_count=0 |

Evidence:
```json
{
  "required_files": {
    "/home/haoran/web_hctx/huachengtinaxia/config/special-routes.json": {
      "exists": true,
      "size": 123
    },
    "/home/haoran/web_hctx/huachengtinaxia/reports/missing_assets.csv": {
      "exists": true,
      "size": 110
    },
    "/home/haoran/web_hctx/huachengtinaxia/reports/quote-confidence-report.json": {
      "exists": true,
      "size": 276
    },
    "/home/haoran/web_hctx/huachengtinaxia/scripts/image-dedup-cache.json": {
      "exists": true,
      "size": 43054
    },
    "/home/haoran/web_hctx/huachengtinaxia/reports/dry-run-full.json": {
      "exists": true,
      "size": 361360
    },
    "/home/haoran/web_hctx/huachengtinaxia/platform/scripts/data/legacy_urls.json": {
      "exists": true,
      "size": 308294
    }
  },
  "dry_run_full_missing_assets_count": 0
}
```

## 产物

- dry_run_report: `/tmp/hctxf_acceptance/dry-run-report.json`
- dry_run_quote_report: `/tmp/hctxf_acceptance/quote-confidence-report.json`
- dry_run_missing_assets: `/tmp/hctxf_acceptance/missing_assets.csv`
- redirect_map_temp: `/tmp/hctxf_acceptance/legacy.map`
- redirect_json_temp: `/tmp/hctxf_acceptance/legacy_urls.json`
- redirect_conflict_temp: `/tmp/hctxf_acceptance/redirect_conflicts.json`
