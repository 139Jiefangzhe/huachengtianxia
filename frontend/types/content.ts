import type { LayoutBlock } from "./layout";

export type BaseRecord = {
  id: number;
  old_slug?: string | null;
  migration_status?: string | null;
  pipeline_status?: string | null;
  is_test_data?: boolean | null;
  date_updated?: string | null;
};

export type Article = BaseRecord & {
  title: string;
  slug: string;
  content?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_keywords?: string | null;
  legacy_url?: string | null;
  publish_date?: string | null;
};

export type Category = BaseRecord & {
  name: string;
  slug: string;
  description?: string | null;
  layout_config?: LayoutBlock[] | null;
  target_route_override?: string | null;
};

export type Project = BaseRecord & {
  name: string;
  slug: string;
  summary?: string | null;
  content?: string | null;
};

export type Report = BaseRecord & {
  title: string;
  year?: number | null;
  summary_text?: string | null;
  pdf_file?: string | null;
};

export type Quote = {
  id: number;
  content: string;
  author?: string | null;
  confidence?: "high" | "medium" | "low" | string | null;
};
