import { TeamGrid } from "@/components/sections/TeamGrid";

export default function AboutTeamPage() {
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <h1>团队介绍</h1>
      <TeamGrid />
    </section>
  );
}
