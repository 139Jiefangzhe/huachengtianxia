import Link from "next/link";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, fontFamily: "\"Noto Sans SC\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif", background: "#f8fafc", color: "#111827" }}>
        <header style={{ borderBottom: "1px solid #e5e7eb", background: "#ffffff" }}>
          <div style={{ maxWidth: 1080, margin: "0 auto", padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <strong>HCTXF</strong>
            <nav style={{ display: "flex", gap: 14 }}>
              <Link href="/">首页</Link>
              <Link href="/news/category/foundation-news">新闻</Link>
              <Link href="/transparency">财务公示</Link>
              <Link href="/about/team">团队</Link>
            </nav>
          </div>
        </header>
        <main style={{ maxWidth: 1080, margin: "0 auto", padding: "20px 18px 40px" }}>{children}</main>
        <footer style={{ borderTop: "1px solid #e5e7eb", background: "#fff", padding: "14px 18px", color: "#64748b" }}>
          <div style={{ maxWidth: 1080, margin: "0 auto" }}>Huacheng Tianxia Foundation</div>
        </footer>
      </body>
    </html>
  );
}
