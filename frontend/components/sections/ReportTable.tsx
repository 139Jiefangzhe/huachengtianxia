import type { Report } from "@/types/content";

export function ReportTable({ reports }: { reports: Report[] }) {
  return (
    <section style={{ overflowX: "auto" }}>
      <h3>财务报告</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #cbd5e1", padding: 8 }}>年份</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #cbd5e1", padding: 8 }}>标题</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id}>
              <td style={{ borderBottom: "1px solid #e2e8f0", padding: 8 }}>{r.year || "-"}</td>
              <td style={{ borderBottom: "1px solid #e2e8f0", padding: 8 }}>{r.title}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
