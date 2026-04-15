export function FallbackLayout({ title = "内容加载中" }: { title?: string }) {
  return (
    <section style={{ border: "1px solid #d8dee9", borderRadius: 10, padding: 16, background: "#fff" }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p style={{ marginBottom: 0, color: "#4c566a" }}>当前栏目配置异常，已自动降级为可读模式。请稍后重试。</p>
    </section>
  );
}
