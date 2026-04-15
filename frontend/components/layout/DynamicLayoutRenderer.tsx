import { BannerArea } from "@/components/sections/BannerArea";
import { GridList } from "@/components/sections/GridList";
import { ReportTable } from "@/components/sections/ReportTable";
import { SidebarNav } from "@/components/sections/SidebarNav";
import { SimpleList } from "@/components/sections/SimpleList";
import { TeamGrid } from "@/components/sections/TeamGrid";
import { TimelineList } from "@/components/sections/TimelineList";
import type { Article, Category, Report } from "@/types/content";
import type { LayoutBlock } from "@/types/layout";

type RendererProps = {
  config: LayoutBlock[];
  articles: Article[];
  categories: Category[];
  reports: Report[];
  currentCategorySlug?: string;
};

export function DynamicLayoutRenderer({ config, articles, categories, reports, currentCategorySlug }: RendererProps) {
  const safeConfig = Array.isArray(config) && config.length > 0 ? config : [{ type: "simple-list", enabled: true }];

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {safeConfig.map((block, index) => {
        if (block.enabled === false) {
          return null;
        }

        try {
          switch (block.type) {
            case "banner":
              return <BannerArea key={`${block.type}-${index}`} />;
            case "sidebar-nav":
              return <SidebarNav key={`${block.type}-${index}`} categories={categories} currentSlug={currentCategorySlug} />;
            case "timeline-list":
              return <TimelineList key={`${block.type}-${index}`} articles={articles} />;
            case "grid-list":
              return <GridList key={`${block.type}-${index}`} articles={articles} />;
            case "simple-list":
              return <SimpleList key={`${block.type}-${index}`} articles={articles} />;
            case "report-table":
              return <ReportTable key={`${block.type}-${index}`} reports={reports} />;
            case "team-grid":
              return <TeamGrid key={`${block.type}-${index}`} />;
            default:
              return (
                <section key={`${block.type}-${index}`} style={{ border: "1px dashed #94a3b8", borderRadius: 8, padding: 12 }}>
                  <strong>未识别布局模块:</strong> {String(block.type)}
                </section>
              );
          }
        } catch {
          return (
            <section key={`${block.type}-${index}`} style={{ border: "1px solid #fca5a5", borderRadius: 8, padding: 12 }}>
              模块渲染异常，已跳过：{String(block.type)}
            </section>
          );
        }
      })}
    </div>
  );
}
