import Link from "next/link";
import type { Article } from "@/types/content";

export function TimelineList({ articles }: { articles: Article[] }) {
  return (
    <section>
      <h3>时间轴</h3>
      <ol style={{ borderLeft: "2px solid #cbd5e1", paddingLeft: 18, margin: 0 }}>
        {articles.map((a) => (
          <li key={a.id} style={{ marginBottom: 12 }}>
            <div style={{ color: "#64748b", fontSize: 12 }}>{a.publish_date || "未标注日期"}</div>
            <Link href={`/news/${a.slug}`}>{a.title}</Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
