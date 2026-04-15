#!/usr/bin/env tsx
import { promises as fs } from "node:fs";
import { buildTimestamp, csvEscape, ensureParentDir, getBooleanArg, getNumberArg, getStringArg, parseArgs, resolveRepoPath } from "./lib/common.js";
import { DirectusClient } from "./lib/directus.js";

type ArchivedRow = {
  collection: string;
  id: string | number;
  old_slug: string;
  pipeline_attempts: number;
  reason: string;
};

async function writeCsv(filePath: string, rows: ArchivedRow[]): Promise<void> {
  const header = "collection,id,old_slug,pipeline_attempts,reason";
  const lines = [header];
  for (const row of rows) {
    lines.push([
      csvEscape(row.collection),
      csvEscape(String(row.id)),
      csvEscape(row.old_slug),
      csvEscape(String(row.pipeline_attempts)),
      csvEscape(row.reason)
    ].join(","));
  }
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv);
  const directusUrl = getStringArg(args, "directus-url", process.env.DIRECTUS_URL || process.env.DIRECTUS_PUBLIC_URL || "http://localhost:8055");
  const directusToken = getStringArg(args, "directus-token", process.env.DIRECTUS_TOKEN || "");
  const directusEmail = getStringArg(args, "directus-email", process.env.DIRECTUS_ADMIN_EMAIL || "admin@example.com");
  const directusPassword = getStringArg(args, "directus-password", process.env.DIRECTUS_ADMIN_PASSWORD || "ChangeMe_123456");
  const maxAttempts = Math.max(1, getNumberArg(args, "max-attempts", 3));
  const dryRun = getBooleanArg(args, "dry-run", false);
  const reportCsv = resolveRepoPath(getStringArg(args, "report-csv", "reports/migration/final_error_report.csv"));

  const directus = await DirectusClient.create({
    baseUrl: directusUrl,
    token: directusToken || undefined,
    email: directusEmail,
    password: directusPassword
  });

  const collections = ["articles", "projects", "categories", "reports"];
  const archivedRows: ArchivedRow[] = [];
  let resetCount = 0;

  for (const collection of collections) {
    const rows = await directus.listItems(collection, {
      fields: ["id", "old_slug", "pipeline_status", "pipeline_attempts", "last_pipeline_error"],
      filter: { "pipeline_status][_eq": "failed" },
      limit: -1
    });

    for (const row of rows) {
      const attempts = Number(row?.pipeline_attempts || 0);
      if (attempts >= maxAttempts) {
        const reason = `max_attempts_exceeded_${attempts}`;
        archivedRows.push({
          collection,
          id: row.id,
          old_slug: String(row?.old_slug || ""),
          pipeline_attempts: attempts,
          reason
        });

        if (!dryRun) {
          await directus.updateItem(collection, row.id, {
            pipeline_status: "archived",
            quarantine_reason: reason,
            pipeline_finished_at: buildTimestamp(),
            migration_status: "needs_review"
          });
        }
        continue;
      }

      if (!dryRun) {
        await directus.updateItem(collection, row.id, {
          pipeline_status: "pending",
          pipeline_attempts: attempts + 1,
          last_pipeline_error: `${row?.last_pipeline_error || ""};auto_heal_retry_${attempts + 1}`,
          pipeline_started_at: null,
          pipeline_finished_at: null
        });
      }
      resetCount += 1;
    }
  }

  await writeCsv(reportCsv, archivedRows);
  console.log(`[auto-heal-migration] dry_run=${dryRun} reset_to_pending=${resetCount} archived=${archivedRows.length} report=${reportCsv}`);
}

main().catch((error) => {
  console.error("[auto-heal-migration] fatal", error);
  process.exit(1);
});
