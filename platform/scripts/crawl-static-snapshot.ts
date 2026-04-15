#!/usr/bin/env tsx
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildTimestamp, getNumberArg, getStringArg, parseArgs, resolveRepoPath, sha256 } from "./lib/common.js";

function normalizeRouteToFile(urlPath: string): string {
  const safePath = urlPath.split("?")[0].replace(/\/+$/, "") || "/";
  if (safePath === "/") {
    return "index.html";
  }
  return `${safePath.replace(/^\//, "")}/index.html`;
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = getStringArg(args, "base-url", "http://localhost:8080").replace(/\/$/, "");
  const listArg = getStringArg(args, "url-list", getStringArg(args, "change-list", "reports/migration/changed_urls.txt"));
  const listPath = resolveRepoPath(listArg);
  const outputRoot = resolveRepoPath(getStringArg(args, "output-dir", "reports/static-snapshots"));
  const concurrency = Math.max(1, getNumberArg(args, "concurrency", 5));

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const outputDir = path.join(outputRoot, `v${stamp}`);
  await fs.mkdir(outputDir, { recursive: true });

  const raw = await fs.readFile(listPath, "utf8");
  const routes = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const results: Array<{ route: string; status: number; file: string; checksum: string }> = [];
  let index = 0;

  async function worker() {
    while (true) {
      const current = index;
      index += 1;
      if (current >= routes.length) return;
      const route = routes[current];
      const targetUrl = `${baseUrl}${route}`;

      const res = await fetch(targetUrl, { redirect: "follow" });
      const html = await res.text();
      const fileRel = normalizeRouteToFile(route);
      const abs = path.join(outputDir, fileRel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, html, "utf8");
      results.push({
        route,
        status: res.status,
        file: fileRel,
        checksum: sha256(html)
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const manifest = {
    generated_at: buildTimestamp(),
    base_url: baseUrl,
    output_dir: outputDir,
    total_routes: routes.length,
    results
  };
  await fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  console.log(`[crawl-static-snapshot] output=${outputDir} routes=${routes.length}`);
}

main().catch((error) => {
  console.error("[crawl-static-snapshot] fatal", error);
  process.exit(1);
});
