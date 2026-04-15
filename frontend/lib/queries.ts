import { readItems, readSingleton } from "@/lib/directus-client";
import { loadMockLayoutBySlug } from "@/lib/layout-mock";
import type { Article, Category, Project, Quote, Report } from "@/types/content";
import type { LayoutBlock } from "@/types/layout";

type HomePayload = {
  articles: Article[];
  projects: Project[];
  categories: Category[];
};

const PUBLISHED_FILTERS = {
  "filter[migration_status][_eq]": "published",
  "filter[pipeline_status][_eq]": "imported",
  "filter[is_test_data][_neq]": "true"
} as const;

export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const rows = await readItems<Article>("articles", {
    ...PUBLISHED_FILTERS,
    "filter[slug][_eq]": slug,
    limit: 1
  });
  return rows[0] || null;
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const rows = await readItems<Project>("projects", {
    ...PUBLISHED_FILTERS,
    "filter[slug][_eq]": slug,
    limit: 1
  });
  return rows[0] || null;
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  const rows = await readItems<Category>("categories", {
    ...PUBLISHED_FILTERS,
    "filter[slug][_eq]": slug,
    limit: 1
  });
  return rows[0] || null;
}

export async function getCategoryLayout(slug: string): Promise<LayoutBlock[]> {
  const mock = await loadMockLayoutBySlug(slug);
  if (mock) {
    return mock;
  }

  const category = await getCategoryBySlug(slug);
  if (!category?.layout_config || !Array.isArray(category.layout_config)) {
    return [{ type: "simple-list", enabled: true, props: {} }];
  }

  return category.layout_config;
}

export async function getCategoryArticles(_slug: string, limit = 20): Promise<Article[]> {
  // Legacy schema currently doesn't guarantee article->category relation for migrated rows.
  // Use latest published articles as safe fallback list for category pages.
  return readItems<Article>("articles", {
    ...PUBLISHED_FILTERS,
    fields: "id,title,slug,publish_date,seo_title,seo_description,content",
    sort: "-publish_date",
    limit
  });
}

export async function getReports(limit = 20): Promise<Report[]> {
  return readItems<Report>("reports", {
    ...PUBLISHED_FILTERS,
    sort: "-year",
    limit
  });
}

export async function getHomePayload(): Promise<HomePayload> {
  const [articles, projects, categories] = await Promise.all([
    readItems<Article>("articles", {
      ...PUBLISHED_FILTERS,
      fields: "id,title,slug,publish_date,seo_description",
      sort: "-publish_date",
      limit: 8
    }),
    readItems<Project>("projects", {
      ...PUBLISHED_FILTERS,
      fields: "id,name,slug,summary",
      limit: 4
    }),
    readItems<Category>("categories", {
      ...PUBLISHED_FILTERS,
      fields: "id,name,slug,target_route_override",
      sort: "name",
      limit: 50
    })
  ]);

  return { articles, projects, categories };
}

export async function getQuotesByIds(ids: number[]): Promise<Record<number, Quote>> {
  if (ids.length === 0) {
    return {};
  }

  const rows = await readItems<Quote>("quotes", {
    "filter[id][_in]": ids.join(","),
    "filter[is_test_data][_neq]": "true",
    limit: ids.length
  });

  const out: Record<number, Quote> = {};
  for (const row of rows) {
    out[row.id] = row;
  }
  return out;
}

export function extractQuoteIds(content: string): number[] {
  const ids = new Set<number>();
  const re = /\[quote:id=(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const id = Number(match[1]);
    if (Number.isFinite(id) && id > 0) {
      ids.add(id);
    }
  }
  return [...ids];
}

export async function getGlobalSettings(): Promise<{ site_title?: string; seo_description?: string } | null> {
  return readSingleton<{ site_title?: string; seo_description?: string }>("global_settings");
}
