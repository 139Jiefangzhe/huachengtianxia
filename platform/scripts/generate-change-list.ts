#!/usr/bin/env tsx
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildTimestamp, getNumberArg, getStringArg, parseArgs, resolveRepoPath } from "./lib/common.js";
import { DirectusClient } from "./lib/directus.js";

async function writeLines(filePath: string, lines: string[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

function isRecent(input: unknown, cutoffMs: number): boolean {
  if (!input) return false;
  const parsed = Date.parse(String(input));
  return Number.isFinite(parsed) && parsed >= cutoffMs;
}

async function main() {
  const args = parseArgs(process.argv);
  const directusUrl = getStringArg(args, "directus-url", process.env.DIRECTUS_URL || process.env.DIRECTUS_PUBLIC_URL || "http://localhost:8055");
  const directusToken = getStringArg(args, "directus-token", process.env.DIRECTUS_TOKEN || "");
  const directusEmail = getStringArg(args, "directus-email", process.env.DIRECTUS_ADMIN_EMAIL || "admin@example.com");
  const directusPassword = getStringArg(args, "directus-password", process.env.DIRECTUS_ADMIN_PASSWORD || "ChangeMe_123456");
  const lookbackHours = Math.max(1, getNumberArg(args, "lookback-hours", 24));
  const sinceRaw = getStringArg(args, "since", "");
  const outputPath = resolveRepoPath(getStringArg(args, "output", "reports/migration/changed_urls.txt"));

  const directus = await DirectusClient.create({
    baseUrl: directusUrl,
    token: directusToken || undefined,
    email: directusEmail,
    password: directusPassword
  });

  const cutoffMs = (() => {
    if (sinceRaw) {
      const parsed = Date.parse(sinceRaw);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid --since value: ${sinceRaw}`);
      }
      return parsed;
    }
    return Date.now() - lookbackHours * 60 * 60 * 1000;
  })();
  const urls = new Set<string>();

  const articles = await directus.listItems("articles", {
    fields: ["slug", "migration_status", "pipeline_status", "pipeline_finished_at", "date_updated"],
    filter: {
      "migration_status][_eq": "published",
      "pipeline_status][_eq": "imported",
      "is_test_data][_neq": "true"
    },
    limit: -1
  });

  for (const row of articles) {
    if (!row?.slug) continue;
    const recent = isRecent(row?.date_updated, cutoffMs) || isRecent(row?.pipeline_finished_at, cutoffMs);
    if (recent) {
      urls.add(`/news/${row.slug}`);
    }
  }

  const categories = await directus.listItems("categories", {
    fields: ["slug", "target_route_override", "migration_status", "pipeline_status", "pipeline_finished_at", "date_updated"],
    filter: {
      "migration_status][_eq": "published",
      "pipeline_status][_eq": "imported",
      "is_test_data][_neq": "true"
    },
    limit: -1
  });

  for (const row of categories) {
    if (!row?.slug) continue;
    const recent = isRecent(row?.date_updated, cutoffMs) || isRecent(row?.pipeline_finished_at, cutoffMs);
    if (!recent) continue;
    urls.add(row?.target_route_override || `/news/category/${row.slug}`);
  }

  // Always include fixed high-value pages.
  ["/", "/transparency", "/about/team", "/news/category"].forEach((x) => urls.add(x));

  const ordered = [...urls].sort();
  await writeLines(outputPath, ordered);
  console.log(
    `[generate-change-list] generated_at=${buildTimestamp()} output=${outputPath} urls=${ordered.length} since=${
      sinceRaw || `-${lookbackHours}h`
    }`
  );
}

main().catch((error) => {
  console.error("[generate-change-list] fatal", error);
  process.exit(1);
});
