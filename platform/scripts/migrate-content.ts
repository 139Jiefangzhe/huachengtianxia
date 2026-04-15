#!/usr/bin/env tsx
import { promises as fs } from "node:fs";
import path from "node:path";
import axios from "axios";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import {
  buildTimestamp,
  csvEscape,
  detectLegacyPageType,
  ensureParentDir,
  ensureUniqueSlug,
  getBooleanArg,
  getNumberArg,
  getStringArg,
  listLegacyHtmlFiles,
  loadJsonFile,
  normalizeLegacyAssetUrl,
  parseArgs,
  readIfExists,
  resolveRepoPath,
  sha256,
  slugify,
  toMirrorPathFromUrl,
  writeJsonAtomic
} from "./lib/common.js";
import { DirectusClient } from "./lib/directus.js";

type MigrationMode = "dry-run" | "import";
type PageType = "nd" | "col" | "nr";
type QuoteConfidence = "high" | "medium" | "low";

type MigrationOptions = {
  mode: MigrationMode;
  inputDir: string;
  manifestPath: string;
  layoutMapPath: string;
  reportPath: string;
  statePath: string;
  fingerprintMapPath: string;
  dedupCachePath: string;
  missingAssetsPath: string;
  quoteReportPath: string;
  autoArchivedReportPath: string;
  canaryManifestPath: string;
  assetPolicyPath: string;
  directusUrl: string;
  directusToken: string;
  directusEmail: string;
  directusPassword: string;
  resume: boolean;
  resetState: boolean;
  strictMissingAssets: boolean;
  concurrency: number;
  retry: number;
  assetTimeoutMs: number;
  expectedErrorRate: number;
  batchSize: number;
  maxPages: number;
  staleTimeoutMinutes: number;
  maxAttempts: number;
  mirrorRoot: string;
};

type MigrationState = {
  run_id: string;
  updated_at: string;
  last_processed_slug: string;
  completed_slugs: string[];
  asset_hash_map: Record<string, string>;
  failed_items: Array<{ old_slug: string; error: string; at: string }>;
};

type SlugPlanEntry = {
  oldSlug: string;
  pageType: PageType;
  title: string;
  slug: string;
  legacyUrl: string;
  sourcePath: string;
};

type SlugConflict = {
  old_slug: string;
  page_type: PageType;
  title: string;
  original_slug: string;
  final_slug: string;
  reason: "reserved" | "collision";
};

type MissingAsset = {
  page_slug: string;
  asset_url: string;
  asset_type: "image" | "pdf" | "other";
  severity: "CRITICAL" | "LOW";
  domain: string;
  policy_reason: "critical_domain" | "ignore_domain" | "manual_ignore" | "non_critical_domain";
  error_type: string;
  http_status: number | "";
  retry_count: number;
  last_error_at: string;
};

type AssetPolicy = {
  critical_domains: string[];
  ignore_domains: string[];
  manual_ignore_list: string[];
};

type QuoteCandidate = {
  author: string;
  content: string;
  sourceText: string;
  confidence: QuoteConfidence;
};

type CanaryManifestShape = {
  synthetic?: {
    old_slug?: string;
  };
  test_old_slugs?: string[];
  test_records?: Array<{ old_slug?: string }>;
};

type ProcessResult = {
  old_slug: string;
  page_type: PageType;
  slug: string;
  title: string;
  status: "ok" | "needs_review" | "failed";
  migration_status: string;
  pipeline_status?: "imported" | "failed" | "archived";
  quarantine_reason?: string;
  page_metrics?: {
    critical_missing_assets: number;
    soft_warnings: number;
    missing_assets_total: number;
  };
  upsert_result?: {
    collection: string;
    mode: "create" | "update";
    item: any;
    existing: any | null;
  };
  errors: string[];
  warnings: string[];
  quote_stats: Record<QuoteConfidence, number>;
  asset_stats: {
    referenced: number;
    migrated: number;
    reused_by_hash: number;
    failed: number;
  };
};

type BatchWriteOperation = {
  collection: string;
  old_slug: string;
  mode: "create" | "update";
  item_id: string | number;
  previous: any | null;
};

const DEFAULTS: MigrationOptions = {
  mode: "dry-run",
  inputDir: "mirror/hctxf_full/hctxf.org",
  manifestPath: "reports/frontend_extract/frontend_file_manifest.tsv",
  layoutMapPath: "reports/frontend_extract/layout_signature_mapping.tsv",
  reportPath: "reports/migration/dry-run-report.json",
  statePath: "reports/migration/migration_state.json",
  fingerprintMapPath: "reports/migration/fingerprint_map.json",
  dedupCachePath: "scripts/image-dedup-cache.json",
  missingAssetsPath: "reports/migration/missing_assets.csv",
  quoteReportPath: "reports/quote-confidence-report.json",
  autoArchivedReportPath: "reports/migration/auto_archived_report.csv",
  canaryManifestPath: "reports/canary/canary_manifest.json",
  assetPolicyPath: "platform/config/allowed-domains.json",
  directusUrl: process.env.DIRECTUS_URL || process.env.DIRECTUS_PUBLIC_URL || "http://localhost:8055",
  directusToken: process.env.DIRECTUS_TOKEN || "",
  directusEmail: process.env.DIRECTUS_ADMIN_EMAIL || "admin@example.com",
  directusPassword: process.env.DIRECTUS_ADMIN_PASSWORD || "ChangeMe_123456",
  resume: false,
  resetState: false,
  strictMissingAssets: true,
  concurrency: 5,
  retry: 3,
  assetTimeoutMs: 15000,
  expectedErrorRate: 0.05,
  batchSize: 50,
  maxPages: 0,
  staleTimeoutMinutes: 30,
  maxAttempts: 3,
  mirrorRoot: "mirror/hctxf_full"
};

const DEFAULT_ASSET_POLICY: AssetPolicy = {
  critical_domains: ["13526051.s21i.faiusr.com", "hctxf.org", "download.s21i.co99.net"],
  ignore_domains: ["ps.faisys.com", "oem.508sys.com", "fe.508sys.com", "mmbiz.qpic.cn", "www.w3.org", "stats.ipinyou.com"],
  manual_ignore_list: []
};

const SPECIAL_ROUTE_RULES: Array<{ pattern: RegExp; route: string }> = [
  { pattern: /财务|审计|公示|报告/i, route: "/transparency" },
  { pattern: /团队|理事|成员|组织架构/i, route: "/about/team" },
  { pattern: /关于/i, route: "/about" },
  { pattern: /联系|客服/i, route: "/contact" }
];

