export function TeamGrid() {
  return (
    <section>
      <h3>团队信息</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 12 }}>
        {Array.from({ length: 4 }).map((_, idx) => (
          <article key={idx} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
            <strong>成员 {idx + 1}</strong>
            <p style={{ marginBottom: 0, color: "#64748b" }}>信息待运营补录</p>
          </article>
        ))}
      </div>
    </section>
  );
}
