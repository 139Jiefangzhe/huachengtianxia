#!/usr/bin/env tsx
import { exec as execCb } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildTimestamp,
  detectLegacyPageType,
  ensureParentDir,
  getBooleanArg,
  getNumberArg,
  getStringArg,
  parseArgs,
  readTable,
  resolveRepoPath,
  writeJsonAtomic,
  writeTextAtomic
} from "./lib/common.js";
import { DirectusClient } from "./lib/directus.js";

const exec = promisify(execCb);

type StepStatus = "PASS" | "WARN" | "FAIL";

type StepResult = {
  id: string;
  name: string;
  status: StepStatus;
  checks: Array<{ name: string; status: StepStatus; detail: string }>;
  evidence: Record<string, unknown>;
  warnings: string[];
  errors: string[];
  started_at: string;
  finished_at: string;
};

type AcceptanceOptions = {
  manifestPath: string;
  layoutMapPath: string;
  layoutArchitecturePath: string;
  inputDir: string;
  directusUrl: string;
  directusEmail: string;
  directusPassword: string;
  directusToken: string;
  baseUrl: string;
  reportJsonPath: string;
  reportMdPath: string;
  strictEnum: boolean;
  expectedNd: number;
  expectedCol: number;
  expectedNr: number;
  expectedIndex: number;
};

type RedirectMapEntry = {
  old_url: string;
  target_url: string;
};

const DEFAULTS: AcceptanceOptions = {
  manifestPath: "reports/frontend_extract/frontend_file_manifest.csv",
  layoutMapPath: "reports/frontend_extract/layout_signature_mapping.csv",
  layoutArchitecturePath: "reports/frontend_extract/layout_architecture.md",
  inputDir: "mirror/hctxf_full/hctxf.org",
  directusUrl: "http://localhost:28055",
  directusEmail: "admin@example.com",
  directusPassword: "ChangeMe_123456",
  directusToken: "",
  baseUrl: "http://localhost:28080",
  reportJsonPath: "reports/acceptance/stage2_acceptance_report.json",
  reportMdPath: "reports/acceptance/stage2_acceptance_report.md",
  strictEnum: true,
  expectedNd: 604,
  expectedCol: 39,
  expectedNr: 21,
  expectedIndex: 1
};

function parseCli(): AcceptanceOptions {
  const args = parseArgs(process.argv);
  return {
    ...DEFAULTS,
    manifestPath: resolveRepoPath(getStringArg(args, "manifest", DEFAULTS.manifestPath)),
    layoutMapPath: resolveRepoPath(getStringArg(args, "layout-map", DEFAULTS.layoutMapPath)),
    layoutArchitecturePath: resolveRepoPath(getStringArg(args, "layout-arch", DEFAULTS.layoutArchitecturePath)),
    inputDir: resolveRepoPath(getStringArg(args, "input", DEFAULTS.inputDir)),
    directusUrl: getStringArg(args, "directus-url", DEFAULTS.directusUrl),
    directusEmail: getStringArg(args, "directus-email", DEFAULTS.directusEmail),
    directusPassword: getStringArg(args, "directus-password", DEFAULTS.directusPassword),
    directusToken: getStringArg(args, "directus-token", DEFAULTS.directusToken),
    baseUrl: getStringArg(args, "base-url", DEFAULTS.baseUrl),
    reportJsonPath: resolveRepoPath(getStringArg(args, "report-json", DEFAULTS.reportJsonPath)),
    reportMdPath: resolveRepoPath(getStringArg(args, "report-md", DEFAULTS.reportMdPath)),
    strictEnum: getBooleanArg(args, "strict-enum", DEFAULTS.strictEnum),
    expectedNd: getNumberArg(args, "expected-nd", DEFAULTS.expectedNd),
    expectedCol: getNumberArg(args, "expected-col", DEFAULTS.expectedCol),
    expectedNr: getNumberArg(args, "expected-nr", DEFAULTS.expectedNr),
    expectedIndex: getNumberArg(args, "expected-index", DEFAULTS.expectedIndex)
  };
}

async function resolveInputPath(primaryPath: string): Promise<{ path: string; fallbackUsed: boolean; note?: string }> {
  try {
    await fs.access(primaryPath);
    return { path: primaryPath, fallbackUsed: false };
  } catch {
    if (primaryPath.endsWith(".csv")) {
      const tsv = primaryPath.replace(/\.csv$/i, ".tsv");
      await fs.access(tsv);
      return {
        path: tsv,
        fallbackUsed: true,
        note: `Input file ${path.basename(primaryPath)} missing; fallback to ${path.basename(tsv)}`
      };
    }
    throw new Error(`Input file not found: ${primaryPath}`);
  }
}

