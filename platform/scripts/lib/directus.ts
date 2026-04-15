import { buildTimestamp } from "./common.js";

export type DirectusClientOptions = {
  baseUrl: string;
  token?: string;
  email?: string;
  password?: string;
};

export type FilterValue = string | number | boolean;

function buildQueryString(params: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.append(key, value);
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

export class DirectusClient {
  readonly baseUrl: string;

  token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token;
  }

  static async create(options: DirectusClientOptions): Promise<DirectusClient> {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    if (options.token) {
      return new DirectusClient(baseUrl, options.token);
    }

    if (!options.email || !options.password) {
      throw new Error("Directus auth requires token or email/password");
    }

    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: options.email, password: options.password })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Directus login failed (${res.status}): ${text}`);
    }

    const json = await res.json();
    const token = json?.data?.access_token;
    if (!token) {
      throw new Error("Directus login returned empty access token");
    }

    return new DirectusClient(baseUrl, token);
  }

  async request<T = unknown>(
    method: string,
    path: string,
    options: { body?: unknown; formData?: FormData; allow404?: boolean } = {}
  ): Promise<T | null> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`
    };

    let body: BodyInit | undefined;
    if (options.formData) {
      body = options.formData;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const response = await fetch(url, {
      method,
      headers,
      body
    });

    if (options.allow404 && response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
    }

    if (response.status === 204) {
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }

    return null;
  }

  async findByField(collection: string, field: string, value: FilterValue): Promise<any | null> {
    const q = buildQueryString({
      [`filter[${field}][_eq]`]: String(value),
      limit: "1"
    });

    const result = (await this.request<any>("GET", `/items/${collection}${q}`)) || { data: [] };
    if (Array.isArray(result.data) && result.data.length > 0) {
      return result.data[0];
    }
    return null;
  }

  async upsertByField(collection: string, field: string, value: FilterValue, payload: Record<string, unknown>) {
    const debugUpsert = process.env.DEBUG_DIRECTUS_UPSERT === "1";
    const existing = await this.findByField(collection, field, value);
    if (debugUpsert) {
      console.log(
        `[directus.upsert] preflight collection=${collection} field=${field} value=${String(value)} existing_id=${
          existing?.id ?? "none"
        }`
      );
    }
    if (existing?.id) {
      const updated = await this.request<any>("PATCH", `/items/${collection}/${existing.id}`, { body: payload });
      return { mode: "update" as const, item: updated?.data ?? existing, existing };
    }

    try {
      const created = await this.request<any>("POST", `/items/${collection}`, {
        body: {
          ...payload,
          [field]: value
        }
      });
      return { mode: "create" as const, item: created?.data, existing: null };
    } catch (error) {
      const message = String((error as Error)?.message || error);
      const isUniqueConflict = message.includes("RECORD_NOT_UNIQUE") || message.includes("has to be unique");
      if (!isUniqueConflict) {
        throw error;
      }

      // Idempotency fallback:
      // Another run (or a previous partial run) may already have created this key.
      const conflicted = await this.findByField(collection, field, value);
      if (debugUpsert) {
        console.log(
          `[directus.upsert] unique-conflict collection=${collection} field=${field} value=${String(
            value
          )} conflicted_id=${conflicted?.id ?? "none"}`
        );
      }
      if (!conflicted?.id) {
        throw error;
      }

      const updated = await this.request<any>("PATCH", `/items/${collection}/${conflicted.id}`, { body: payload });
      return { mode: "update" as const, item: updated?.data ?? conflicted, existing: conflicted };
    }
  }

  async createItem(collection: string, payload: Record<string, unknown>) {
    const created = await this.request<any>("POST", `/items/${collection}`, { body: payload });
    return created?.data;
  }

  async updateItem(collection: string, id: string | number, payload: Record<string, unknown>) {
    const updated = await this.request<any>("PATCH", `/items/${collection}/${id}`, { body: payload });
    return updated?.data;
  }

  async deleteItem(collection: string, id: string | number): Promise<void> {
    await this.request("DELETE", `/items/${collection}/${id}`);
  }

  async getItemById(collection: string, id: string | number, fields: string[] = ["*"]): Promise<any | null> {
    const q = buildQueryString({
      fields: fields.join(",")
    });
    const result = await this.request<any>("GET", `/items/${collection}/${id}${q}`, { allow404: true });
    return result?.data ?? null;
  }

  async listItems(
    collection: string,
    options: {
      filter?: Record<string, string>;
      fields?: string[];
      sort?: string[];
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<any[]> {
    const query: Record<string, string> = {
      limit: String(options.limit ?? -1)
    };

    if (options.offset !== undefined) {
      query.offset = String(options.offset);
    }

    if (options.fields && options.fields.length > 0) {
      query.fields = options.fields.join(",");
    }

    if (options.sort && options.sort.length > 0) {
      query.sort = options.sort.join(",");
    }

    if (options.filter) {
      for (const [key, value] of Object.entries(options.filter)) {
        query[`filter[${key}]`] = value;
      }
    }

    const q = buildQueryString(query);
    const result = await this.request<any>("GET", `/items/${collection}${q}`);
    return Array.isArray(result?.data) ? result.data : [];
  }

  async logAudit(collection: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.createItem(collection, {
        ...payload,
        timestamp: buildTimestamp()
      });
    } catch (error) {
      // Audit writes are best-effort; do not stop migration on logging failure.
      console.error(`[audit] ${collection} write failed:`, error);
    }
  }

  async uploadFile(options: {
    fileName: string;
    mimeType: string;
    data: Buffer;
    title?: string;
    folder?: string;
    description?: string;
  }): Promise<any> {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(options.data)], { type: options.mimeType || "application/octet-stream" });
    form.append("file", blob, options.fileName);

    if (options.title) {
      form.append("title", options.title);
    }
    if (options.folder) {
      form.append("folder", options.folder);
    }
    if (options.description) {
      form.append("description", options.description);
    }

    const result = await this.request<any>("POST", "/files", { formData: form });
    return result?.data;
  }

  async countByFilter(collection: string, filterParams: Record<string, string>): Promise<number> {
    const q = buildQueryString({
      ...filterParams,
      "aggregate[count]": "*",
      limit: "1"
    });

    const result = await this.request<any>("GET", `/items/${collection}${q}`);
    const maybeCount = Number(result?.data?.[0]?.count ?? result?.meta?.filter_count ?? 0);
    return Number.isFinite(maybeCount) ? maybeCount : 0;
  }
}
