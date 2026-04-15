import { redirect } from "next/navigation";
import { FallbackLayout } from "@/components/layout/FallbackLayout";
import { LayoutErrorBoundary } from "@/components/layout/LayoutErrorBoundary";
import { DynamicLayoutRenderer } from "@/components/layout/DynamicLayoutRenderer";
import { getCategoryArticles, getCategoryBySlug, getCategoryLayout, getHomePayload, getReports } from "@/lib/queries";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function NewsCategoryPage({ params }: Props) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (category?.target_route_override && category.target_route_override !== `/news/category/${slug}`) {
    redirect(category.target_route_override);
  }

  const [layoutConfig, articles, reports, homePayload] = await Promise.all([
    getCategoryLayout(slug),
    getCategoryArticles(slug, 30),
    getReports(20),
    getHomePayload()
  ]);

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1 style={{ marginBottom: 0 }}>{category?.name || `栏目 ${slug}`}</h1>
      <LayoutErrorBoundary fallback={<FallbackLayout title="栏目渲染降级" />}>
        <DynamicLayoutRenderer
          config={layoutConfig}
          articles={articles}
          categories={homePayload.categories}
          reports={reports}
          currentCategorySlug={slug}
        />
      </LayoutErrorBoundary>
    </section>
  );
}