function buildStep(id: string, name: string): StepResult {
  const now = buildTimestamp();
  return {
    id,
    name,
    status: "PASS",
    checks: [],
    evidence: {},
    warnings: [],
    errors: [],
    started_at: now,
    finished_at: now
  };
}

function registerCheck(step: StepResult, name: string, status: StepStatus, detail: string) {
  step.checks.push({ name, status, detail });
  if (status === "FAIL") {
    step.status = "FAIL";
    step.errors.push(`${name}: ${detail}`);
    return;
  }

  if (status === "WARN" && step.status !== "FAIL") {
    step.status = "WARN";
    step.warnings.push(`${name}: ${detail}`);
  }
}

function finishStep(step: StepResult) {
  step.finished_at = buildTimestamp();
  return step;
}

async function runCommand(command: string, options: { cwd?: string } = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await exec(command, {
      cwd: options.cwd || resolveRepoPath("."),
      maxBuffer: 50 * 1024 * 1024
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || err.message || "",
      code: Number(err.code ?? 1)
    };
  }
}

function parseRedirectMap(content: string): RedirectMapEntry[] {
  const entries: RedirectMapEntry[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("map ") || line.startsWith("default") || line === "}") {
      continue;
    }

    const m = line.match(/^(\/[^\s]+)\s+([^;]+);$/);
    if (!m) {
      continue;
    }

    entries.push({ old_url: m[1], target_url: m[2] });
  }
  return entries;
}

function normalizeLocationToPath(location: string): string {
  if (!location) {
    return "";
  }

  if (location.startsWith("/")) {
    return location;
  }

  try {
    const u = new URL(location);
    return `${u.pathname}${u.search}`;
  } catch {
    return location;
  }
}

function extractCoreOldUrlsFromLayoutRows(rows: Record<string, string>[]) {
  const urls = new Set<string>();
  for (const row of rows) {
    const filesColumn = row.files || "";
    for (const item of filesColumn.split(",").map((v) => v.trim()).filter(Boolean)) {
      const fileName = path.basename(item).toLowerCase();
      const t = detectLegacyPageType(fileName);
      if (t === "nd" || t === "col" || t === "nr") {
        urls.add(`/${fileName}`);
      }
    }
  }
  return urls;
}

function summarizeStatuses(steps: StepResult[]) {
  const byStatus = {
    PASS: steps.filter((s) => s.status === "PASS").length,
    WARN: steps.filter((s) => s.status === "WARN").length,
    FAIL: steps.filter((s) => s.status === "FAIL").length
  };

  const finalStatus = byStatus.FAIL > 0 ? "FAIL" : byStatus.WARN > 0 ? "PASS_WITH_WARNINGS" : "PASS";
  return { byStatus, finalStatus };
}

