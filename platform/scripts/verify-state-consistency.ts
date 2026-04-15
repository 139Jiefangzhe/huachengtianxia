#!/usr/bin/env tsx
import { buildTimestamp, getStringArg, parseArgs, resolveRepoPath, writeJsonAtomic } from "./lib/common.js";
import { DirectusClient } from "./lib/directus.js";

type Inconsistency = {
  collection: string;
  id: string | number;
  old_slug: string;
  pipeline_status: string;
  migration_status: string;
  reason: string;
};

async function main() {
  const args = parseArgs(process.argv);
  const directusUrl = getStringArg(args, "directus-url", process.env.DIRECTUS_URL || process.env.DIRECTUS_PUBLIC_URL || "http://localhost:8055");
  const directusToken = getStringArg(args, "directus-token", process.env.DIRECTUS_TOKEN || "");
  const directusEmail = getStringArg(args, "directus-email", process.env.DIRECTUS_ADMIN_EMAIL || "admin@example.com");
  const directusPassword = getStringArg(args, "directus-password", process.env.DIRECTUS_ADMIN_PASSWORD || "ChangeMe_123456");
  const reportPath = resolveRepoPath(getStringArg(args, "report", "reports/migration/state_consistency_report.json"));

  const directus = await DirectusClient.create({
    baseUrl: directusUrl,
    token: directusToken || undefined,
    email: directusEmail,
    password: directusPassword
  });

  const collections = ["articles", "projects", "categories", "reports"];
  const inconsistencies: Inconsistency[] = [];

  for (const collection of collections) {
    const rows = await directus.listItems(collection, {
      fields: ["id", "old_slug", "pipeline_status", "migration_status", "quarantine_reason", "last_pipeline_error"],
      limit: -1
    });

    for (const row of rows) {
      const pipelineStatus = String(row?.pipeline_status || "pending");
      const migrationStatus = String(row?.migration_status || "draft_raw");
      const oldSlug = String(row?.old_slug || "");

      if (pipelineStatus !== "pending" && migrationStatus === "draft_raw") {
        inconsistencies.push({
          collection,
          id: row?.id,
          old_slug: oldSlug,
          pipeline_status: pipelineStatus,
          migration_status: migrationStatus,
          reason: "non_pending_pipeline_with_draft_raw"
        });
      }

      if (pipelineStatus === "archived" && migrationStatus === "published") {
        inconsistencies.push({
          collection,
          id: row?.id,
          old_slug: oldSlug,
          pipeline_status: pipelineStatus,
          migration_status: migrationStatus,
          reason: "archived_but_published"
        });
      }

      if (migrationStatus === "published" && pipelineStatus !== "imported") {
        inconsistencies.push({
          collection,
          id: row?.id,
          old_slug: oldSlug,
          pipeline_status: pipelineStatus,
          migration_status: migrationStatus,
          reason: "published_without_imported_pipeline"
        });
      }
    }
  }

  const report = {
    generated_at: buildTimestamp(),
    totals: {
      checked_collections: collections.length,
      inconsistent_rows: inconsistencies.length
    },
    inconsistencies
  };

  await writeJsonAtomic(reportPath, report);
  console.log(`[verify-state-consistency] report=${reportPath} inconsistencies=${inconsistencies.length}`);

  if (inconsistencies.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[verify-state-consistency] fatal", error);
  process.exit(1);
});
