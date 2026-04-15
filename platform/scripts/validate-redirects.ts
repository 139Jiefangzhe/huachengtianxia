#!/usr/bin/env tsx
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildTimestamp,
  getBooleanArg,
  getNumberArg,
  getStringArg,
  parseArgs,
  resolveRepoPath,
  writeJsonAtomic
} from "./lib/common.js";
import { DirectusClient } from "./lib/directus.js";

type Options = {
  mapPath: string;
  expectedTotal: number;
  sampleSize: number;
  baseUrl: string;
  reportPath: string;
  writeAudit: boolean;
  directusUrl: string;
  directusToken: string;
  directusEmail: string;
  directusPassword: string;
};

type Entry = {
  old_url: string;
  target_url: string;
};

const DEFAULTS: Options = {
  mapPath: "platform/nginx/conf.d/redirects/legacy.map",
  expectedTotal: 664,
  sampleSize: 20,
  baseUrl: "http://localhost:28080",
  reportPath: "reports/migration/redirect-validate-report.json",
  writeAudit: false,
  directusUrl: process.env.DIRECTUS_URL || process.env.DIRECTUS_PUBLIC_URL || "http://localhost:8055",
  directusToken: process.env.DIRECTUS_TOKEN || "",
  directusEmail: process.env.DIRECTUS_ADMIN_EMAIL || "admin@example.com",
  directusPassword: process.env.DIRECTUS_ADMIN_PASSWORD || "ChangeMe_123456"
};

function parseCli(): Options {
  const args = parseArgs(process.argv);
  return {
    ...DEFAULTS,
    mapPath: resolveRepoPath(getStringArg(args, "map", DEFAULTS.mapPath)),
    expectedTotal: getNumberArg(args, "expected-total", DEFAULTS.expectedTotal),
    sampleSize: getNumberArg(args, "sample-size", DEFAULTS.sampleSize),
    baseUrl: getStringArg(args, "base-url", DEFAULTS.baseUrl),
    reportPath: resolveRepoPath(getStringArg(args, "report", DEFAULTS.reportPath)),
    writeAudit: getBooleanArg(args, "write-audit", DEFAULTS.writeAudit),
    directusUrl: getStringArg(args, "directus-url", DEFAULTS.directusUrl),
    directusToken: getStringArg(args, "directus-token", DEFAULTS.directusToken),
    directusEmail: getStringArg(args, "directus-email", DEFAULTS.directusEmail),
    directusPassword: getStringArg(args, "directus-password", DEFAULTS.directusPassword)
  };
}

function parseMap(content: string): Entry[] {
  const entries: Entry[] = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("map ") || trimmed === "}" || trimmed.startsWith("default")) {
      continue;
    }

    const match = trimmed.match(/^(\/[^\s]+)\s+([^;]+);$/);
    if (!match) {
      continue;
    }

    entries.push({
      old_url: match[1],
      target_url: match[2]
    });
  }
  return entries;
}

function pickSamples(entries: Entry[], sampleSize: number): Entry[] {
  if (sampleSize <= 0) {
    return [];
  }

  if (entries.length <= sampleSize) {
    return entries;
  }

  const out: Entry[] = [];
  const step = Math.max(1, Math.floor(entries.length / sampleSize));
  for (let i = 0; i < entries.length && out.length < sampleSize; i += step) {
    out.push(entries[i]);
  }

  return out.slice(0, sampleSize);
}

async function main() {
  const options = parseCli();
  const raw = await fs.readFile(options.mapPath, "utf8");
  const entries = parseMap(raw);

  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const entry of entries) {
    if (seen.has(entry.old_url)) {
      duplicates.push(entry.old_url);
    }
    seen.add(entry.old_url);
  }

  const coverageOk = entries.length === options.expectedTotal;
  const duplicateOk = duplicates.length === 0;

  const sampleEntries = pickSamples(entries, options.sampleSize);
  const samples: Array<{
    old_url: string;
    expected_target: string;
    status_code: number;
    location: string;
    pass: boolean;
    error?: string;
  }> = [];

  let directus: DirectusClient | null = null;
  if (options.writeAudit) {
    directus = await DirectusClient.create({
      baseUrl: options.directusUrl,
      token: options.directusToken || undefined,
      email: options.directusEmail,
      password: options.directusPassword
    });
  }

  for (const sample of sampleEntries) {
    try {
      const url = `${options.baseUrl.replace(/\/$/, "")}${sample.old_url}`;
      const response = await fetch(url, { redirect: "manual" });
      const statusCode = response.status;
      const location = response.headers.get("location") || "";
      const pass = statusCode === 301 && location.endsWith(sample.target_url);

      samples.push({
        old_url: sample.old_url,
        expected_target: sample.target_url,
        status_code: statusCode,
        location,
        pass
      });

      if (directus) {
        await directus.logAudit("redirect_audit", {
          old_url: sample.old_url,
          target_url: sample.target_url,
          http_code: statusCode,
          status: pass ? "pass" : "fail",
          notes: `location=${location}`
        });
      }
    } catch (error) {
      const message = String((error as Error)?.message || error);
      samples.push({
        old_url: sample.old_url,
        expected_target: sample.target_url,
        status_code: 0,
        location: "",
        pass: false,
        error: message
      });

      if (directus) {
        await directus.logAudit("redirect_audit", {
          old_url: sample.old_url,
          target_url: sample.target_url,
          http_code: 0,
          status: "error",
          notes: message
        });
      }
    }
  }

  const samplePassRate = samples.length > 0 ? samples.filter((s) => s.pass).length / samples.length : 1;
  const pass = coverageOk && duplicateOk && samplePassRate === 1;

  const report = {
    generated_at: buildTimestamp(),
    map_path: options.mapPath,
    expected_total: options.expectedTotal,
    actual_total: entries.length,
    coverage_ok: coverageOk,
    duplicate_ok: duplicateOk,
    duplicates,
    sample_size: sampleEntries.length,
    sample_pass_rate: Number(samplePassRate.toFixed(6)),
    pass,
    samples
  };

  await writeJsonAtomic(options.reportPath, report);

  console.log(`[validate-redirects] report=${options.reportPath}`);
  console.log(`[validate-redirects] coverage=${entries.length}/${options.expectedTotal} sample_pass_rate=${samplePassRate.toFixed(2)}`);

  if (!pass) {
    throw new Error("Redirect validation failed. See report for details.");
  }
}

main().catch((error) => {
  console.error("[validate-redirects] fatal:", error);
  process.exit(1);
});