function renderMarkdownReport(report: any): string {
  const lines: string[] = [];
  lines.push("# HCTXF Stage-2 自动化验收报告");
  lines.push("");
  lines.push(`- 生成时间: ${report.generated_at}`);
  lines.push(`- 总体结论: **${report.summary.final_status}**`);
  lines.push(`- 步骤统计: PASS=${report.summary.by_status.PASS}, WARN=${report.summary.by_status.WARN}, FAIL=${report.summary.by_status.FAIL}`);
  lines.push("");
  lines.push("## 输入信息");
  lines.push("");
  lines.push(`- manifest: \`${report.inputs.manifest_path}\``);
  lines.push(`- layout map: \`${report.inputs.layout_map_path}\``);
  lines.push(`- layout architecture: \`${report.inputs.layout_architecture_path}\``);
  lines.push(`- Directus: \`${report.environment.directus_url}\``);
  lines.push(`- Nginx base URL: \`${report.environment.base_url}\``);
  lines.push("");

  for (const step of report.steps) {
    lines.push(`## ${step.id}. ${step.name} (${step.status})`);
    lines.push("");

    if (step.checks.length > 0) {
      lines.push("| Check | Status | Detail |");
      lines.push("|---|---|---|");
      for (const check of step.checks) {
        lines.push(`| ${check.name} | ${check.status} | ${String(check.detail).replace(/\|/g, "\\|")} |`);
      }
      lines.push("");
    }

    if (step.warnings.length > 0) {
      lines.push("Warnings:");
      for (const warning of step.warnings) {
        lines.push(`- ${warning}`);
      }
      lines.push("");
    }

    if (step.errors.length > 0) {
      lines.push("Errors:");
      for (const err of step.errors) {
        lines.push(`- ${err}`);
      }
      lines.push("");
    }

    lines.push("Evidence:");
    lines.push("```json");
    lines.push(JSON.stringify(step.evidence, null, 2));
    lines.push("```");
    lines.push("");
  }

  lines.push("## 产物");
  lines.push("");
  for (const [k, v] of Object.entries(report.artifacts)) {
    lines.push(`- ${k}: \`${String(v)}\``);
  }
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const startedAt = buildTimestamp();
  const options = parseCli();

  const manifestResolved = await resolveInputPath(options.manifestPath);
  const layoutMapResolved = await resolveInputPath(options.layoutMapPath);

  await ensureParentDir(options.reportJsonPath);
  await ensureParentDir(options.reportMdPath);

  const steps: StepResult[] = [];
  const artifacts: Record<string, string> = {};

  const tempRoot = "/tmp/hctxf_acceptance";
  await fs.mkdir(tempRoot, { recursive: true });
  const dryRunReport = path.join(tempRoot, "dry-run-report.json");
  const dryRunState = path.join(tempRoot, "migration_state.json");
  const dryRunFingerprint = path.join(tempRoot, "fingerprint_map.json");
  const dryRunDedupCache = path.join(tempRoot, "image-dedup-cache.json");
  const dryRunMissingAssets = path.join(tempRoot, "missing_assets.csv");
  const dryRunQuoteReport = path.join(tempRoot, "quote-confidence-report.json");
  const redirectMapTemp = path.join(tempRoot, "legacy.map");
  const redirectCompatTemp = path.join(tempRoot, "redirects.map");
  const redirectJsonTemp = path.join(tempRoot, "legacy_urls.json");
  const redirectConflictTemp = path.join(tempRoot, "redirect_conflicts.json");

  artifacts.dry_run_report = dryRunReport;
  artifacts.dry_run_quote_report = dryRunQuoteReport;
  artifacts.dry_run_missing_assets = dryRunMissingAssets;
  artifacts.redirect_map_temp = redirectMapTemp;
  artifacts.redirect_json_temp = redirectJsonTemp;
  artifacts.redirect_conflict_temp = redirectConflictTemp;

  let directusClient: DirectusClient | null = null;
  const directusErrors: string[] = [];
  const directusCandidates = [
    { url: options.directusUrl, email: options.directusEmail, password: options.directusPassword },
    { url: "http://localhost:28055", email: "admin@example.com", password: "ChangeMe_123456" },
    { url: "http://localhost:8055", email: "admin@example.com", password: "ChangeMe_123456" }
  ];

  for (const candidate of directusCandidates) {
    try {
      directusClient = await DirectusClient.create({
        baseUrl: candidate.url,
        token: options.directusToken || undefined,
        email: candidate.email,
        password: candidate.password
      });
      options.directusUrl = candidate.url;
      options.directusEmail = candidate.email;
      options.directusPassword = candidate.password;
      break;
    } catch (error) {
      directusErrors.push(`${candidate.url} (${candidate.email}): ${String((error as Error).message || error)}`);
    }
  }

  // Step 1
  {
    const step = buildStep("1", "Source Data Integrity");

    const manifestRows = await readTable(manifestResolved.path);
    const pfCounts: Record<string, number> = {};
    for (const row of manifestRows) {
      const pf = (row.page_family || "").trim();
      pfCounts[pf] = (pfCounts[pf] || 0) + 1;
    }

    const actual = {
      nd: pfCounts.nd || 0,
      col: pfCounts.col || 0,
      nr: pfCounts.nr || 0,
      index: pfCounts.index || 0
    };

    const expected = {
      nd: options.expectedNd,
      col: options.expectedCol,
      nr: options.expectedNr,
      index: options.expectedIndex
    };

    const coreTotalActual = actual.nd + actual.col + actual.nr + actual.index;
    const coreTotalExpected = expected.nd + expected.col + expected.nr + expected.index;

    const missingTypes: string[] = [];
    for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
      if (actual[key] !== expected[key]) {
        missingTypes.push(`${key}: expected=${expected[key]}, actual=${actual[key]}`);
      }
    }

    registerCheck(
      step,
      "core_page_counts",
      missingTypes.length === 0 ? "PASS" : "FAIL",
      missingTypes.length === 0 ? `nd/col/nr/index match expected (${coreTotalExpected})` : missingTypes.join("; ")
    );

    registerCheck(
      step,
      "core_total_665",
      coreTotalActual === coreTotalExpected ? "PASS" : "FAIL",
      `actual=${coreTotalActual}, expected=${coreTotalExpected}`
    );

    if (manifestResolved.fallbackUsed && manifestResolved.note) {
      registerCheck(step, "manifest_fallback", "WARN", manifestResolved.note);
    }

    step.evidence = {
      manifest_path: manifestResolved.path,
      page_family_counts: pfCounts,
      expected,
      actual,
      core_total_actual: coreTotalActual,
      core_total_expected: coreTotalExpected
    };

    steps.push(finishStep(step));
  }

  // Step 2
  {
    const step = buildStep("2", "Directus Schema Audit");
    if (!directusClient) {
      registerCheck(step, "directus_connection", "FAIL", `Unable to connect/login. ${directusErrors.join(" | ")}`);
      step.evidence = {
        directus_candidates: directusCandidates,
        errors: directusErrors
      };
      steps.push(finishStep(step));
    } else {
      const collectionsResp = await directusClient.request<any>("GET", "/collections?limit=-1&fields=collection");
      const fieldsResp = await directusClient.request<any>("GET", "/fields?limit=-1&fields=collection,field,meta,schema");

      const collections = (collectionsResp?.data || []).map((item: any) => item.collection);
      const fields = fieldsResp?.data || [];
      const fieldExists = (collection: string, field: string) =>
        fields.some((item: any) => item.collection === collection && item.field === field);
      const getField = (collection: string, field: string) =>
        fields.find((item: any) => item.collection === collection && item.field === field);

      const requiredCommon = [
        "old_slug",
        "legacy_url",
        "raw_html_backup",
        "content_clean",
        "migration_status",
        "migration_errors",
        "seo_title",
        "seo_description",
        "seo_keywords"
      ];

      const requiredByCollection: Record<string, string[]> = {
        articles: requiredCommon,
        projects: requiredCommon,
        categories: ["target_route_override", "layout_config"],
        quotes: ["content", "author", "confidence", "quote_key"]
      };

      const missingFields: string[] = [];
      for (const [collectionName, requiredFields] of Object.entries(requiredByCollection)) {
        for (const field of requiredFields) {
          if (!fieldExists(collectionName, field)) {
            missingFields.push(`${collectionName}.${field}`);
          }
        }
      }

      const requiredCollections = ["quotes", "migration_audit", "redirect_audit"];
      const missingCollections = requiredCollections.filter((name) => !collections.includes(name));

      registerCheck(
        step,
        "required_collections",
        missingCollections.length === 0 ? "PASS" : "FAIL",
        missingCollections.length === 0 ? "All required collections exist" : `Missing: ${missingCollections.join(", ")}`
      );

      registerCheck(
        step,
        "required_fields",
        missingFields.length === 0 ? "PASS" : "FAIL",
        missingFields.length === 0 ? "All required fields exist" : `Missing: ${missingFields.join(", ")}`
      );

      const uniqueOldSlugMap = {
        articles: Boolean(getField("articles", "old_slug")?.schema?.is_unique),
        projects: Boolean(getField("projects", "old_slug")?.schema?.is_unique),
        categories: Boolean(getField("categories", "old_slug")?.schema?.is_unique),
        reports: Boolean(getField("reports", "old_slug")?.schema?.is_unique)
      };

      const uniqueFailures = Object.entries(uniqueOldSlugMap)
        .filter(([, isUnique]) => !isUnique)
        .map(([collectionName]) => `${collectionName}.old_slug`);

      registerCheck(
        step,
        "old_slug_unique_index",
        uniqueFailures.length === 0 ? "PASS" : "FAIL",
        uniqueFailures.length === 0 ? "All old_slug fields are unique" : `Missing unique index: ${uniqueFailures.join(", ")}`
      );

      const migrationStatusField = getField("articles", "migration_status");
      const enumTokens = ["draft_raw", "cleaned", "needs_review", "approved", "published"];
      const enumSource = JSON.stringify({
        options: migrationStatusField?.meta?.options ?? null,
        validation: migrationStatusField?.meta?.validation ?? null
      });
      const explicitEnumSatisfied = enumTokens.every((token) => enumSource.includes(token));

      registerCheck(
        step,
        "migration_status_enum",
        explicitEnumSatisfied ? "PASS" : options.strictEnum ? "FAIL" : "WARN",
        explicitEnumSatisfied
          ? "Enum tokens detected in field metadata"
          : "Explicit enum constraints not detected (tokens missing in options/validation metadata)"
      );

      step.evidence = {
        directus_url: options.directusUrl,
        collections_count: collections.length,
        missing_collections: missingCollections,
        missing_fields: missingFields,
        unique_old_slug: uniqueOldSlugMap,
        migration_status_meta: {
          options: migrationStatusField?.meta?.options ?? null,
          validation: migrationStatusField?.meta?.validation ?? null,
          note: migrationStatusField?.meta?.note ?? null
        }
      };

      steps.push(finishStep(step));
    }
  }

  // Step 3
  {
    const step = buildStep("3", "Dry-Run Simulation");

    const dryRunCmd = [
      "npm --prefix platform run migrate --",
      "--mode dry-run",
      `--input ${JSON.stringify(options.inputDir)}`,
      `--manifest ${JSON.stringify(manifestResolved.path)}`,
      `--layout-map ${JSON.stringify(layoutMapResolved.path)}`,
      `--report ${JSON.stringify(dryRunReport)}`,
      `--state ${JSON.stringify(dryRunState)}`,
      `--fingerprint-map ${JSON.stringify(dryRunFingerprint)}`,
      `--dedup-cache ${JSON.stringify(dryRunDedupCache)}`,
      `--missing-assets ${JSON.stringify(dryRunMissingAssets)}`,
      `--quote-report ${JSON.stringify(dryRunQuoteReport)}`,
      `--asset-policy ${JSON.stringify(resolveRepoPath("platform/config/allowed-domains.json"))}`,
      "--strict-missing-assets true",
      "--expected-error-rate 0.05",
      "--retry 1",
      "--reset-state"
    ].join(" ");

    const dryRunExec = await runCommand(dryRunCmd);

    if (dryRunExec.code !== 0) {
      registerCheck(step, "dry_run_execution", "FAIL", `Dry-run command failed (code=${dryRunExec.code})`);
      step.errors.push(dryRunExec.stderr || dryRunExec.stdout || "Unknown dry-run error");
      step.evidence = {
        command: dryRunCmd,
        exit_code: dryRunExec.code,
        stdout_tail: dryRunExec.stdout.slice(-4000),
        stderr_tail: dryRunExec.stderr.slice(-4000)
      };
      steps.push(finishStep(step));
    } else {
      let dryRunJson: any = null;
      try {
        dryRunJson = JSON.parse(await fs.readFile(dryRunReport, "utf8"));
      } catch (error) {
        registerCheck(step, "dry_run_report_parse", "FAIL", `Unable to parse dry-run-report.json: ${String(error)}`);
      }

      const totalProcessed = Number(dryRunJson?.totals?.total ?? 0);
      const failedCount = Number(dryRunJson?.totals?.failed ?? 0);
      const errorRate = Number(dryRunJson?.error_rate ?? (totalProcessed > 0 ? failedCount / totalProcessed : 1));
      const quoteStats = dryRunJson?.quote_stats || { high: 0, medium: 0, low: 0 };
      const quotesExtracted = Number(quoteStats.high || 0) + Number(quoteStats.medium || 0) + Number(quoteStats.low || 0);

      let missingAssetsTotal = 0;
      try {
        const csvRaw = await fs.readFile(dryRunMissingAssets, "utf8");
        const rows = csvRaw.split(/\r?\n/).filter((line) => line.trim().length > 0);
        missingAssetsTotal = Math.max(0, rows.length - 1);
      } catch {
        missingAssetsTotal = 0;
      }

      const contentExpected = options.expectedNd + options.expectedCol + options.expectedNr;
      const expectedScanned = contentExpected + options.expectedIndex;
      const homepageStatus = String(dryRunJson?.summary?.homepage_status || "");
      const totalFilesScanned = Number(dryRunJson?.summary?.total_files_scanned ?? 0);
      const criticalMissingAssets = Number(dryRunJson?.missing_assets_count ?? 0);

      registerCheck(
        step,
        "total_processed",
        totalProcessed === contentExpected ? "PASS" : "FAIL",
        `processed=${totalProcessed}, expected=${contentExpected}`
      );

      registerCheck(
        step,
        "error_rate_gate",
        errorRate <= 0.05 ? "PASS" : "FAIL",
        `error_rate=${(errorRate * 100).toFixed(2)}%, threshold=5%`
      );

      registerCheck(
        step,
        "quotes_extracted",
        quotesExtracted > 0 ? "PASS" : "WARN",
        `quotes_extracted=${quotesExtracted}`
      );

      registerCheck(
        step,
        "homepage_excluded_by_design",
        homepageStatus === "excluded_by_design" && totalFilesScanned === expectedScanned ? "PASS" : "FAIL",
        `homepage_status=${homepageStatus || "n/a"}, total_files_scanned=${totalFilesScanned}, expected_scanned=${expectedScanned}`
      );

      registerCheck(
        step,
        "critical_missing_assets_gate",
        criticalMissingAssets === 0 ? "PASS" : "FAIL",
        `critical_missing_assets=${criticalMissingAssets}, threshold=0`
      );

      step.evidence = {
        command: dryRunCmd,
        exit_code: dryRunExec.code,
        total_processed: totalProcessed,
        failed_count: failedCount,
        error_rate: errorRate,
        quotes_extracted: quotesExtracted,
        quote_stats: quoteStats,
        missing_assets_total: missingAssetsTotal,
        missing_assets_critical: criticalMissingAssets,
        homepage_status: homepageStatus,
        total_files_scanned: totalFilesScanned,
        dry_run_report_path: dryRunReport,
        quote_report_path: dryRunQuoteReport,
        dedup_cache_path: dryRunDedupCache,
        missing_assets_path: dryRunMissingAssets
      };

      steps.push(finishStep(step));
    }
  }

  // Step 4
  {
    const step = buildStep("4", "SEO Redirect Coverage");

    const layoutRows = await readTable(layoutMapResolved.path);
    const oldUrlsSet = extractCoreOldUrlsFromLayoutRows(layoutRows);

    const redirectExpectedForGeneration = Math.max(1, oldUrlsSet.size);
    const requiredMappings = options.expectedNd + options.expectedCol + options.expectedNr;
    const genCmd = [
      "npm --prefix platform run generate-redirects --",
      `--input ${JSON.stringify(options.inputDir)}`,
      `--manifest ${JSON.stringify(manifestResolved.path)}`,
      `--layout-map ${JSON.stringify(layoutMapResolved.path)}`,
      `--migration-report ${JSON.stringify(dryRunReport)}`,
      `--special-routes ${JSON.stringify(resolveRepoPath("config/special-routes.json"))}`,
      `--conflict-report ${JSON.stringify(redirectConflictTemp)}`,
      "--strict-special-check true",
      `--output-map ${JSON.stringify(redirectMapTemp)}`,
      `--compat-map ${JSON.stringify(redirectCompatTemp)}`,
      `--output-json ${JSON.stringify(redirectJsonTemp)}`,
      `--expected-total ${redirectExpectedForGeneration}`,
      `--directus-url ${JSON.stringify(options.directusUrl)}`,
      `--directus-email ${JSON.stringify(options.directusEmail)}`,
      `--directus-password ${JSON.stringify(options.directusPassword)}`
    ].join(" ");

    const genExec = await runCommand(genCmd);

    if (genExec.code !== 0) {
      registerCheck(step, "generate_redirects", "FAIL", `generate-redirects command failed (code=${genExec.code})`);
      step.errors.push(genExec.stderr || genExec.stdout || "Unknown generate-redirects error");
      step.evidence = {
        command: genCmd,
        exit_code: genExec.code,
        stdout_tail: genExec.stdout.slice(-4000),
        stderr_tail: genExec.stderr.slice(-4000)
      };
      steps.push(finishStep(step));
    } else {
      const mapRaw = await fs.readFile(redirectMapTemp, "utf8");
      const entries = parseRedirectMap(mapRaw);
      const mappedSet = new Set(entries.map((entry) => entry.old_url));
      const unmappedUrls = [...oldUrlsSet].filter((url) => !mappedSet.has(url)).sort();

      const invalidRules: string[] = [];
      for (const entry of entries) {
        const type = detectLegacyPageType(path.basename(entry.old_url));
        if (type === "nd" && !/^\/news\/.+/.test(entry.target_url)) {
          invalidRules.push(`${entry.old_url} -> ${entry.target_url}`);
        }
        if ((type === "col" || type === "nr") && !(/^\/news\/category\/.+/.test(entry.target_url) || /^\/(transparency|about|about\/team|contact|news)(\?|$|\/)/.test(entry.target_url))) {
          invalidRules.push(`${entry.old_url} -> ${entry.target_url}`);
        }
      }

      const coverage = oldUrlsSet.size > 0 ? (oldUrlsSet.size - unmappedUrls.length) / oldUrlsSet.size : 0;
      let redirectConflicts: any = null;
      try {
        redirectConflicts = JSON.parse(await fs.readFile(redirectConflictTemp, "utf8"));
      } catch {
        redirectConflicts = null;
      }
      const conflictCount = Array.isArray(redirectConflicts?.conflicts) ? redirectConflicts.conflicts.length : 0;
      const highRiskMissing = Array.isArray(redirectConflicts?.high_risk_missing_override)
        ? redirectConflicts.high_risk_missing_override.length
        : 0;

      registerCheck(
        step,
        "mapping_count_gte_664",
        entries.length >= requiredMappings ? "PASS" : "FAIL",
        `generated=${entries.length}, required>=${requiredMappings}`
      );

      registerCheck(
        step,
        "mapping_coverage_100pct",
        coverage === 1 ? "PASS" : "FAIL",
        `coverage=${(coverage * 100).toFixed(2)}%, mapped=${oldUrlsSet.size - unmappedUrls.length}/${oldUrlsSet.size}`
      );

      registerCheck(
        step,
        "route_pattern_rules",
        invalidRules.length === 0 ? "PASS" : "FAIL",
        invalidRules.length === 0 ? "All mapping rules match expected patterns" : `${invalidRules.length} invalid rules`
      );

      registerCheck(
        step,
        "special_route_conflict_free",
        conflictCount === 0 && highRiskMissing === 0 ? "PASS" : "FAIL",
        `conflicts=${conflictCount}, high_risk_missing_override=${highRiskMissing}`
      );

      step.evidence = {
        command: genCmd,
        exit_code: genExec.code,
        old_urls_from_layout: oldUrlsSet.size,
        generated_entries: entries.length,
        coverage,
        unmapped_urls: unmappedUrls.slice(0, 100),
        unmapped_count: unmappedUrls.length,
        invalid_rule_count: invalidRules.length,
        invalid_rule_samples: invalidRules.slice(0, 50),
        special_route_conflicts: conflictCount,
        high_risk_missing_override: highRiskMissing,
        redirect_conflict_temp: redirectConflictTemp,
        redirect_map_temp: redirectMapTemp,
        redirect_json_temp: redirectJsonTemp
      };

      steps.push(finishStep(step));
    }
  }

  // Step 5
  {
    const step = buildStep("5", "Nginx Config Check");

    const legacyMapPath = resolveRepoPath("platform/nginx/conf.d/redirects/legacy.map");
    let mapExists = false;
    let mapSize = 0;

    try {
      const stat = await fs.stat(legacyMapPath);
      mapExists = stat.isFile();
      mapSize = stat.size;
    } catch {
      mapExists = false;
      mapSize = 0;
    }

    registerCheck(
      step,
      "legacy_map_exists_non_empty",
      mapExists && mapSize > 0 ? "PASS" : "FAIL",
      `exists=${mapExists}, size=${mapSize}`
    );

    const nginxTest = await runCommand("docker exec hctxf-nginx nginx -t");
    registerCheck(
      step,
      "nginx_syntax",
      nginxTest.code === 0 ? "PASS" : "FAIL",
      nginxTest.code === 0 ? "nginx -t passed" : `nginx -t failed (code=${nginxTest.code})`
    );

    const baseUrl = options.baseUrl.replace(/\/$/, "");

    let overrideForCol3b75: string | null = null;
    try {
      if (directusClient) {
        const cat = await directusClient.findByField("categories", "old_slug", "col3b75");
        overrideForCol3b75 = cat?.target_route_override ? String(cat.target_route_override) : null;
      }
    } catch {
      overrideForCol3b75 = null;
    }

    const sampleUrls = ["/nd004c.html", "/col0a4e.html", "/col3b75.html", "/nr.html", "/nr0b2e.html"];
    const sampleResults: Array<{
      url: string;
      status: number;
      location: string;
      pass: boolean;
      rule: string;
      error?: string;
    }> = [];

    for (const oldUrl of sampleUrls) {
      const rule = (() => {
        if (oldUrl === "/nd004c.html") return "location starts with /news/";
        if (oldUrl === "/col0a4e.html") return "location starts with /news/category/";
        if (oldUrl === "/col3b75.html") return `location equals ${overrideForCol3b75 || "/transparency"} or starts with /news/category/`;
        if (oldUrl.startsWith("/nr")) return "location starts with /news/category/";
        return "location starts with /news/";
      })();

      try {
        const response = await fetch(`${baseUrl}${oldUrl}`, { redirect: "manual" });
        const status = response.status;
        const locationPath = normalizeLocationToPath(response.headers.get("location") || "");

        let pass = false;
        if (oldUrl === "/nd004c.html") {
          pass = status === 301 && /^\/news\/.+/.test(locationPath);
        } else if (oldUrl === "/col0a4e.html") {
          pass = status === 301 && /^\/news\/category\/.+/.test(locationPath);
        } else if (oldUrl === "/col3b75.html") {
          pass =
            status === 301 &&
            (Boolean(overrideForCol3b75) ? locationPath === overrideForCol3b75 : locationPath === "/transparency" || /^\/news\/category\/.+/.test(locationPath));
        } else {
          pass = status === 301 && /^\/news\/category\/.+/.test(locationPath);
        }

        sampleResults.push({
          url: oldUrl,
          status,
          location: locationPath,
          pass,
          rule
        });
      } catch (error) {
        sampleResults.push({
          url: oldUrl,
          status: 0,
          location: "",
          pass: false,
          rule,
          error: String((error as Error).message || error)
        });
      }
    }

    const failedSamples = sampleResults.filter((result) => !result.pass);

    registerCheck(
      step,
      "sample_redirects",
      failedSamples.length === 0 ? "PASS" : "FAIL",
      failedSamples.length === 0 ? "All sample redirects passed" : `${failedSamples.length} sample redirects failed`
    );

    step.evidence = {
      legacy_map_path: legacyMapPath,
      legacy_map_size: mapSize,
      nginx_test: {
        code: nginxTest.code,
        stdout: nginxTest.stdout.trim(),
        stderr: nginxTest.stderr.trim()
      },
      base_url: baseUrl,
      col3b75_override: overrideForCol3b75,
      samples: sampleResults
    };

    steps.push(finishStep(step));
  }

  // Step 6
  {
    const step = buildStep("6", "Deliverables Check");
    const requiredFiles = [
      resolveRepoPath("config/special-routes.json"),
      resolveRepoPath("reports/missing_assets.csv"),
      resolveRepoPath("reports/quote-confidence-report.json"),
      resolveRepoPath("scripts/image-dedup-cache.json"),
      resolveRepoPath("reports/dry-run-full.json"),
      resolveRepoPath("platform/scripts/data/legacy_urls.json")
    ];

    const fileStatus: Record<string, { exists: boolean; size: number }> = {};
    for (const filePath of requiredFiles) {
      try {
        const st = await fs.stat(filePath);
        fileStatus[filePath] = { exists: st.isFile(), size: st.size };
      } catch {
        fileStatus[filePath] = { exists: false, size: 0 };
      }
    }

    const missing = Object.entries(fileStatus)
      .filter(([, meta]) => !meta.exists || meta.size <= 0)
      .map(([filePath]) => filePath);

    registerCheck(
      step,
      "required_deliverables",
      missing.length === 0 ? "PASS" : "FAIL",
      missing.length === 0 ? "All required deliverables exist and non-empty" : `Missing/empty: ${missing.join(", ")}`
    );

    let dryRunFullMissingAssets = -1;
    try {
      const dryRunFull = JSON.parse(await fs.readFile(resolveRepoPath("reports/dry-run-full.json"), "utf8"));
      dryRunFullMissingAssets = Number(dryRunFull?.missing_assets_count ?? -1);
    } catch {
      dryRunFullMissingAssets = -1;
    }

    registerCheck(
      step,
      "dry_run_full_missing_assets_zero",
      dryRunFullMissingAssets === 0 ? "PASS" : "FAIL",
      `reports/dry-run-full.json missing_assets_count=${dryRunFullMissingAssets}`
    );

    step.evidence = {
      required_files: fileStatus,
      dry_run_full_missing_assets_count: dryRunFullMissingAssets
    };

    steps.push(finishStep(step));
  }

  const summary = summarizeStatuses(steps);
  const finishedAt = buildTimestamp();

  const report = {
    generated_at: finishedAt,
    started_at: startedAt,
    finished_at: finishedAt,
    summary: {
      final_status: summary.finalStatus,
      by_status: summary.byStatus
    },
    environment: {
      directus_url: options.directusUrl,
      directus_email: options.directusEmail,
      base_url: options.baseUrl,
      strict_enum: options.strictEnum
    },
    inputs: {
      manifest_path: manifestResolved.path,
      manifest_fallback_used: manifestResolved.fallbackUsed,
      layout_map_path: layoutMapResolved.path,
      layout_map_fallback_used: layoutMapResolved.fallbackUsed,
      layout_architecture_path: options.layoutArchitecturePath,
      input_dir: options.inputDir
    },
    steps,
    artifacts
  };

  const markdown = renderMarkdownReport(report);

  await writeJsonAtomic(options.reportJsonPath, report);
  await writeTextAtomic(options.reportMdPath, markdown);

  console.log(`[acceptance-stage2] report json: ${options.reportJsonPath}`);
  console.log(`[acceptance-stage2] report md: ${options.reportMdPath}`);
  console.log(`[acceptance-stage2] final status: ${summary.finalStatus}`);

  if (summary.finalStatus === "FAIL") {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error("[acceptance-stage2] fatal:", error);
  process.exit(1);
});
