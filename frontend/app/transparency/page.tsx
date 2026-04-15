import Link from "next/link";
import { getReports } from "@/lib/queries";

export default async function TransparencyPage() {
  const reports = await getReports(50);

  return (
    <section style={{ display: "grid", gap: 12 }}>
      <h1>财务公示</h1>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #cbd5e1", padding: 8 }}>年份</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #cbd5e1", padding: 8 }}>标题</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #cbd5e1", padding: 8 }}>PDF</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id}>
                <td style={{ borderBottom: "1px solid #e2e8f0", padding: 8 }}>{r.year || "-"}</td>
                <td style={{ borderBottom: "1px solid #e2e8f0", padding: 8 }}>{r.title}</td>
                <td style={{ borderBottom: "1px solid #e2e8f0", padding: 8 }}>
                  {r.pdf_file ? <Link href={`/directus/assets/${r.pdf_file}`}>查看</Link> : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
