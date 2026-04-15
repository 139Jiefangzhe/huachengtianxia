const DEFAULT_DIRECTUS_URL = "http://localhost:28055";

export function getDirectusBaseUrl(): string {
  const raw = process.env.DIRECTUS_URL || process.env.NEXT_PUBLIC_DIRECTUS_URL || DEFAULT_DIRECTUS_URL;
  return raw.replace(/\/$/, "");
}

function getDirectusToken(): string {
  return process.env.DIRECTUS_TOKEN || process.env.NEXT_PUBLIC_DIRECTUS_TOKEN || "";
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    search.append(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : "";
}

export async function readItems<T>(
  collection: string,
  params: Record<string, string | number | undefined>
): Promise<T[]> {
  const url = `${getDirectusBaseUrl()}/items/${collection}${buildQuery(params)}`;
  const token = getDirectusToken();
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      next: { revalidate: 60 }
    });

    if (!res.ok) {
      // Keep frontend online even when Directus permissions/data are incomplete during migration.
      // eslint-disable-next-line no-console
      console.warn(`[directus-client] ${collection} read failed: ${res.status}`);
      return [];
    }

    const json = (await res.json()) as { data?: T[] };
    return Array.isArray(json.data) ? json.data : [];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[directus-client] ${collection} read exception`, error);
    return [];
  }
}

export async function readSingleton<T>(collection: string): Promise<T | null> {
  const rows = await readItems<T>(collection, { limit: 1 });
  return rows[0] || null;
}
