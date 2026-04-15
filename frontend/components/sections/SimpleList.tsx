import Link from "next/link";
import type { Article } from "@/types/content";

export function SimpleList({ articles }: { articles: Article[] }) {
  return (
    <section>
      <h3>内容列表</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {articles.map((a) => (
          <li key={a.id}>
            <Link href={`/news/${a.slug}`}>{a.title}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
