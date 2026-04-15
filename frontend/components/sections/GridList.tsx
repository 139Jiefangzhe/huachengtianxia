import Link from "next/link";
import type { Article } from "@/types/content";

export function GridList({ articles }: { articles: Article[] }) {
  return (
    <section>
      <h3>网格列表</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
          gap: 12
        }}
      >
        {articles.map((a) => (
          <article key={a.id} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 10 }}>
            <Link href={`/news/${a.slug}`} style={{ fontWeight: 600 }}>
              {a.title}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
