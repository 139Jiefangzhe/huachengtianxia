import { notFound } from "next/navigation";
import { RichTextRenderer } from "@/components/directus/RichTextRenderer";
import { getProjectBySlug } from "@/lib/queries";

export default async function ProjectDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project) {
    notFound();
  }

  return (
    <article style={{ display: "grid", gap: 14 }}>
      <h1 style={{ marginBottom: 0 }}>{project.name}</h1>
      {project.summary ? <p style={{ marginTop: 0 }}>{project.summary}</p> : null}
      <RichTextRenderer html={project.content || ""} quotesById={{}} />
    </article>
  );
}
