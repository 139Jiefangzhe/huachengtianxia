import Link from "next/link";
import type { Category } from "@/types/content";

export function SidebarNav({ categories, currentSlug }: { categories: Category[]; currentSlug?: string }) {
  return (
    <aside style={{ border: "1px solid #d8dee9", borderRadius: 10, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>栏目导航</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {categories.map((c) => {
          const href = c.target_route_override || `/news/category/${c.slug}`;
          const active = c.slug === currentSlug;
          return (
            <li key={c.id}>
              <Link href={href} style={{ color: active ? "#0f766e" : "#1f2937", fontWeight: active ? 700 : 500 }}>
                {c.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
