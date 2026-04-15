import type { MetadataRoute } from "next";
import { readItems } from "@/lib/directus-client";
import type { Article, Category, Project } from "@/types/content";

const SITE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:28080").replace(/\/$/, "");

const PUBLIC_FILTERS = {
  "filter[migration_status][_eq]": "published",
  "filter[pipeline_status][_eq]": "imported",
  "filter[is_test_data][_neq]": "true"
} as const;

function toDate(input?: string | null): Date | undefined {
  if (!input) {
    return undefined;
  }
  const ts = Date.parse(input);
  return Number.isFinite(ts) ? new Date(ts) : undefined;
}

function normalizeRoute(pathname: string): string {
  if (!pathname.startsWith("/")) {
    return `/${pathname}`;
  }
  return pathname;
}

function routeToUrl(pathname: string): string {
  return `${SITE_URL}${normalizeRoute(pathname)}`;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [articles, categories, projects] = await Promise.all([
    readItems<Article>("articles", {
      ...PUBLIC_FILTERS,
      fields: "slug,date_updated,publish_date",
      sort: "-publish_date",
      limit: -1
    }),
    readItems<Category>("categories", {
      ...PUBLIC_FILTERS,
      fields: "slug,target_route_override,date_updated",
      sort: "slug",
      limit: -1
    }),
    readItems<Project>("projects", {
      ...PUBLIC_FILTERS,
      fields: "slug,date_updated",
      sort: "slug",
      limit: -1
    })
  ]);

  const entries: MetadataRoute.Sitemap = [];
  const seen = new Set<string>();

  const push = (pathname: string, lastModified?: Date) => {
    const normalized = normalizeRoute(pathname);
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    entries.push({
      url: routeToUrl(normalized),
      lastModified
    });
  };

  push("/");
  push("/transparency");
  push("/about/team");

  for (const row of articles) {
    if (!row.slug) {
      continue;
    }
    push(`/news/${row.slug}`, toDate(row.publish_date || row.date_updated || null));
  }

  for (const row of categories) {
    if (row.target_route_override) {
      push(row.target_route_override, toDate(row.date_updated || null));
      continue;
    }
    if (!row.slug) {
      continue;
    }
    push(`/news/category/${row.slug}`, toDate(row.date_updated || null));
  }

  for (const row of projects) {
    if (!row.slug) {
      continue;
    }
    push(`/projects/${row.slug}`, toDate(row.date_updated || null));
  }

  return entries;
}
