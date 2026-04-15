#!/usr/bin/env node
/*
 Stage-1 migration entrypoint
 - supports dry-run and import modes
 - outputs migration report json
 - can optionally write migration_audit records to Directus
*/

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const QUOTE_PATTERNS = [
  { label: "欧阳修", regex: /欧阳修/g },
  { label: "高尔基", regex: /高尔基/g },
  { label: "莎士比亚", regex: /莎士比亚/g }
];

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
      continue;
    }

    args.set(key, next);
    i += 1;
  }
  return args;
}

async function walkHtmlFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkHtmlFiles(abs)));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      files.push(abs);
    }
  }

  return files;
}

function stripInlineStyles(html) {
  return html.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, "");
}

function wrapTableResponsive(html) {
  return html
    .replace(/<table\b/gi, '<div class="overflow-x-auto"><table')
    .replace(/<\/table>/gi, "</table></div>");
}

function collectQuoteHits(html) {
  const hits = [];
  for (const rule of QUOTE_PATTERNS) {
    if (rule.regex.test(html)) {
      hits.push(rule.label);
    }
  }
  return [...new Set(hits)];
}

async function pushAuditToDirectus(result) {
  const directusUrl = process.env.DIRECTUS_URL;
  const token = process.env.DIRECTUS_TOKEN;

  if (!directusUrl || !token) {
    return;
  }

  const payload = {
    source_path: result.filePath,
    status: result.status,
    error: result.errors.join("; "),
    checksum: result.checksum
  };

  const res = await fetch(`${directusUrl.replace(/\/$/, "")}/items/migration_audit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Directus audit write failed (${res.status}): ${text}`);
  }
}

async function run() {
  const args = parseArgs(process.argv);
  const mode = args.get("import") ? "import" : "dry-run";
  const inputDir = String(args.get("input") || "mirror/hctxf_full/hctxf.org");
  const reportPath = String(args.get("report") || "reports/migration/migration_report.json");

  const htmlFiles = await walkHtmlFiles(inputDir);
  const results = [];

  for (const filePath of htmlFiles) {
    const raw = await fs.readFile(filePath, "utf8");

    const cleaned = wrapTableResponsive(stripInlineStyles(raw));
    const hasInlineStyle = /\sstyle\s*=\s*("[^"]*"|'[^']*')/i.test(raw);
    const hasExternalAsset = /(https?:)?\/\/[a-z0-9.-]+\//i.test(raw);
    const tableCount = (raw.match(/<table\b/gi) || []).length;
    const quoteHits = collectQuoteHits(raw);

    const errors = [];
    let status = "cleaned";

    if (hasExternalAsset) {
      status = "needs_review";
    }
    if (tableCount > 8) {
      status = "needs_review";
      errors.push("High table density; verify mobile rendering");
    }
    if (raw.length < 100) {
      status = "needs_review";
      errors.push("Suspiciously short content");
    }

    const oldSlug = path.basename(filePath, ".html");
    const checksum = createHash("sha256").update(cleaned).digest("hex");

    const result = {
      filePath,
      oldSlug,
      hasInlineStyle,
      hasExternalAsset,
      tableCount,
      quoteHits,
      status,
      errors,
      checksum
    };

    results.push(result);

    if (mode === "import") {
      await pushAuditToDirectus(result);
    }
  }

  const report = {
    mode,
    generatedAt: new Date().toISOString(),
    inputDir,
    fileCount: results.length,
    successCount: results.filter((item) => item.status === "cleaned").length,
    reviewCount: results.filter((item) => item.status === "needs_review").length,
    failureCount: results.filter((item) => item.errors.length > 0).length,
    results
  };

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`Migration ${mode} completed. Report: ${reportPath}`);
  console.log(`Files: ${report.fileCount}, cleaned: ${report.successCount}, needs_review: ${report.reviewCount}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
