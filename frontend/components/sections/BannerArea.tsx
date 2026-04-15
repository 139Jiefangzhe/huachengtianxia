export function BannerArea({ title = "栏目横幅" }: { title?: string }) {
  return (
    <section style={{ padding: 20, borderRadius: 12, background: "linear-gradient(120deg,#dbeafe,#dcfce7)", marginBottom: 16 }}>
      <strong>{title}</strong>
    </section>
  );
}
