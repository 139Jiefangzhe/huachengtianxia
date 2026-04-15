import { promises as fs } from "node:fs";
import path from "node:path";
import type { LayoutBlock } from "@/types/layout";

export function isLayoutMockEnabled(): boolean {
  const raw = process.env.ENABLE_LAYOUT_MOCK || process.env.NEXT_PUBLIC_ENABLE_LAYOUT_MOCK || "false";
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export async function loadMockLayoutBySlug(slug: string): Promise<LayoutBlock[] | null> {
  if (!isLayoutMockEnabled()) {
    return null;
  }

  const filePath = path.join(process.cwd(), "mocks", "layouts", `${slug}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as LayoutBlock[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