const QUOTE_RULES = [
  {
    confidence: "high" as QuoteConfidence,
    regex: /(欧阳修|高尔基|莎士比亚)[^\n，。]{0,10}(说|曾言|曾说|写道|认为)[:：]\s*[“"「](.{6,220}?)[”"」]/g
  },
  {
    confidence: "medium" as QuoteConfidence,
    regex: /(欧阳修|高尔基|莎士比亚)[^\n]{0,60}[“"「](.{6,260}?)[”"」]/g
  }
];

const PLACEHOLDER_IMAGE_URL = "/static/missing-image.svg";
const HTML_CLEAN_FAILURE_RATE_BLOCK_THRESHOLD = 0.1;

function isDryFileId(value: string | undefined | null): boolean {
  if (!value) {
    return false;
  }
  return String(value).startsWith("dry-");
}

function purgeDryMappingsInPlace(map: Record<string, string>): number {
  let removed = 0;
  for (const [hash, fileId] of Object.entries(map)) {
    if (!isDryFileId(fileId)) {
      continue;
    }
    delete map[hash];
    removed += 1;
  }
  return removed;
}

function parseCli(): MigrationOptions {
  const args = parseArgs(process.argv);

  const modeFlag = getStringArg(args, "mode", args.import ? "import" : "dry-run");
  const mode = modeFlag === "import" ? "import" : "dry-run";

  const reportDefault = mode === "import" ? "reports/migration/import-report.json" : DEFAULTS.reportPath;

  return {
    ...DEFAULTS,
    mode,
    inputDir: resolveRepoPath(getStringArg(args, "input", DEFAULTS.inputDir)),
    manifestPath: resolveRepoPath(getStringArg(args, "manifest", DEFAULTS.manifestPath)),
    layoutMapPath: resolveRepoPath(getStringArg(args, "layout-map", DEFAULTS.layoutMapPath)),
    reportPath: resolveRepoPath(getStringArg(args, "report", reportDefault)),
    statePath: resolveRepoPath(getStringArg(args, "state", DEFAULTS.statePath)),
    fingerprintMapPath: resolveRepoPath(getStringArg(args, "fingerprint-map", DEFAULTS.fingerprintMapPath)),
    dedupCachePath: resolveRepoPath(getStringArg(args, "dedup-cache", DEFAULTS.dedupCachePath)),
    missingAssetsPath: resolveRepoPath(getStringArg(args, "missing-assets", DEFAULTS.missingAssetsPath)),
    quoteReportPath: resolveRepoPath(getStringArg(args, "quote-report", DEFAULTS.quoteReportPath)),
    autoArchivedReportPath: resolveRepoPath(getStringArg(args, "auto-archived-report", DEFAULTS.autoArchivedReportPath)),
    canaryManifestPath: resolveRepoPath(getStringArg(args, "canary-manifest", DEFAULTS.canaryManifestPath)),
    assetPolicyPath: resolveRepoPath(getStringArg(args, "asset-policy", DEFAULTS.assetPolicyPath)),
    directusUrl: getStringArg(args, "directus-url", DEFAULTS.directusUrl),
    directusToken: getStringArg(args, "directus-token", DEFAULTS.directusToken),
    directusEmail: getStringArg(args, "directus-email", DEFAULTS.directusEmail),
    directusPassword: getStringArg(args, "directus-password", DEFAULTS.directusPassword),
    resume: getBooleanArg(args, "resume", DEFAULTS.resume),
    resetState: getBooleanArg(args, "reset-state", DEFAULTS.resetState),
    strictMissingAssets: getBooleanArg(args, "strict-missing-assets", DEFAULTS.strictMissingAssets),
    concurrency: Math.max(1, getNumberArg(args, "concurrency", DEFAULTS.concurrency)),
    retry: Math.max(1, getNumberArg(args, "retry", DEFAULTS.retry)),
    assetTimeoutMs: Math.max(1000, getNumberArg(args, "asset-timeout-ms", DEFAULTS.assetTimeoutMs)),
    expectedErrorRate: Math.max(0, getNumberArg(args, "expected-error-rate", DEFAULTS.expectedErrorRate)),
    batchSize: Math.max(1, getNumberArg(args, "batch-size", DEFAULTS.batchSize)),
    maxPages: Math.max(0, getNumberArg(args, "max-pages", DEFAULTS.maxPages)),
    staleTimeoutMinutes: Math.max(1, getNumberArg(args, "stale-timeout-min", DEFAULTS.staleTimeoutMinutes)),
    maxAttempts: Math.max(1, getNumberArg(args, "max-attempts", DEFAULTS.maxAttempts)),
    mirrorRoot: resolveRepoPath(getStringArg(args, "mirror-root", DEFAULTS.mirrorRoot))
  };
}

function inferAssetType(url: string): "image" | "pdf" | "other" {
  const lower = url.toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?|$)/.test(lower)) {
    return "image";
  }
  if (/\.pdf(\?|$)/.test(lower)) {
    return "pdf";
  }
  return "other";
}

function guessMimeType(filePath: string, assetType: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    default:
      return assetType === "image" ? "application/octet-stream" : "application/octet-stream";
  }
}

function normalizeHost(input: string): string {
  return input.trim().toLowerCase();
}

async function loadAssetPolicy(filePath: string): Promise<AssetPolicy> {
  const raw = await readIfExists(filePath);
  if (!raw) {
    return DEFAULT_ASSET_POLICY;
  }

  try {
    const parsed = JSON.parse(raw);
    const critical = Array.isArray(parsed?.critical_domains) ? parsed.critical_domains.map((x: unknown) => normalizeHost(String(x))) : [];
    const ignore = Array.isArray(parsed?.ignore_domains) ? parsed.ignore_domains.map((x: unknown) => normalizeHost(String(x))) : [];
    const manual = Array.isArray(parsed?.manual_ignore_list) ? parsed.manual_ignore_list.map((x: unknown) => String(x).trim()) : [];
    return {
      critical_domains: critical.length > 0 ? critical : DEFAULT_ASSET_POLICY.critical_domains,
      ignore_domains: ignore,
      manual_ignore_list: manual
    };
  } catch (error) {
    console.warn(`[migrate-content] invalid asset policy JSON (${filePath}), fallback to defaults: ${String(error)}`);
    return DEFAULT_ASSET_POLICY;
  }
}

function classifyMissingAsset(assetUrl: string, policy: AssetPolicy): {
  severity: MissingAsset["severity"];
  domain: string;
  policy_reason: MissingAsset["policy_reason"];
} {
  const manualSet = new Set(policy.manual_ignore_list.map((x) => x.trim()));
  const critical = new Set(policy.critical_domains.map(normalizeHost));
  const ignore = new Set(policy.ignore_domains.map(normalizeHost));
  if (manualSet.has(assetUrl)) {
    return {
      severity: "LOW",
      domain: (() => {
        try {
          return new URL(assetUrl).hostname.toLowerCase();
        } catch {
          return "unknown";
        }
      })(),
      policy_reason: "manual_ignore"
    };
  }

  let domain = "unknown";
  try {
    domain = new URL(assetUrl).hostname.toLowerCase();
  } catch {
    domain = "unknown";
  }

  if (critical.has(domain)) {
    return { severity: "CRITICAL", domain, policy_reason: "critical_domain" };
  }
  if (ignore.has(domain)) {
    return { severity: "LOW", domain, policy_reason: "ignore_domain" };
  }
  return { severity: "LOW", domain, policy_reason: "non_critical_domain" };
}

