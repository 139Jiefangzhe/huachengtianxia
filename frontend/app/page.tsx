import Link from "next/link";
import { getGlobalSettings, getHomePayload } from "@/lib/queries";

export default async function HomePage() {
  const [payload, settings] = await Promise.all([getHomePayload(), getGlobalSettings()]);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section style={{ borderRadius: 12, padding: 18, background: "linear-gradient(120deg,#fef9c3,#bfdbfe)", border: "1px solid #e2e8f0" }}>
        <h1 style={{ marginTop: 0 }}>{settings?.site_title || "华城天下公益基金会"}</h1>
        <p style={{ marginBottom: 0 }}>{settings?.seo_description || "数据驱动的公益内容平台已切换到 Directus + Next.js 架构。"}</p>
      </section>

      <section>
        <h2>最新新闻</h2>
        <ul style={{ paddingLeft: 18 }}>
          {payload.articles.map((item) => (
            <li key={item.id}>
              <Link href={`/news/${item.slug}`}>{item.title}</Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>公益项目</h2>
        <ul style={{ paddingLeft: 18 }}>
          {payload.projects.map((item) => (
            <li key={item.id}>
              <Link href={`/projects/${item.slug}`}>{item.name}</Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
