#!/usr/bin/env tsx
import { buildTimestamp, getNumberArg, getStringArg, parseArgs, resolveRepoPath, writeJsonAtomic } from "./lib/common.js";
import { DirectusClient } from "./lib/directus.js";

type Options = {
  directusUrl: string;
  directusToken: string;
  directusEmail: string;
  directusPassword: string;
  expectedArticles: number;
  expectedCategories: number;
  reportPath: string;
};

const DEFAULTS: Options = {
  directusUrl: process.env.DIRECTUS_URL || process.env.DIRECTUS_PUBLIC_URL || "http://localhost:8055",
  directusToken: process.env.DIRECTUS_TOKEN || "",
  directusEmail: process.env.DIRECTUS_ADMIN_EMAIL || "admin@example.com",
  directusPassword: process.env.DIRECTUS_ADMIN_PASSWORD || "ChangeMe_123456",
  expectedArticles: 604,
  expectedCategories: 60,
  reportPath: "reports/migration/import-validate-report.json"
};

function parseCli(): Options {
  const args = parseArgs(process.argv);
  return {
    ...DEFAULTS,
    directusUrl: getStringArg(args, "directus-url", DEFAULTS.directusUrl),
    directusToken: getStringArg(args, "directus-token", DEFAULTS.directusToken),
    directusEmail: getStringArg(args, "directus-email", DEFAULTS.directusEmail),
    directusPassword: getStringArg(args, "directus-password", DEFAULTS.directusPassword),
    expectedArticles: getNumberArg(args, "expected-articles", DEFAULTS.expectedArticles),
    expectedCategories: getNumberArg(args, "expected-categories", DEFAULTS.expectedCategories),
    reportPath: resolveRepoPath(getStringArg(args, "report", DEFAULTS.reportPath))
  };
}

async function main() {
  const options = parseCli();
  const directus = await DirectusClient.create({
    baseUrl: options.directusUrl,
    token: options.directusToken || undefined,
    email: options.directusEmail,
    password: options.directusPassword
  });

  const articleCount = await directus.countByFilter("articles", {
    "filter[old_slug][_starts_with]": "nd"
  });

  const categoryCount = await directus.countByFilter("categories", {
    "filter[_or][0][old_slug][_starts_with]": "col",
    "filter[_or][1][old_slug][_starts_with]": "nr"
  });

  const articleStatuses: Record<string, number> = {};
  const categoryStatuses: Record<string, number> = {};

  for (const status of ["needs_review", "approved", "published", "cleaned"]) {
    articleStatuses[status] = await directus.countByFilter("articles", {
      "filter[old_slug][_starts_with]": "nd",
      "filter[migration_status][_eq]": status
    });

    categoryStatuses[status] = await directus.countByFilter("categories", {
      "filter[_or][0][old_slug][_starts_with]": "col",
      "filter[_or][1][old_slug][_starts_with]": "nr",
      "filter[migration_status][_eq]": status
    });
  }

  const pass = articleCount === options.expectedArticles && categoryCount === options.expectedCategories;

  const report = {
    generated_at: buildTimestamp(),
    expected: {
      articles: options.expectedArticles,
      categories: options.expectedCategories,
      total: options.expectedArticles + options.expectedCategories
    },
    actual: {
      articles: articleCount,
      categories: categoryCount,
      total: articleCount + categoryCount
    },
    article_statuses: articleStatuses,
    category_statuses: categoryStatuses,
    pass
  };

  await writeJsonAtomic(options.reportPath, report);

  console.log(`[validate-import] report=${options.reportPath}`);
  console.log(
    `[validate-import] articles=${articleCount}/${options.expectedArticles} categories=${categoryCount}/${options.expectedCategories}`
  );

  if (!pass) {
    throw new Error("Import consistency validation failed.");
  }
}

main().catch((error) => {
  console.error("[validate-import] fatal:", error);
  process.exit(1);
});
