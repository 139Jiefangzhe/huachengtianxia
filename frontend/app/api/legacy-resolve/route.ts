import { NextRequest, NextResponse } from "next/server";
import { readItems } from "@/lib/directus-client";
import type { Article, Category } from "@/types/content";

const PUBLIC_FILTERS = {
  "filter[migration_status][_eq]": "published",
  "filter[pipeline_status][_eq]": "imported",
  "filter[is_test_data][_neq]": "true"
} as const;

type LegacyType = "nd" | "col" | "nr" | "unknown";

function inferLegacyType(oldSlug: string): LegacyType {
  if (/^nd[0-9a-z-]+$/i.test(oldSlug)) {
    return "nd";
  }
  if (/^col[0-9a-z-]+$/i.test(oldSlug)) {
    return "col";
  }
  if (/^nr[0-9a-z-]*$/i.test(oldSlug)) {
    return "nr";
  }
  return "unknown";
}

function toInternalPath(input: string): string {
  if (!input) {
    return "/";
  }
  if (input.startsWith("http://") || input.startsWith("https://")) {
    try {
      return new URL(input).pathname || "/";
    } catch {
      return "/";
    }
  }
  return input.startsWith("/") ? input : `/${input}`;
}

function extractOldSlug(pathValue: string): string {
  const raw = pathValue.trim();
  if (!raw) {
    return "";
  }

  const noQuery = raw.split("?")[0] || "";
  const base = noQuery.replace(/^\/+/, "").replace(/\.html$/i, "");
  return base;
}

async function resolveArticle(oldSlug: string): Promise<string | null> {
  const rows = await readItems<Article>("articles", {
    ...PUBLIC_FILTERS,
    "filter[old_slug][_eq]": oldSlug,
    fields: "slug",
    limit: 1
  });
  const item = rows[0];
  if (!item?.slug) {
    return null;
  }
  return `/news/${item.slug}`;
}

async function resolveCategory(oldSlug: string): Promise<string | null> {
  const rows = await readItems<Category>("categories", {
    ...PUBLIC_FILTERS,
    "filter[old_slug][_eq]": oldSlug,
    fields: "slug,target_route_override",
    limit: 1
  });
  const item = rows[0];
  if (!item) {
    return null;
  }
  if (item.target_route_override) {
    return toInternalPath(item.target_route_override);
  }
  if (!item.slug) {
    return null;
  }
  return `/news/category/${item.slug}`;
}

export async function GET(request: NextRequest) {
  const pathParam = request.nextUrl.searchParams.get("path") || request.nextUrl.searchParams.get("slug") || "";
  const oldSlug = extractOldSlug(pathParam);

  if (!oldSlug) {
    return NextResponse.json(
      {
        error: "bad_request",
        message: "Provide query param path=/ndxxxx.html"
      },
      { status: 400 }
    );
  }

  const legacyType = inferLegacyType(oldSlug);
  let targetPath: string | null = null;

  if (legacyType === "nd") {
    targetPath = await resolveArticle(oldSlug);
  } else if (legacyType === "col" || legacyType === "nr") {
    targetPath = await resolveCategory(oldSlug);
  } else {
    targetPath = (await resolveArticle(oldSlug)) || (await resolveCategory(oldSlug));
  }

  if (!targetPath) {
    return NextResponse.json(
      {
        error: "not_found",
        old_slug: oldSlug
      },
      { status: 404 }
    );
  }

  return new NextResponse(null, {
    status: 301,
    headers: {
      Location: targetPath
    }
  });
}
