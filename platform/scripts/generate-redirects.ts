#!/usr/bin/env tsx
import { promises as fs } from "node:fs";
import path from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import {
  buildTimestamp,
  detectLegacyPageType,
  getBooleanArg,
  getNumberArg,
  getStringArg,
  listLegacyHtmlFiles,
  parseArgs,
  readIfExists,
  readTable,
  resolveRepoPath,
  slugify,
  writeJsonAtomic
} from "./lib/common.js";
import { DirectusClient } from "./lib/directus.js";

const exec = promisify(execCb);

type RedirectOptions = {
  inputDir: string;
  manifestPath: string;
  layoutMapPath: string;
  migrationReportPath: string;
  specialRoutesPath: string;
  conflictReportPath: string;
  outputMapPath: string;
  outputMapInternalPath: string;
  compatMapPath: string;
  outputJsonPath: string;
  expectedTotal: number;
  expectedTotalInternal: number;
  includeTestData: boolean;
  strictSpecialCheck: boolean;
  environment: string;
  directusUrl: string;
  directusToken: string;
  directusEmail: string;
  directusPassword: string;
  applyNginx: boolean;
  nginxTestCmd: string;
  nginxReloadCmd: string;
};

type RedirectEntry = {
  old_url: string;
  old_slug: string;
  page_type: "nd" | "col" | "nr";
  target_url: string;
  strategy: "default" | "override";
};

const DEFAULTS: RedirectOptions = {
  inputDir: "mirror/hctxf_full/hctxf.org",
  manifestPath: "reports/frontend_extract/frontend_file_manifest.tsv",
  layoutMapPath: "reports/frontend_extract/layout_signature_mapping.tsv",
  migrationReportPath: "reports/migration/dry-run-report.json",
  specialRoutesPath: "config/special-routes.json",
  conflictReportPath: "reports/redirect-conflicts.json",
  outputMapPath: "platform/nginx/conf.d/redirects/legacy.map",
  outputMapInternalPath: "platform/nginx/conf.d/redirects/legacy.internal.map",
  compatMapPath: "platform/nginx/conf.d/redirects.map",
  outputJsonPath: "platform/scripts/data/legacy_urls.json",
  expectedTotal: 664,
  expectedTotalInternal: 0,
  includeTestData: false,
  strictSpecialCheck: true,
  environment: process.env.TARGET_ENV || "development",
  directusUrl: process.env.DIRECTUS_URL || process.env.DIRECTUS_PUBLIC_URL || "http://localhost:8055",
  directusToken: process.env.DIRECTUS_TOKEN || "",
  directusEmail: process.env.DIRECTUS_ADMIN_EMAIL || "admin@example.com",
  directusPassword: process.env.DIRECTUS_ADMIN_PASSWORD || "ChangeMe_123456",
  applyNginx: false,
  nginxTestCmd: "docker exec hctxf-nginx nginx -t",
  nginxReloadCmd: "docker exec hctxf-nginx nginx -s reload"
};

function parseCli(): RedirectOptions {
  const args = parseArgs(process.argv);
  return {
    ...DEFAULTS,
    inputDir: resolveRepoPath(getStringArg(args, "input", DEFAULTS.inputDir)),
    manifestPath: resolveRepoPath(getStringArg(args, "manifest", DEFAULTS.manifestPath)),
    layoutMapPath: resolveRepoPath(getStringArg(args, "layout-map", DEFAULTS.layoutMapPath)),
    migrationReportPath: resolveRepoPath(getStringArg(args, "migration-report", DEFAULTS.migrationReportPath)),
    specialRoutesPath: resolveRepoPath(getStringArg(args, "special-routes", DEFAULTS.specialRoutesPath)),
    conflictReportPath: resolveRepoPath(getStringArg(args, "conflict-report", DEFAULTS.conflictReportPath)),
    outputMapPath: resolveRepoPath(getStringArg(args, "output-map", DEFAULTS.outputMapPath)),
    outputMapInternalPath: resolveRepoPath(getStringArg(args, "output-map-internal", DEFAULTS.outputMapInternalPath)),
    compatMapPath: resolveRepoPath(getStringArg(args, "compat-map", DEFAULTS.compatMapPath)),
    outputJsonPath: resolveRepoPath(getStringArg(args, "output-json", DEFAULTS.outputJsonPath)),
    expectedTotal: getNumberArg(args, "expected-total", DEFAULTS.expectedTotal),
    expectedTotalInternal: getNumberArg(args, "expected-total-internal", DEFAULTS.expectedTotalInternal),
    includeTestData: getBooleanArg(args, "include-test-data", DEFAULTS.includeTestData),
    strictSpecialCheck: getBooleanArg(args, "strict-special-check", DEFAULTS.strictSpecialCheck),
    environment: getStringArg(args, "environment", DEFAULTS.environment),
    directusUrl: getStringArg(args, "directus-url", DEFAULTS.directusUrl),
    directusToken: getStringArg(args, "directus-token", DEFAULTS.directusToken),
    directusEmail: getStringArg(args, "directus-email", DEFAULTS.directusEmail),
    directusPassword: getStringArg(args, "directus-password", DEFAULTS.directusPassword),
    applyNginx: getBooleanArg(args, "apply-nginx", DEFAULTS.applyNginx),
    nginxTestCmd: getStringArg(args, "nginx-test-cmd", DEFAULTS.nginxTestCmd),
    nginxReloadCmd: getStringArg(args, "nginx-reload-cmd", DEFAULTS.nginxReloadCmd)
  };
}

