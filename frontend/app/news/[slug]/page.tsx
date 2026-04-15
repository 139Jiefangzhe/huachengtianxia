import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RichTextRenderer } from "@/components/directus/RichTextRenderer";
import { extractQuoteIds, getArticleBySlug, getQuotesByIds } from "@/lib/queries";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) {
    return { title: "内容不存在" };
  }
  return {
    title: article.seo_title || article.title,
    description: article.seo_description || undefined,
    keywords: article.seo_keywords || undefined,
    alternates: {
      canonical: `/news/${article.slug}`
    }
  };
}

export default async function NewsDetailPage({ params }: Props) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) {
    notFound();
  }

  const content = article.content || "";
  const quoteIds = extractQuoteIds(content);
  const quotesById = await getQuotesByIds(quoteIds);

  return (
    <article style={{ display: "grid", gap: 14 }}>
      <header>
        <h1 style={{ marginBottom: 6 }}>{article.title}</h1>
        <div style={{ color: "#64748b", fontSize: 13 }}>{article.publish_date || "未标注发布日期"}</div>
      </header>
      <RichTextRenderer html={content} quotesById={quotesById} />
    </article>
  );
}
