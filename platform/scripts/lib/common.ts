import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseDelimited } from "csv-parse/sync";

export type CliArgs = Record<string, string | boolean>;

export type LegacyPageType = "nd" | "col" | "nr" | "other";

export const RESERVED_SLUGS = new Set([
  "api",
  "_next",
  "static",
  "favicon-ico",
  "robots-txt",
  "sitemap-xml",
  "health",
  "news",
  "projects",
  "about",
  "contact",
  "transparency"
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

export function resolveRepoPath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.resolve(REPO_ROOT, inputPath);
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }
  return args;
}

export function getStringArg(args: CliArgs, key: string, fallback: string): string {
  const value = args[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return fallback;
}

export function getBooleanArg(args: CliArgs, key: string, fallback = false): boolean {
  const value = args[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

export function getNumberArg(args: CliArgs, key: string, fallback: number): number {
  const value = args[key];
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

export async function ensureParentDir(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

export async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await ensureParentDir(filePath);
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

export async function writeTextAtomic(filePath: string, text: string): Promise<void> {
  await ensureParentDir(filePath);
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, filePath);
}

export function sha256(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function detectLegacyPageType(fileName: string): LegacyPageType {
  const base = path.basename(fileName).toLowerCase();
  if (/^nd[0-9a-z-]+\.html$/.test(base)) {
    return "nd";
  }
  if (/^col[0-9a-z-]+\.html$/.test(base)) {
    return "col";
  }
  if (/^nr[0-9a-z-]*\.html$/.test(base)) {
    return "nr";
  }
  return "other";
}

export async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (entry.isFile()) {
        out.push(abs);
      }
    }
  }

  await walk(root);
  return out;
}

export async function listLegacyHtmlFiles(root: string): Promise<string[]> {
  const files = await walkFiles(root);
  return files
    .filter((filePath) => filePath.toLowerCase().endsWith(".html"))
    .filter((filePath) => detectLegacyPageType(filePath) !== "other")
    .sort();
}

export function slugify(input: string, fallback: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length > 0) {
    return normalized;
  }

  return fallback
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "legacy-item";
}

export type SlugDecision = {
  slug: string;
  changed: boolean;
  reason: "reserved" | "collision" | "unchanged";
};

export function ensureUniqueSlug(base: string, used: Set<string>): SlugDecision {
  let slug = base;
  let changed = false;
  let reason: SlugDecision["reason"] = "unchanged";

  if (RESERVED_SLUGS.has(slug)) {
    slug = `legacy-${slug}`;
    changed = true;
    reason = "reserved";
  }

  if (!used.has(slug)) {
    used.add(slug);
    return { slug, changed, reason };
  }

  let suffix = 1;
  const root = slug;
  while (used.has(`${root}-${suffix}`)) {
    suffix += 1;
  }

  slug = `${root}-${suffix}`;
  used.add(slug);
  return { slug, changed: true, reason: "collision" };
}

export function detectDelimiter(content: string, filePath: string): "," | "\t" {
  if (filePath.toLowerCase().endsWith(".tsv")) {
    return "\t";
  }

  const firstLine = content.split(/\r?\n/, 1)[0] || "";
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;

  return tabCount >= commaCount ? "\t" : ",";
}

export async function readTable(filePath: string): Promise<Record<string, string>[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const delimiter = detectDelimiter(raw, filePath);
  const records = parseDelimited(raw, {
    columns: true,
    delimiter,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true
  }) as Record<string, string>[];
  return records;
}

export function normalizeLegacyAssetUrl(url: string, defaultHost = "hctxf.org"): string | null {
  if (!url || !url.trim()) {
    return null;
  }

  const trimmed = url.trim();
  if (trimmed.startsWith("data:")) {
    return null;
  }
  if (/^(javascript:|mailto:|tel:|#)/i.test(trimmed)) {
    return null;
  }

  const normalizedDots = trimmed.replace(/^\.\//, "");
  const parentHostMatch = normalizedDots.match(/^(?:\.\.\/)+([a-z0-9.-]+\.[a-z]{2,})(\/.*)?$/i);
  if (parentHostMatch) {
    const host = parentHostMatch[1];
    const rest = parentHostMatch[2] || "/";
    return `https://${host}${rest.startsWith("/") ? rest : `/${rest}`}`;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (normalizedDots.startsWith("/")) {
    return `https://${defaultHost}${normalizedDots}`;
  }

  return `https://${defaultHost}/${normalizedDots}`;
}

export function toMirrorPathFromUrl(url: string, mirrorRoot: string): string | null {
  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname || "/").replace(/^\/+/, "");
    return path.join(mirrorRoot, parsed.host, pathname);
  } catch {
    return null;
  }
}

export function csvEscape(value: string): string {
  const safe = value ?? "";
  if (/[,"\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function buildTimestamp(): string {
  return new Date().toISOString();
}

export async function loadJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  const raw = await readIfExists(filePath);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