function inferOverrideByTitle(title: string): string | null {
  const t = title || "";
  if (/财务|审计|报告|公示/i.test(t)) {
    return "/transparency";
  }
  if (/团队|理事|成员|组织架构/i.test(t)) {
    return "/about/team";
  }
  if (/关于/i.test(t)) {
    return "/about";
  }
  if (/联系|客服/i.test(t)) {
    return "/contact";
  }
  return null;
}

function normalizeSpecialRouteKey(input: string): string {
  const raw = input.trim().toLowerCase();
  if (!raw) {
    return "";
  }
  if (raw.endsWith(".html")) {
    return raw;
  }
  return `${raw}.html`;
}

async function loadSpecialRoutes(filePath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const raw = await readIfExists(filePath);
  if (!raw) {
    return map;
  }

  try {
    const json = JSON.parse(raw);
    for (const [k, v] of Object.entries(json || {})) {
      if (typeof v !== "string" || !v.trim()) {
        continue;
      }
      const key = normalizeSpecialRouteKey(k);
      if (!key) {
        continue;
      }
      map.set(key, v.trim());
    }
  } catch (error) {
    throw new Error(`Invalid special routes JSON (${filePath}): ${String((error as Error).message || error)}`);
  }
  return map;
}

async function collectHighRiskColumns(layoutMapPath: string): Promise<Set<string>> {
  const out = new Set<string>();
  const raw = await readIfExists(layoutMapPath);
  if (!raw) {
    return out;
  }

  const HIGH_RISK_MODULES = new Set([
    "545",
    "546",
    "547",
    "548",
    "549",
    "550",
    "551",
    "552",
    "553",
    "554",
    "555",
    "556",
    "557",
    "558",
    "559",
    "560",
    "561",
    "562",
    "563",
    "601",
    "602",
    "603"
  ]);

  const rows = await readTable(layoutMapPath);
  for (const row of rows) {
    if ((row.page_family || "").trim().toLowerCase() !== "col") {
      continue;
    }
    const moduleIds = (row.module_ids || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (!moduleIds.some((id) => HIGH_RISK_MODULES.has(id))) {
      continue;
    }

    const filesColumn = row.files || "";
    for (const item of filesColumn.split(",").map((s) => s.trim()).filter(Boolean)) {
      const fileName = path.basename(item).toLowerCase();
      if (detectLegacyPageType(fileName) === "col") {
        out.add(fileName);
      }
    }
  }
  return out;
}

async function collectLegacyPages(options: RedirectOptions): Promise<Map<string, "nd" | "col" | "nr">> {
  const map = new Map<string, "nd" | "col" | "nr">();

  const addPath = (relativePath: string) => {
    const normalized = relativePath.replace(/^\/+/, "");
    const fileName = path.basename(normalized).toLowerCase();
    const type = detectLegacyPageType(fileName);
    if (type === "nd" || type === "col" || type === "nr") {
      map.set(fileName, type);
    }
  };

  const manifestRaw = await readIfExists(options.manifestPath);
  if (manifestRaw) {
    const manifestRows = await readTable(options.manifestPath);
    for (const row of manifestRows) {
      if (row.relative_path) {
        addPath(row.relative_path);
      }
    }
  }

  const layoutRaw = await readIfExists(options.layoutMapPath);
  if (layoutRaw) {
    const layoutRows = await readTable(options.layoutMapPath);
    for (const row of layoutRows) {
      const filesColumn = row.files || "";
      for (const item of filesColumn.split(",").map((s) => s.trim()).filter(Boolean)) {
        addPath(item);
      }
      if (row.representative_file) {
        addPath(row.representative_file);
      }
    }
  }

  const diskFiles = await listLegacyHtmlFiles(options.inputDir);
  for (const abs of diskFiles) {
    addPath(path.basename(abs));
  }

  return map;
}

async function loadSlugHints(reportPath: string): Promise<{
  slugByOldSlug: Map<string, string>;
  categoryTitleByOldSlug: Map<string, string>;
}> {
  const slugByOldSlug = new Map<string, string>();
  const categoryTitleByOldSlug = new Map<string, string>();
  const raw = await readIfExists(reportPath);
  if (!raw) {
    return { slugByOldSlug, categoryTitleByOldSlug };
  }

  try {
    const json = JSON.parse(raw);
    const results = Array.isArray(json?.results) ? json.results : [];
    for (const item of results) {
      if (item?.old_slug && item?.slug) {
        slugByOldSlug.set(String(item.old_slug), String(item.slug));
      }
      if ((item?.page_type === "col" || item?.page_type === "nr") && item?.old_slug && item?.title) {
        categoryTitleByOldSlug.set(String(item.old_slug), String(item.title));
      }
    }
  } catch {
    // Ignore report parse errors and fallback to slug from old_slug.
  }

  return { slugByOldSlug, categoryTitleByOldSlug };
}

async function loadDirectusOverrides(options: RedirectOptions): Promise<{
  articleSlugByOldSlug: Map<string, string>;
  categorySlugByOldSlug: Map<string, string>;
  categoryOverrideByOldSlug: Map<string, string>;
  testDataOldSlugs: Set<string>;
}> {
  const articleSlugByOldSlug = new Map<string, string>();
  const categorySlugByOldSlug = new Map<string, string>();
  const categoryOverrideByOldSlug = new Map<string, string>();
  const testDataOldSlugs = new Set<string>();

  try {
    const directus = await DirectusClient.create({
      baseUrl: options.directusUrl,
      token: options.directusToken || undefined,
      email: options.directusEmail,
      password: options.directusPassword
    });

    const articles = await directus.request<any>("GET", "/items/articles?limit=-1&fields=old_slug,slug,is_test_data");
    for (const row of articles?.data || []) {
      if (row?.old_slug && row?.slug) {
        articleSlugByOldSlug.set(String(row.old_slug), String(row.slug));
      }
      if (row?.old_slug && row?.is_test_data === true) {
        testDataOldSlugs.add(String(row.old_slug));
      }
    }

    const categories = await directus.request<any>(
      "GET",
      "/items/categories?limit=-1&fields=old_slug,slug,target_route_override,name,is_test_data"
    );
    for (const row of categories?.data || []) {
      if (row?.old_slug && row?.slug) {
        categorySlugByOldSlug.set(String(row.old_slug), String(row.slug));
      }
      if (row?.old_slug && row?.target_route_override) {
        categoryOverrideByOldSlug.set(String(row.old_slug), String(row.target_route_override));
      }
      if (row?.old_slug && row?.is_test_data === true) {
        testDataOldSlugs.add(String(row.old_slug));
      }
    }
  } catch (error) {
    console.warn(`[generate-redirects] Directus override lookup skipped: ${String((error as Error)?.message || error)}`);
  }

  return {
    articleSlugByOldSlug,
    categorySlugByOldSlug,
    categoryOverrideByOldSlug,
    testDataOldSlugs
  };
}

function renderMap(entries: RedirectEntry[], variableName: string): string {
  const lines: string[] = [];
  lines.push("# Generated by platform/scripts/generate-redirects.ts");
  lines.push(`# Generated at ${buildTimestamp()}`);
  lines.push(`map $request_uri ${variableName} {`);
  lines.push("  default \"\";");
  lines.push("");

  for (const entry of entries) {
    lines.push(`  ${entry.old_url} ${entry.target_url};`);
  }

  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

async function atomicWriteWithBackup(filePath: string, content: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp`;
  const backupPath = `${filePath}.bak`;

  await fs.writeFile(tmpPath, content, "utf8");

  const current = await readIfExists(filePath);
  if (current !== null) {
    await fs.writeFile(backupPath, current, "utf8");
  }

  await fs.rename(tmpPath, filePath);

  return {
    restore: async () => {
      const backup = await readIfExists(backupPath);
      if (backup !== null) {
        await fs.writeFile(filePath, backup, "utf8");
      }
    },
    cleanup: async () => {
      try {
        await fs.unlink(backupPath);
      } catch {
        // ignore
      }
    }
  };
}

function requireProductionConfirmation(environment: string, action: string): void {
  if (environment.trim().toLowerCase() !== "production") {
    return;
  }
  if (process.env.CONFIRM_PRODUCTION_ACTION === "true") {
    return;
  }
  throw new Error(
    `${action} blocked in production. Set CONFIRM_PRODUCTION_ACTION=true to continue explicitly.`
  );
}

async function main() {
  const options = parseCli();
  console.log(`[generate-redirects] input=${options.inputDir}`);

  const pages = await collectLegacyPages(options);
  const specialRoutes = await loadSpecialRoutes(options.specialRoutesPath);
  const slugHints = await loadSlugHints(options.migrationReportPath);
  const directusHints = await loadDirectusOverrides(options);
  const highRiskCols = await collectHighRiskColumns(options.layoutMapPath);

  const entries: RedirectEntry[] = [];
  const internalEntries: RedirectEntry[] = [];
  const conflicts: Array<{ file: string; config_route: string; directus_route: string }> = [];
  const highRiskMissingOverride: string[] = [];
  const overrideAudit: Array<{
    old_url: string;
    source: "special_config" | "directus" | "title_infer" | "default";
    is_test_data: boolean;
    included_in_public: boolean;
  }> = [];

  for (const [fileName, pageType] of [...pages.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const oldSlug = fileName.replace(/\.html$/i, "");
    const oldUrl = `/${fileName}`;
    const isTestData = directusHints.testDataOldSlugs.has(oldSlug);

    let entry: RedirectEntry | null = null;
    let source: "special_config" | "directus" | "title_infer" | "default" = "default";

    if (pageType === "nd") {
      const slug =
        directusHints.articleSlugByOldSlug.get(oldSlug) ||
        slugHints.slugByOldSlug.get(oldSlug) ||
        slugify(oldSlug, oldSlug);
      entry = {
        old_url: oldUrl,
        old_slug: oldSlug,
        page_type: pageType,
        target_url: `/news/${slug}`,
        strategy: "default"
      };
      source = "default";
    } else {
      const configOverride = specialRoutes.get(fileName);
      const directusOverride = directusHints.categoryOverrideByOldSlug.get(oldSlug);
      if (configOverride && directusOverride && configOverride !== directusOverride) {
        conflicts.push({
          file: fileName,
          config_route: configOverride,
          directus_route: directusOverride
        });
      }

      if (configOverride) {
        entry = {
          old_url: oldUrl,
          old_slug: oldSlug,
          page_type: pageType,
          target_url: configOverride,
          strategy: "override"
        };
        source = "special_config";
      } else if (directusOverride) {
        entry = {
          old_url: oldUrl,
          old_slug: oldSlug,
          page_type: pageType,
          target_url: directusOverride,
          strategy: "override"
        };
        source = "directus";
      } else {
        const hintedTitle = slugHints.categoryTitleByOldSlug.get(oldSlug) || "";
        const inferredOverride = inferOverrideByTitle(hintedTitle);
        if (inferredOverride) {
          entry = {
            old_url: oldUrl,
            old_slug: oldSlug,
            page_type: pageType,
            target_url: inferredOverride,
            strategy: "override"
          };
          source = "title_infer";
        } else {
          if (pageType === "col" && highRiskCols.has(fileName) && !isTestData) {
            highRiskMissingOverride.push(fileName);
          }

          const categorySlug =
            directusHints.categorySlugByOldSlug.get(oldSlug) ||
            slugHints.slugByOldSlug.get(oldSlug) ||
            slugify(oldSlug, oldSlug);

          entry = {
            old_url: oldUrl,
            old_slug: oldSlug,
            page_type: pageType,
            target_url: `/news/category/${categorySlug}`,
            strategy: "default"
          };
          source = "default";
        }
      }
    }

    if (!entry) {
      continue;
    }

    internalEntries.push(entry);
    const includeInPublic = options.includeTestData || !isTestData;
    if (includeInPublic) {
      entries.push(entry);
    }
    overrideAudit.push({
      old_url: oldUrl,
      source,
      is_test_data: isTestData,
      included_in_public: includeInPublic
    });
  }

  const duplicates = new Set<string>();
  const seen = new Set<string>();
  for (const entry of internalEntries) {
    if (seen.has(entry.old_url)) {
      duplicates.add(entry.old_url);
    }
    seen.add(entry.old_url);
  }

  if (duplicates.size > 0) {
    throw new Error(`Duplicate redirect keys detected: ${[...duplicates].join(", ")}`);
  }

  if (entries.length !== options.expectedTotal) {
    throw new Error(`Coverage check failed: expected ${options.expectedTotal}, got ${entries.length}`);
  }
  if (options.expectedTotalInternal > 0 && internalEntries.length !== options.expectedTotalInternal) {
    throw new Error(
      `Internal coverage check failed: expected ${options.expectedTotalInternal}, got ${internalEntries.length}`
    );
  }

  if (conflicts.length > 0) {
    const msg = `[generate-redirects] conflicts found between special config and Directus override: ${conflicts.length}`;
    if (options.strictSpecialCheck) {
      throw new Error(msg);
    }
    console.warn(msg);
  }

  if (highRiskMissingOverride.length > 0) {
    const msg = `[generate-redirects] high-risk columns without explicit override: ${highRiskMissingOverride.join(", ")}`;
    if (options.strictSpecialCheck) {
      throw new Error(msg);
    }
    console.warn(msg);
  }

  const mapText = renderMap(entries, "$legacy_redirect_target");
  const internalMapText = renderMap(internalEntries, "$legacy_redirect_target_internal");
  const mapWrite = await atomicWriteWithBackup(options.outputMapPath, mapText);
  const internalMapWrite = await atomicWriteWithBackup(options.outputMapInternalPath, internalMapText);
  const compatWrite = await atomicWriteWithBackup(options.compatMapPath, mapText);

  try {
    if (options.applyNginx) {
      requireProductionConfirmation(options.environment, "Nginx reload");
      console.log(`[generate-redirects] nginx test: ${options.nginxTestCmd}`);
      await exec(options.nginxTestCmd);

      console.log(`[generate-redirects] nginx reload: ${options.nginxReloadCmd}`);
      await exec(options.nginxReloadCmd);
    }
  } catch (error) {
    await mapWrite.restore();
    await internalMapWrite.restore();
    await compatWrite.restore();
    throw error;
  }

  await mapWrite.cleanup();
  await internalMapWrite.cleanup();
  await compatWrite.cleanup();

  await writeJsonAtomic(options.conflictReportPath, {
    generated_at: buildTimestamp(),
    strict_special_check: options.strictSpecialCheck,
    conflicts,
    high_risk_missing_override: highRiskMissingOverride
  });

  await writeJsonAtomic(options.outputJsonPath, {
    generated_at: buildTimestamp(),
    include_test_data: options.includeTestData,
    expected_total: options.expectedTotal,
    actual_total: entries.length,
    expected_total_internal: options.expectedTotalInternal,
    actual_total_internal: internalEntries.length,
    special_routes_path: options.specialRoutesPath,
    output_map_internal_path: options.outputMapInternalPath,
    test_data_old_slugs_excluded_from_public: options.includeTestData ? [] : [...directusHints.testDataOldSlugs].sort(),
    override_audit: overrideAudit,
    entries,
    internal_entries: internalEntries
  });

  console.log(`[generate-redirects] entries=${entries.length}`);
  console.log(`[generate-redirects] internal_entries=${internalEntries.length}`);
  console.log(`[generate-redirects] map=${options.outputMapPath}`);
  console.log(`[generate-redirects] internal_map=${options.outputMapInternalPath}`);
  console.log(`[generate-redirects] compat_map=${options.compatMapPath}`);
  console.log(`[generate-redirects] json=${options.outputJsonPath}`);
  console.log(`[generate-redirects] conflict_report=${options.conflictReportPath}`);
}

main().catch((error) => {
  console.error("[generate-redirects] fatal:", error);
  process.exit(1);
});
