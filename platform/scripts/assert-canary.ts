#!/usr/bin/env tsx
import { buildTimestamp, getStringArg, parseArgs, resolveRepoPath, writeJsonAtomic } from "./lib/common.js";
import { DirectusClient } from "./lib/directus.js";
import { promises as fs } from "node:fs";

type CanaryManifest = {
  synthetic: {
    old_slug: string;
    min_quotes?: number;
    require_published?: boolean;
  };
  real_subset: Array<{
    old_slug: string;
    collection?: "articles" | "categories" | "projects" | "reports";
  }>;
};

async function findOneByOldSlug(
  directus: DirectusClient,
  collection: string,
  oldSlug: string,
  requirePublished: boolean
): Promise<any | null> {
  const rows = await directus.listItems(collection, {
    fields: ["id", "old_slug", "slug", "migration_status", "pipeline_status", "content", "title", "name"],
    filter: {
      "old_slug][_eq": oldSlug,
      ...(requirePublished ? { "migration_status][_eq": "published", "pipeline_status][_eq": "imported" } : {})
    },
    limit: 1
  });
  return rows[0] || null;
}

function inferCollection(oldSlug: string): "articles" | "categories" | "projects" | "reports" {
  if (oldSlug.startsWith("nd")) return "articles";
  if (oldSlug.startsWith("col") || oldSlug.startsWith("nr")) return "categories";
  if (oldSlug.startsWith("proj")) return "projects";
  return "articles";
}

async function main() {
  const args = parseArgs(process.argv);
  const directusUrl = getStringArg(args, "directus-url", process.env.DIRECTUS_URL || process.env.DIRECTUS_PUBLIC_URL || "http://localhost:8055");
  const directusToken = getStringArg(args, "directus-token", process.env.DIRECTUS_TOKEN || "");
  const directusEmail = getStringArg(args, "directus-email", process.env.DIRECTUS_ADMIN_EMAIL || "admin@example.com");
  const directusPassword = getStringArg(args, "directus-password", process.env.DIRECTUS_ADMIN_PASSWORD || "ChangeMe_123456");
  const manifestPath = resolveRepoPath(getStringArg(args, "manifest", "reports/canary/canary_manifest.json"));
  const reportPath = resolveRepoPath(getStringArg(args, "report", "reports/canary/canary-assert-report.json"));

  const manifestRaw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const manifest = manifestRaw as CanaryManifest;

  const directus = await DirectusClient.create({
    baseUrl: directusUrl,
    token: directusToken || undefined,
    email: directusEmail,
    password: directusPassword
  });

  const report: any = {
    generated_at: buildTimestamp(),
    manifest_path: manifestPath,
    synthetic: { pass: false, errors: [] as string[] },
    real_subset: { pass: false, failures: [] as string[] }
  };

  // Step 1: synthetic fail-fast
  const synthetic = await findOneByOldSlug(
    directus,
    "articles",
    manifest.synthetic.old_slug,
    manifest.synthetic.require_published !== false
  );

  if (!synthetic) {
    report.synthetic.errors.push(`synthetic_missing:${manifest.synthetic.old_slug}`);
    await writeJsonAtomic(reportPath, report);
    console.error(`[assert-canary] synthetic failed, see ${reportPath}`);
    process.exit(1);
  }

  const minQuotes = Number(manifest.synthetic.min_quotes || 1);
  const quotes = await directus.listItems("quotes", {
    // Keep fields minimal here. Directus 11 has an edge-case where a larger
    // field set on this collection can return an empty array despite matches.
    fields: ["id"],
    filter: {
      "article_old_slug][_eq": manifest.synthetic.old_slug
    },
    limit: -1
  });

  if (quotes.length < minQuotes) {
    report.synthetic.errors.push(`synthetic_quote_count_lt_${minQuotes}`);
  }
  if (!String(synthetic.content || "").includes("[quote:id=")) {
    report.synthetic.errors.push("synthetic_quote_placeholder_missing");
  }

  report.synthetic.pass = report.synthetic.errors.length === 0;
  if (!report.synthetic.pass) {
    await writeJsonAtomic(reportPath, report);
    console.error(`[assert-canary] synthetic failed, see ${reportPath}`);
    process.exit(1);
  }

  // Step 2: real subset
  for (const row of manifest.real_subset || []) {
    const collection = row.collection || inferCollection(row.old_slug);
    const found = await findOneByOldSlug(directus, collection, row.old_slug, true);
    if (!found) {
      report.real_subset.failures.push(`${collection}:${row.old_slug}:missing_or_not_published`);
    }
  }
  report.real_subset.pass = report.real_subset.failures.length === 0;

  await writeJsonAtomic(reportPath, report);
  console.log(`[assert-canary] report=${reportPath} synthetic=${report.synthetic.pass} real=${report.real_subset.pass}`);

  if (!report.real_subset.pass) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[assert-canary] fatal", error);
  process.exit(1);
});