function extractMeta(rawHtml: string, $: cheerio.CheerioAPI) {
  const title = ($("title").text() || "").trim();
  const description = ($("meta[name='description']").attr("content") || "").trim();
  const keywords = ($("meta[name='keywords']").attr("content") || "").trim();

  let publishDate = "";
  const dateMatch = rawHtml.match(/addMeta\(['\"]PubDate['\"],\s*['\"]([^'\"]+)['\"]\)/i);
  if (dateMatch?.[1]) {
    publishDate = dateMatch[1];
  }

  return {
    title,
    description,
    keywords,
    publishDate
  };
}

function stripDirtyClasses(className: string): string {
  return className
    .split(/\s+/)
    .filter(Boolean)
    .filter((cls) => !/^fai_/i.test(cls))
    .filter((cls) => !/^jz_/i.test(cls))
    .join(" ");
}

function sanitizeHtml(html: string): string {
  const $ = cheerio.load(`<div id=\"__root\">${html}</div>`);

  const root = $("#__root");

  root.find("script,style,noscript").remove();

  root.find("*").each((_, element) => {
    const attrs = element.attribs || {};
    for (const attrName of Object.keys(attrs)) {
      if (attrName.toLowerCase() === "style" || attrName.toLowerCase().startsWith("on")) {
        $(element).removeAttr(attrName);
      }
    }

    const className = $(element).attr("class");
    if (className) {
      const cleaned = stripDirtyClasses(className);
      if (cleaned) {
        $(element).attr("class", cleaned);
      } else {
        $(element).removeAttr("class");
      }
    }
  });

  root.find("table").each((_, tableEl) => {
    const parent = $(tableEl).parent();
    if (parent.hasClass("overflow-x-auto")) {
      return;
    }
    $(tableEl).wrap('<div class="overflow-x-auto"></div>');
  });

  return root.html() || "";
}

function inferPageType(filePath: string): PageType {
  const type = detectLegacyPageType(filePath);
  if (type === "nd" || type === "col" || type === "nr") {
    return type;
  }
  throw new Error(`Unsupported page type for ${filePath}`);
}

function inferSpecialOverride(title: string): string | null {
  for (const rule of SPECIAL_ROUTE_RULES) {
    if (rule.pattern.test(title)) {
      return rule.route;
    }
  }
  return null;
}

function inferLayoutConfigFromRawHtml(rawHtml: string): Array<{ type: string; enabled: boolean; props: Record<string, unknown> }> {
  const hasModule = (id: number) => new RegExp(`module${id}(?:[^0-9]|$)`, "i").test(rawHtml);
  const config: Array<{ type: string; enabled: boolean; props: Record<string, unknown> }> = [];

  if (hasModule(619)) {
    config.push({ type: "banner", enabled: true, props: {} });
  }
  if (hasModule(409)) {
    config.push({ type: "sidebar-nav", enabled: true, props: {} });
  }
  if (hasModule(419)) {
    config.push({ type: "timeline-list", enabled: true, props: {} });
  }
  if (hasModule(31)) {
    config.push({ type: "simple-list", enabled: true, props: {} });
  }
  if ([545, 548, 556, 557, 558, 559, 560, 561, 562, 563].some(hasModule)) {
    config.push({ type: "report-table", enabled: true, props: {} });
  }
  if ([601, 602, 603].some(hasModule)) {
    config.push({ type: "team-grid", enabled: true, props: {} });
  }

  if (config.length === 0) {
    config.push({ type: "simple-list", enabled: true, props: {} });
  }

  return config;
}

function quoteKey(author: string, content: string, articleOldSlug: string): string {
  return sha256(`${author}|${content}|${articleOldSlug}`).slice(0, 40);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findQuoteCandidates(cleanHtml: string): QuoteCandidate[] {
  const text = cheerio.load(`<div>${cleanHtml}</div>`).text().replace(/\s+/g, " ");
  const seen = new Set<string>();
  const out: QuoteCandidate[] = [];

  for (const rule of QUOTE_RULES) {
    const re = new RegExp(rule.regex.source, rule.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const author = (match[1] || "").trim();
      const content = (match[3] || match[2] || "").trim();
      if (!author || content.length < 6) {
        continue;
      }

      const key = `${author}|${content}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      out.push({
        author,
        content,
        sourceText: match[0],
        confidence: rule.confidence
      });
    }
  }

  // Low-confidence signal: keyword exists, but no rule captured a proper quote.
  const lowRules = [/欧阳修/, /高尔基/, /莎士比亚/];
  if (out.length === 0 && lowRules.some((rule) => rule.test(text))) {
    out.push({
      author: "unknown",
      content: "potential-quote-signal",
      sourceText: "keyword-only",
      confidence: "low"
    });
  }

  return out;
}

async function maybeCreateQuote(
  directus: DirectusClient | null,
  mode: MigrationMode,
  candidate: QuoteCandidate,
  articleOldSlug: string,
  isTestData: boolean
): Promise<{ id: string | null; reviewStatus: string }> {
  if (mode !== "import" || !directus) {
    return { id: null, reviewStatus: candidate.confidence === "high" ? "approved" : "needs_review" };
  }

  if (candidate.confidence === "low") {
    return { id: null, reviewStatus: "needs_review" };
  }

  const key = quoteKey(candidate.author, candidate.content, articleOldSlug);
  const payload = {
    content: candidate.content,
    author: candidate.author,
    source_book: "",
    confidence: candidate.confidence,
    review_status: candidate.confidence === "high" ? "approved" : "needs_review",
    display_order: 0,
    article_old_slug: articleOldSlug,
    quote_key: key,
    is_test_data: isTestData
  };

  const result = await directus.upsertByField("quotes", "quote_key", key, payload);
  return { id: String(result.item?.id ?? ""), reviewStatus: payload.review_status };
}

async function loadOrInitState(options: MigrationOptions): Promise<MigrationState> {
  if (options.resetState) {
    return {
      run_id: `run-${Date.now()}`,
      updated_at: buildTimestamp(),
      last_processed_slug: "",
      completed_slugs: [],
      asset_hash_map: {},
      failed_items: []
    };
  }

  const state = await loadJsonFile<MigrationState | null>(options.statePath, null);
  if (!state) {
    return {
      run_id: `run-${Date.now()}`,
      updated_at: buildTimestamp(),
      last_processed_slug: "",
      completed_slugs: [],
      asset_hash_map: {},
      failed_items: []
    };
  }

  return state;
}

async function loadCanaryTestOldSlugs(canaryManifestPath: string): Promise<Set<string>> {
  const manifest = await loadJsonFile<CanaryManifestShape | null>(canaryManifestPath, null);
  const slugs = new Set<string>();

  if (!manifest) {
    return slugs;
  }

  const syntheticSlug = String(manifest.synthetic?.old_slug || "").trim();
  if (syntheticSlug) {
    slugs.add(syntheticSlug);
  }

  if (Array.isArray(manifest.test_old_slugs)) {
    for (const item of manifest.test_old_slugs) {
      const normalized = String(item || "").trim();
      if (normalized) {
        slugs.add(normalized);
      }
    }
  }

  if (Array.isArray(manifest.test_records)) {
    for (const item of manifest.test_records) {
      const normalized = String(item?.old_slug || "").trim();
      if (normalized) {
        slugs.add(normalized);
      }
    }
  }

  return slugs;
}

async function saveState(statePath: string, state: MigrationState): Promise<void> {
  state.updated_at = buildTimestamp();
  await writeJsonAtomic(statePath, state);
}

async function buildSlugPlan(files: string[]): Promise<{ plan: Map<string, SlugPlanEntry>; conflicts: SlugConflict[] }> {
  const plan = new Map<string, SlugPlanEntry>();
  const conflicts: SlugConflict[] = [];
  const articleSlugSet = new Set<string>();
  const categorySlugSet = new Set<string>();

  for (const filePath of files) {
    const pageType = inferPageType(filePath);
    const oldSlug = path.basename(filePath, ".html");
    const raw = await fs.readFile(filePath, "utf8");
    const $ = cheerio.load(raw);
    const meta = extractMeta(raw, $);
    const title = meta.title || oldSlug;

    const initial = slugify(title, oldSlug);
    const decision = ensureUniqueSlug(initial, pageType === "nd" ? articleSlugSet : categorySlugSet);

    if (decision.changed) {
      conflicts.push({
        old_slug: oldSlug,
        page_type: pageType,
        title,
        original_slug: initial,
        final_slug: decision.slug,
        reason: decision.reason === "reserved" ? "reserved" : "collision"
      });
    }

    plan.set(oldSlug, {
      oldSlug,
      pageType,
      title,
      slug: decision.slug,
      legacyUrl: `/${oldSlug}.html`,
      sourcePath: filePath
    });
  }

  return { plan, conflicts };
}

async function downloadAssetWithRetry(url: string, retry: number, timeoutMs: number): Promise<Buffer> {
  let lastError: unknown = null;
  for (let i = 1; i <= retry; i += 1) {
    try {
      const res = await axios.get<ArrayBuffer>(url, {
        responseType: "arraybuffer",
        timeout: timeoutMs,
        validateStatus: (code) => code >= 200 && code < 400
      });
      return Buffer.from(res.data);
    } catch (error) {
      lastError = error;
      if (i < retry) {
        await new Promise((resolve) => setTimeout(resolve, 400 * i));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function resolveAssetBuffer(
  url: string,
  mirrorRoot: string,
  retry: number,
  timeoutMs: number
): Promise<{ data: Buffer; source: "mirror" | "remote"; filePath: string }> {
  const mirrorPath = toMirrorPathFromUrl(url, mirrorRoot);
  if (mirrorPath) {
    const local = await readIfExists(mirrorPath);
    if (local !== null) {
      const data = await fs.readFile(mirrorPath);
      return { data, source: "mirror", filePath: mirrorPath };
    }
  }

  const data = await downloadAssetWithRetry(url, retry, timeoutMs);
  const fileName = (() => {
    try {
      const parsed = new URL(url);
      return path.basename(parsed.pathname || "asset.bin") || "asset.bin";
    } catch {
      return "asset.bin";
    }
  })();

  return { data, source: "remote", filePath: fileName };
}

async function processNdPage(input: {
  options: MigrationOptions;
  directus: DirectusClient | null;
  state: MigrationState;
  fingerprintMap: Record<string, string>;
  assetUrlMap: Map<string, string>;
  missingAssets: MissingAsset[];
  assetPolicy: AssetPolicy;
  page: SlugPlanEntry;
  isTestData: boolean;
}): Promise<ProcessResult> {
  const { options, directus, state, fingerprintMap, assetUrlMap, missingAssets, assetPolicy, page, isTestData } = input;
  const startedAt = buildTimestamp();
  const errors: string[] = [];
  const warnings: string[] = [];

  const raw = await fs.readFile(page.sourcePath, "utf8");
  const $ = cheerio.load(raw);
  const meta = extractMeta(raw, $);

  const moduleContent = $("#module12 .richContent").first();
  const rawContent = moduleContent.length > 0 ? moduleContent.html() || "" : $("body").html() || "";
  const cleanedInitial = sanitizeHtml(rawContent);
  const missingAssetsStartIndex = missingAssets.length;

  let cleanedHtml = cleanedInitial;
  const fragment = cheerio.load(`<div id=\"__asset_root\">${cleanedHtml}</div>`);
  const missingAssetSeverityByUrl = new Map<string, MissingAsset["severity"]>();

  const referencedAssets = new Set<string>();
  fragment("img[src],source[src],a[href]").each((_, el) => {
    const attrName = el.tagName === "a" ? "href" : "src";
    const rawAttr = fragment(el).attr(attrName) || "";
    const normalized = normalizeLegacyAssetUrl(rawAttr, "hctxf.org");
    if (!normalized) {
      return;
    }
    if (normalized.startsWith("data:")) {
      return;
    }
    referencedAssets.add(normalized);
  });

  const assetStats = {
    referenced: referencedAssets.size,
    migrated: 0,
    reused_by_hash: 0,
    failed: 0
  };

  const limit = pLimit(options.concurrency);
  const replacements = new Map<string, string>();

  await Promise.all(
    [...referencedAssets].map((assetUrl) =>
      limit(async () => {
        try {
          if (assetUrlMap.has(assetUrl)) {
            replacements.set(assetUrl, assetUrlMap.get(assetUrl) || "");
            return;
          }

          const assetType = inferAssetType(assetUrl);
          const resolved = await resolveAssetBuffer(assetUrl, options.mirrorRoot, options.retry, options.assetTimeoutMs);
          const hash = sha256(resolved.data);

          const knownByHash = fingerprintMap[hash] || state.asset_hash_map[hash];
          if (knownByHash && !isDryFileId(knownByHash)) {
            replacements.set(assetUrl, knownByHash);
            assetUrlMap.set(assetUrl, knownByHash);
            assetStats.reused_by_hash += 1;
            return;
          }

          const fileName = (() => {
            try {
              const parsed = new URL(assetUrl);
              return path.basename(parsed.pathname || `${hash.slice(0, 12)}.bin`) || `${hash.slice(0, 12)}.bin`;
            } catch {
              return `${hash.slice(0, 12)}.bin`;
            }
          })();

          let fileId = `dry-${hash.slice(0, 16)}`;

          if (options.mode === "import") {
            if (!directus) {
              throw new Error("Import mode requires Directus client");
            }

            const uploaded = await directus.uploadFile({
              fileName,
              mimeType: guessMimeType(fileName, assetType),
              data: resolved.data,
              title: fileName,
              description: `Migrated from ${assetUrl}`
            });
            fileId = String(uploaded?.id || "");
            if (!fileId) {
              throw new Error(`Upload succeeded but file id is empty for ${assetUrl}`);
            }
          }

          fingerprintMap[hash] = fileId;
          state.asset_hash_map[hash] = fileId;
          replacements.set(assetUrl, fileId);
          assetUrlMap.set(assetUrl, fileId);
          assetStats.migrated += 1;
        } catch (error) {
          assetStats.failed += 1;
          const message = String((error as Error)?.message || error);
          warnings.push(`asset_failed:${assetUrl}:${message}`);
          const classification = classifyMissingAsset(assetUrl, assetPolicy);
          missingAssetSeverityByUrl.set(assetUrl, classification.severity);
          missingAssets.push({
            page_slug: page.oldSlug,
            asset_url: assetUrl,
            asset_type: inferAssetType(assetUrl),
            severity: classification.severity,
            domain: classification.domain,
            policy_reason: classification.policy_reason,
            error_type: "download_or_upload_failed",
            http_status: "",
            retry_count: options.retry,
            last_error_at: buildTimestamp()
          });
        }
      })
    )
  );

  fragment("img[src],source[src],a[href]").each((_, el) => {
    const attrName = el.tagName === "a" ? "href" : "src";
    const rawAttr = fragment(el).attr(attrName) || "";
    const normalized = normalizeLegacyAssetUrl(rawAttr, "hctxf.org");
    if (!normalized) {
      return;
    }

    const fileId = replacements.get(normalized);
    if (!fileId) {
      const missingSeverity = missingAssetSeverityByUrl.get(normalized);
      if (attrName === "src" && missingSeverity === "LOW" && inferAssetType(normalized) === "image") {
        fragment(el).attr(attrName, PLACEHOLDER_IMAGE_URL);
        warnings.push(`image_missing_placeholder:${page.oldSlug}:${normalized}`);
      }
      return;
    }

    fragment(el).attr(attrName, `/directus/assets/${fileId}`);
  });

  cleanedHtml = fragment("#__asset_root").html() || "";

  const quoteCandidates = findQuoteCandidates(cleanedHtml);
  const quoteStats: Record<QuoteConfidence, number> = {
    high: 0,
    medium: 0,
    low: 0
  };

  for (const candidate of quoteCandidates) {
    quoteStats[candidate.confidence] += 1;
  }

  for (const candidate of quoteCandidates) {
    if (candidate.confidence === "low") {
      warnings.push(`quote_low_confidence:${page.oldSlug}`);
      continue;
    }

    const quote = await maybeCreateQuote(directus, options.mode, candidate, page.oldSlug, isTestData);

    if (candidate.confidence === "high" && quote.id) {
      const replacement = `[quote:id=${quote.id}]`;
      const highPattern = new RegExp(
        `${escapeRegExp(candidate.author)}[^\\n，。]{0,10}(说|曾言|曾说|写道|认为)[:：]\\s*[“\"「]${escapeRegExp(
          candidate.content
        )}[”\"」]`,
        "i"
      );
      const before = cleanedHtml;
      cleanedHtml = cleanedHtml.replace(highPattern, replacement);
      if (before === cleanedHtml) {
        warnings.push(`quote_replace_fallback:${page.oldSlug}:${candidate.author}`);
      }
    }

    if (candidate.confidence === "medium") {
      warnings.push(`quote_needs_review:${page.oldSlug}:${candidate.author}`);
    }
  }

  const pageMissingAssets = missingAssets.slice(missingAssetsStartIndex);
  const pageCriticalMissingCount = pageMissingAssets.filter((item) => item.severity === "CRITICAL").length;
  const pageLowMissingCount = pageMissingAssets.filter((item) => item.severity === "LOW").length;
  const visibleContent = cheerio.load(`<div>${cleanedHtml}</div>`).text().replace(/\s+/g, " ").trim();
  const title = (meta.title || page.title || "").trim();
  const coreFieldsMissing = !title || !page.slug.trim() || !visibleContent;
  const htmlCleanFailureRate = rawContent.trim().length > 0 && cleanedHtml.trim().length === 0 ? 1 : 0;

  const hardBlockReasons: string[] = [];
  if (pageCriticalMissingCount > 0) {
    hardBlockReasons.push(`critical_missing_assets:${pageCriticalMissingCount}`);
  }
  if (htmlCleanFailureRate > HTML_CLEAN_FAILURE_RATE_BLOCK_THRESHOLD) {
    hardBlockReasons.push(`html_clean_failure_rate:${htmlCleanFailureRate.toFixed(4)}`);
  }
  if (coreFieldsMissing) {
    hardBlockReasons.push("core_fields_missing");
  }

  const isHardBlocked = hardBlockReasons.length > 0;
  const finalPipelineStatus: "imported" | "archived" = isHardBlocked ? "archived" : "imported";
  const finalStatus = isHardBlocked ? "needs_review" : "published";
  const migrationErrors = [...errors, ...warnings, ...hardBlockReasons];
  const quarantineReason = isHardBlocked ? hardBlockReasons.join("|") : "";
  let upsertResult: any = null;

  if (options.mode === "import") {
    if (!directus) {
      throw new Error("Import mode requires Directus client");
    }

    const payload: Record<string, unknown> = {
      title: meta.title || page.title,
      slug: page.slug,
      publish_date: meta.publishDate || null,
      content: cleanedHtml,
      old_slug: page.oldSlug,
      legacy_url: page.legacyUrl,
      raw_html_backup: rawContent,
      content_clean: cleanedHtml,
      migration_status: finalStatus,
      migration_errors: migrationErrors,
      pipeline_status: finalPipelineStatus,
      pipeline_attempts: 1,
      pipeline_started_at: startedAt,
      pipeline_finished_at: buildTimestamp(),
      last_pipeline_error: migrationErrors.join("; "),
      quarantine_reason: quarantineReason || null,
      seo_title: meta.title || "",
      seo_description: meta.description || "",
      seo_keywords: meta.keywords || "",
      is_test_data: isTestData
    };

    upsertResult = await directus.upsertByField("articles", "old_slug", page.oldSlug, payload);
    await directus.logAudit("migration_audit", {
      source_path: page.sourcePath,
      status: finalPipelineStatus,
      error: migrationErrors.join("; "),
      checksum: sha256(cleanedHtml),
      payload: {
        old_slug: page.oldSlug,
        page_type: page.pageType,
        slug: page.slug,
        migration_status: finalStatus,
        pipeline_status: finalPipelineStatus
      }
    });
  }

  return {
    old_slug: page.oldSlug,
    page_type: page.pageType,
    slug: page.slug,
    title: meta.title || page.title,
    status: isHardBlocked ? "failed" : "ok",
    migration_status: finalStatus,
    pipeline_status: finalPipelineStatus,
    quarantine_reason: quarantineReason || undefined,
    page_metrics: {
      critical_missing_assets: pageCriticalMissingCount,
      soft_warnings: pageLowMissingCount + warnings.length,
      missing_assets_total: pageMissingAssets.length
    },
    upsert_result: upsertResult
      ? {
          collection: "articles",
          mode: upsertResult.mode,
          item: upsertResult.item,
          existing: upsertResult.existing ?? null
        }
      : undefined,
    errors,
    warnings,
    quote_stats: quoteStats,
    asset_stats: assetStats
  };
}

async function processCategoryPage(input: {
  options: MigrationOptions;
  directus: DirectusClient | null;
  page: SlugPlanEntry;
  isTestData: boolean;
}): Promise<ProcessResult> {
  const { options, directus, page, isTestData } = input;
  const startedAt = buildTimestamp();
  const errors: string[] = [];
  const warnings: string[] = [];

  const raw = await fs.readFile(page.sourcePath, "utf8");
  const $ = cheerio.load(raw);
  const meta = extractMeta(raw, $);
  const layoutConfig = inferLayoutConfigFromRawHtml(raw);

  const routeOverride = inferSpecialOverride(meta.title || page.title);
  const categoryName = (meta.title || page.title || "").trim();
  const coreFieldsMissing = !categoryName || !page.slug.trim();
  const hardBlockReasons = coreFieldsMissing ? ["core_fields_missing"] : [];
  const isHardBlocked = hardBlockReasons.length > 0;
  const finalPipelineStatus: "imported" | "archived" = isHardBlocked ? "archived" : "imported";
  const finalStatus = isHardBlocked ? "needs_review" : "published";
  const migrationErrors = [...warnings, ...hardBlockReasons];
  let upsertResult: any = null;

  if (options.mode === "import") {
    if (!directus) {
      throw new Error("Import mode requires Directus client");
    }

    const payload = {
      name: meta.title || page.title,
      slug: page.slug,
      description: meta.description || "",
      old_slug: page.oldSlug,
      legacy_url: page.legacyUrl,
      raw_html_backup: "",
      content_clean: "",
      migration_status: finalStatus,
      migration_errors: migrationErrors,
      pipeline_status: finalPipelineStatus,
      pipeline_attempts: 1,
      pipeline_started_at: startedAt,
      pipeline_finished_at: buildTimestamp(),
      last_pipeline_error: migrationErrors.join("; "),
      quarantine_reason: isHardBlocked ? hardBlockReasons.join("|") : null,
      seo_title: meta.title || "",
      seo_description: meta.description || "",
      seo_keywords: meta.keywords || "",
      target_route_override: routeOverride,
      layout_config: layoutConfig,
      is_test_data: isTestData
    };

    upsertResult = await directus.upsertByField("categories", "old_slug", page.oldSlug, payload);
    await directus.logAudit("migration_audit", {
      source_path: page.sourcePath,
      status: finalPipelineStatus,
      error: migrationErrors.join("; "),
      checksum: sha256(JSON.stringify(payload)),
      payload: {
        old_slug: page.oldSlug,
        page_type: page.pageType,
        slug: page.slug,
        migration_status: finalStatus,
        pipeline_status: finalPipelineStatus
      }
    });
  }

  return {
    old_slug: page.oldSlug,
    page_type: page.pageType,
    slug: page.slug,
    title: meta.title || page.title,
    status: isHardBlocked ? "failed" : "ok",
    migration_status: finalStatus,
    pipeline_status: finalPipelineStatus,
    quarantine_reason: isHardBlocked ? hardBlockReasons.join("|") : undefined,
    errors,
    warnings: migrationErrors,
    page_metrics: {
      critical_missing_assets: 0,
      soft_warnings: migrationErrors.length,
      missing_assets_total: 0
    },
    upsert_result: upsertResult
      ? {
          collection: "categories",
          mode: upsertResult.mode,
          item: upsertResult.item,
          existing: upsertResult.existing ?? null
        }
      : undefined,
    quote_stats: { high: 0, medium: 0, low: 0 },
    asset_stats: {
      referenced: 0,
      migrated: 0,
      reused_by_hash: 0,
      failed: 0
    }
  };
}

async function writeMissingAssetsCsv(filePath: string, rows: MissingAsset[]): Promise<void> {
  await ensureParentDir(filePath);
  const header = "page_slug,asset_url,asset_type,severity,domain,policy_reason,error_type,http_status,retry_count,last_error_at";
  const lines = [header];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.page_slug),
        csvEscape(row.asset_url),
        csvEscape(row.asset_type),
        csvEscape(row.severity),
        csvEscape(row.domain),
        csvEscape(row.policy_reason),
        csvEscape(row.error_type),
        csvEscape(String(row.http_status)),
        csvEscape(String(row.retry_count)),
        csvEscape(row.last_error_at)
      ].join(",")
    );
  }
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function writeAutoArchivedCsv(filePath: string, rows: ProcessResult[]): Promise<void> {
  await ensureParentDir(filePath);
  const header = "old_slug,page_type,slug,title,quarantine_reason,suggestion";
  const lines = [header];
  for (const row of rows) {
    const reason = row.quarantine_reason || "";
    const suggestion = reason.includes("critical_missing_assets")
      ? "Upload missing assets or update allowed-domains policy and rerun"
      : reason.includes("core_fields_missing")
        ? "Fix title/slug/content in source HTML then rerun"
        : "Inspect migration_errors and rerun";
    lines.push(
      [
        csvEscape(row.old_slug),
        csvEscape(row.page_type),
        csvEscape(row.slug),
        csvEscape(row.title),
        csvEscape(reason),
        csvEscape(suggestion)
      ].join(",")
    );
  }
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function rollbackBatchWrites(directus: DirectusClient, ops: BatchWriteOperation[]): Promise<void> {
  const reversed = [...ops].reverse();
  for (const op of reversed) {
    try {
      if (op.mode === "create") {
        await directus.deleteItem(op.collection, op.item_id);
      } else {
        const restorePayload = { ...(op.previous || {}) };
        delete (restorePayload as Record<string, unknown>).id;
        await directus.updateItem(op.collection, op.item_id, restorePayload);
      }
      await directus.logAudit("migration_audit", {
        source_path: op.old_slug,
        status: "batch_rollback",
        error: "",
        checksum: "",
        payload: {
          old_slug: op.old_slug,
          collection: op.collection,
          mode: op.mode,
          item_id: op.item_id
        }
      });
    } catch (error) {
      await directus.logAudit("migration_audit", {
        source_path: op.old_slug,
        status: "batch_rollback_failed",
        error: String((error as Error)?.message || error),
        checksum: "",
        payload: {
          old_slug: op.old_slug,
          collection: op.collection,
          mode: op.mode,
          item_id: op.item_id
        }
      });
    }
  }
}

async function recoverStaleImportingRecords(options: MigrationOptions, directus: DirectusClient): Promise<number> {
  const cutoffMs = Date.now() - options.staleTimeoutMinutes * 60 * 1000;
  const collections = ["articles", "projects", "categories", "reports"];
  let recovered = 0;

  for (const collection of collections) {
    const items = await directus.listItems(collection, {
      fields: ["id", "old_slug", "pipeline_status", "pipeline_started_at", "pipeline_attempts", "migration_status"],
      filter: { "pipeline_status][_eq": "importing" },
      limit: -1
    });

    for (const item of items) {
      const startedAt = item?.pipeline_started_at ? Date.parse(String(item.pipeline_started_at)) : Number.NaN;
      if (!Number.isFinite(startedAt) || startedAt > cutoffMs) {
        continue;
      }

      const attempts = Number(item?.pipeline_attempts || 0);
      await directus.updateItem(collection, item.id, {
        pipeline_status: "failed",
        pipeline_attempts: attempts + 1,
        pipeline_finished_at: buildTimestamp(),
        last_pipeline_error: `timeout_recovered_after_${options.staleTimeoutMinutes}m`,
        migration_status: item?.migration_status === "published" ? "needs_review" : item?.migration_status || "needs_review"
      });
      recovered += 1;
    }
  }

  return recovered;
}

async function analyzeHomepage(inputDir: string): Promise<{
  file: string;
  detected: boolean;
  homepage_status: "excluded_by_design" | "missing";
  modules_detected: string[];
  action_plan: string;
  risk_level: "Low" | "Medium";
}> {
  const indexPath = path.join(inputDir, "index.html");
  const raw = await readIfExists(indexPath);
  if (!raw) {
    return {
      file: "index.html",
      detected: false,
      homepage_status: "missing",
      modules_detected: [],
      action_plan: "Mirror root has no index.html; verify source snapshot.",
      risk_level: "Medium"
    };
  }

  const moduleIds = new Set<string>();
  const re = /module([0-9]{1,6})/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    if (match[1]) {
      moduleIds.add(match[1]);
    }
  }

  return {
    file: "index.html",
    detected: true,
    homepage_status: "excluded_by_design",
    modules_detected: [...moduleIds].sort((a, b) => Number(a) - Number(b)),
    action_plan: "Manual configuration via Directus Singleton 'global_settings'.",
    risk_level: "Low"
  };
}

async function main() {
  const options = parseCli();
  console.log(`[migrate-content] mode=${options.mode} input=${options.inputDir} concurrency=${options.concurrency}`);

  const files = await listLegacyHtmlFiles(options.inputDir);
  if (files.length === 0) {
    throw new Error(`No legacy HTML files found under ${options.inputDir}`);
  }

  const assetPolicy = await loadAssetPolicy(options.assetPolicyPath);
  const { plan, conflicts } = await buildSlugPlan(files);
  const canaryTestOldSlugs = await loadCanaryTestOldSlugs(options.canaryManifestPath);
  const state = await loadOrInitState(options);
  const fingerprintMap = await loadJsonFile<Record<string, string>>(options.fingerprintMapPath, {});

  if (options.mode === "import") {
    const removedFromFingerprintMap = purgeDryMappingsInPlace(fingerprintMap);
    const removedFromStateMap = purgeDryMappingsInPlace(state.asset_hash_map);
    if (removedFromFingerprintMap > 0 || removedFromStateMap > 0) {
      console.log(
        `[migrate-content] import mode: purged dry cache entries fingerprint=${removedFromFingerprintMap} state=${removedFromStateMap}`
      );
      await saveState(options.statePath, state);
    }
  }

  const missingAssets: MissingAsset[] = [];
  const assetUrlMap = new Map<string, string>();

  const completed = new Set(state.completed_slugs || []);

  let directus: DirectusClient | null = null;
  let staleRecoveredCount = 0;
  if (options.mode === "import") {
    directus = await DirectusClient.create({
      baseUrl: options.directusUrl,
      token: options.directusToken || undefined,
      email: options.directusEmail,
      password: options.directusPassword
    });
    staleRecoveredCount = await recoverStaleImportingRecords(options, directus);
    if (staleRecoveredCount > 0) {
      console.log(`[migrate-content] recovered stale importing rows=${staleRecoveredCount}`);
    }
  }

  const results: ProcessResult[] = [];
  let processed = 0;
  const pagesToProcess: SlugPlanEntry[] = [];
  for (const filePath of files) {
    const oldSlug = path.basename(filePath, ".html");
    const page = plan.get(oldSlug);
    if (!page) {
      continue;
    }
    if (options.resume && completed.has(oldSlug)) {
      continue;
    }
    pagesToProcess.push(page);
  }

  const targetPages = options.maxPages > 0 ? pagesToProcess.slice(0, options.maxPages) : pagesToProcess;

  let batchStart = 0;
  while (batchStart < targetPages.length) {
    const batch = targetPages.slice(batchStart, batchStart + options.batchSize);
    const batchWriteOps: BatchWriteOperation[] = [];
    const batchResultIndexes: number[] = [];
    let batchFailed = false;
    let batchConsumed = 0;

    for (const page of batch) {
      const oldSlug = page.oldSlug;
      batchConsumed += 1;
      try {
        let result: ProcessResult;
        if (page.pageType === "nd") {
          result = await processNdPage({
            options,
            directus,
            state,
            fingerprintMap,
            assetUrlMap,
            missingAssets,
            assetPolicy,
            page,
            isTestData: canaryTestOldSlugs.has(page.oldSlug)
          });
        } else {
          result = await processCategoryPage({
            options,
            directus,
            page,
            isTestData: canaryTestOldSlugs.has(page.oldSlug)
          });
        }

        if (options.mode === "import" && result.upsert_result?.item?.id !== undefined) {
          batchWriteOps.push({
            collection: result.upsert_result.collection,
            old_slug: result.old_slug,
            mode: result.upsert_result.mode,
            item_id: result.upsert_result.item.id,
            previous: result.upsert_result.existing ?? null
          });
        }

        const idx = results.push(result) - 1;
        batchResultIndexes.push(idx);
        completed.add(oldSlug);
        state.completed_slugs = [...completed];
        state.last_processed_slug = oldSlug;
        await saveState(options.statePath, state);

        if (processed % 10 === 0) {
          await writeJsonAtomic(options.fingerprintMapPath, fingerprintMap);
        }
      } catch (error) {
        const message = String((error as Error)?.message || error);
        results.push({
          old_slug: oldSlug,
          page_type: page.pageType,
          slug: page.slug,
          title: page.title,
          status: "failed",
          migration_status: "needs_review",
          pipeline_status: "failed",
          errors: [message],
          warnings: [],
          quote_stats: { high: 0, medium: 0, low: 0 },
          asset_stats: { referenced: 0, migrated: 0, reused_by_hash: 0, failed: 0 }
        });

        state.failed_items.push({ old_slug: oldSlug, error: message, at: buildTimestamp() });
        await saveState(options.statePath, state);
        batchFailed = true;
        break;
      }

      processed += 1;
      if (processed % 25 === 0) {
        console.log(`[migrate-content] processed=${processed}/${targetPages.length}`);
      }
    }

    if (batchFailed && options.mode === "import" && directus && batchWriteOps.length > 0) {
      await rollbackBatchWrites(directus, batchWriteOps);
      for (const resultIndex of batchResultIndexes) {
        const row = results[resultIndex];
        if (!row) {
          continue;
        }
        row.status = "failed";
        row.pipeline_status = "failed";
        row.migration_status = "needs_review";
        row.warnings = [...row.warnings, "batch_rolled_back"];
        completed.delete(row.old_slug);
      }
      state.completed_slugs = [...completed];
      await saveState(options.statePath, state);
    }

    batchStart += batchFailed ? Math.max(1, batchConsumed) : batch.length;
  }

  await writeJsonAtomic(options.fingerprintMapPath, fingerprintMap);
  await writeJsonAtomic(options.dedupCachePath, fingerprintMap);
  await writeMissingAssetsCsv(options.missingAssetsPath, missingAssets);
  const autoArchivedRows = results.filter((item) => item.pipeline_status === "archived");
  await writeAutoArchivedCsv(options.autoArchivedReportPath, autoArchivedRows);

  const totals = {
    total: results.length,
    success: results.filter((item) => item.status === "ok").length,
    needs_review: results.filter((item) => item.migration_status === "needs_review").length,
    failed: results.filter((item) => item.status === "failed").length
  };

  const errorRate = totals.total > 0 ? totals.failed / totals.total : 0;
  const quoteStats = results.reduce(
    (acc, item) => {
      acc.high += item.quote_stats.high;
      acc.medium += item.quote_stats.medium;
      acc.low += item.quote_stats.low;
      return acc;
    },
    { high: 0, medium: 0, low: 0 }
  );
  const criticalMissingAssets = missingAssets.filter((item) => item.severity === "CRITICAL");
  const lowMissingAssets = missingAssets.filter((item) => item.severity === "LOW");
  const homepageAnalysis = await analyzeHomepage(options.inputDir);
  const totalFilesScanned = totals.total + (homepageAnalysis.detected ? 1 : 0);
  const quoteNeedsReviewPages = results
    .filter((item) => item.warnings.some((w) => w.startsWith("quote_needs_review:") || w.startsWith("quote_low_confidence:")))
    .map((item) => ({ old_slug: item.old_slug, warnings: item.warnings.filter((w) => w.startsWith("quote_")) }));

  const report = {
    mode: options.mode,
    generated_at: buildTimestamp(),
    input_dir: options.inputDir,
    manifest_path: options.manifestPath,
    layout_map_path: options.layoutMapPath,
    canary_manifest_path: options.canaryManifestPath,
    canary_test_old_slugs: [...canaryTestOldSlugs].sort(),
    max_pages: options.maxPages,
    asset_timeout_ms: options.assetTimeoutMs,
    totals,
    error_rate: Number(errorRate.toFixed(6)),
    expected_error_rate_threshold: options.expectedErrorRate,
    media_success_rate: (() => {
      const referenced = results.reduce((acc, r) => acc + r.asset_stats.referenced, 0);
      const failed = results.reduce((acc, r) => acc + r.asset_stats.failed, 0);
      if (referenced === 0) {
        return 1;
      }
      return Number(((referenced - failed) / referenced).toFixed(6));
    })(),
    summary: {
      content_pages_migrated: totals.total,
      homepage_status: homepageAnalysis.homepage_status,
      total_files_scanned: totalFilesScanned
    },
    homepage_analysis: homepageAnalysis,
    quote_stats: quoteStats,
    slug_conflicts: conflicts,
    missing_assets_count: criticalMissingAssets.length,
    missing_assets_total_count: missingAssets.length,
    missing_assets_low_count: lowMissingAssets.length,
    missing_assets_critical_count: criticalMissingAssets.length,
    stale_recovered_count: staleRecoveredCount,
    auto_archived_count: autoArchivedRows.length,
    asset_policy: assetPolicy,
    results
  };

  await writeJsonAtomic(options.reportPath, report);
  await writeJsonAtomic(options.quoteReportPath, {
    generated_at: buildTimestamp(),
    source_report_path: options.reportPath,
    totals: {
      high: quoteStats.high,
      medium: quoteStats.medium,
      low: quoteStats.low,
      extracted: quoteStats.high + quoteStats.medium + quoteStats.low
    },
    needs_review_pages: quoteNeedsReviewPages
  });

  console.log(`[migrate-content] done report=${options.reportPath}`);
  console.log(`[migrate-content] quote report=${options.quoteReportPath}`);
  console.log(`[migrate-content] auto archived report=${options.autoArchivedReportPath}`);
  console.log(`[migrate-content] totals=${JSON.stringify(totals)} error_rate=${errorRate.toFixed(4)}`);
  console.log(
    `[migrate-content] missing_assets critical=${criticalMissingAssets.length}, low=${lowMissingAssets.length}, total=${missingAssets.length}`
  );

  if (options.mode === "dry-run" && errorRate > options.expectedErrorRate) {
    throw new Error(
      `Dry-run blocked: error_rate=${errorRate.toFixed(4)} exceeds threshold=${options.expectedErrorRate.toFixed(4)}`
    );
  }

  if (options.mode === "dry-run" && options.strictMissingAssets && criticalMissingAssets.length > 0) {
    console.error(`[migrate-content] blocked: critical missing assets=${criticalMissingAssets.length}`);
    console.error(`[migrate-content] inspect: ${options.missingAssetsPath}`);
    throw new Error("Dry-run blocked by missing critical assets");
  }
}

main().catch((error) => {
  console.error("[migrate-content] fatal:", error);
  process.exit(1);
});
