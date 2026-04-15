#!/usr/bin/env tsx
import { buildTimestamp, getNumberArg, getStringArg, parseArgs, resolveRepoPath, writeJsonAtomic } from "./lib/common.js";
import { DirectusClient } from "./lib/directus.js";

async function main() {
  const args = parseArgs(process.argv);
  const directusUrl = getStringArg(args, "directus-url", process.env.DIRECTUS_URL || process.env.DIRECTUS_PUBLIC_URL || "http://localhost:8055");
  const directusToken = getStringArg(args, "directus-token", process.env.DIRECTUS_TOKEN || "");
  const directusEmail = getStringArg(args, "directus-email", process.env.DIRECTUS_ADMIN_EMAIL || "admin@example.com");
  const directusPassword = getStringArg(args, "directus-password", process.env.DIRECTUS_ADMIN_PASSWORD || "ChangeMe_123456");
  const staleTimeoutMin = Math.max(1, getNumberArg(args, "stale-timeout-min", 30));
  const reportPath = resolveRepoPath(getStringArg(args, "report", "reports/migration/stale_recovery_report.json"));

  const directus = await DirectusClient.create({
    baseUrl: directusUrl,
    token: directusToken || undefined,
    email: directusEmail,
    password: directusPassword
  });

  const cutoffMs = Date.now() - staleTimeoutMin * 60 * 1000;
  const collections = ["articles", "projects", "categories", "reports"];
  const recovered: Array<{ collection: string; id: string | number; old_slug: string }> = [];

  for (const collection of collections) {
    const rows = await directus.listItems(collection, {
      fields: ["id", "old_slug", "pipeline_status", "pipeline_started_at", "pipeline_attempts", "migration_status"],
      filter: { "pipeline_status][_eq": "importing" },
      limit: -1
    });

    for (const row of rows) {
      const startedAtRaw = row?.pipeline_started_at ? String(row.pipeline_started_at) : "";
      const startedAt = startedAtRaw ? Date.parse(startedAtRaw) : Number.NaN;
      if (!Number.isFinite(startedAt) || startedAt > cutoffMs) {
        continue;
      }

      await directus.updateItem(collection, row.id, {
        pipeline_status: "failed",
        pipeline_finished_at: buildTimestamp(),
        pipeline_attempts: Number(row?.pipeline_attempts || 0) + 1,
        last_pipeline_error: `timeout_recovered_after_${staleTimeoutMin}m`,
        migration_status: row?.migration_status === "published" ? "needs_review" : row?.migration_status || "needs_review"
      });

      recovered.push({
        collection,
        id: row.id,
        old_slug: String(row?.old_slug || "")
      });
    }
  }

  const report = {
    generated_at: buildTimestamp(),
    stale_timeout_minutes: staleTimeoutMin,
    recovered_count: recovered.length,
    recovered
  };

  await writeJsonAtomic(reportPath, report);
  console.log(`[recover-stale-imports] report=${reportPath} recovered=${recovered.length}`);
}

main().catch((error) => {
  console.error("[recover-stale-imports] fatal", error);
  process.exit(1);
});
