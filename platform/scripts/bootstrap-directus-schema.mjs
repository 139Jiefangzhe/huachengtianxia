#!/usr/bin/env node

import process from "node:process";

const BASE_COLLECTIONS = [
  {
    collection: "articles",
    icon: "article",
    note: "HCTXF articles (stage-2 baseline)"
  },
  {
    collection: "projects",
    icon: "volunteer_activism",
    note: "HCTXF projects (stage-2 baseline)"
  },
  {
    collection: "categories",
    icon: "category",
    note: "HCTXF categories (stage-2 baseline)"
  },
  {
    collection: "reports",
    icon: "description",
    note: "HCTXF reports (stage-2 baseline)"
  },
  {
    collection: "quotes",
    icon: "format_quote",
    note: "Structured quote extraction results"
  },
  {
    collection: "global_settings",
    icon: "settings",
    note: "Global singleton settings for frontend runtime",
    singleton: true
  },
  {
    collection: "category_layout_history",
    icon: "history",
    note: "Layout config version snapshots for rollback"
  }
];

const AUDIT_COLLECTIONS = [
  {
    collection: "migration_audit",
    icon: "history",
    note: "Migration dry-run/import audit records"
  },
  {
    collection: "redirect_audit",
    icon: "link",
    note: "Legacy redirect verification audit records"
  }
];

const MIGRATION_STATUS_CHOICES = [
  { text: "draft_raw", value: "draft_raw" },
  { text: "cleaned", value: "cleaned" },
  { text: "needs_review", value: "needs_review" },
  { text: "approved", value: "approved" },
  { text: "published", value: "published" }
];

const PIPELINE_STATUS_CHOICES = [
  { text: "pending", value: "pending" },
  { text: "importing", value: "importing" },
  { text: "imported", value: "imported" },
  { text: "failed", value: "failed" },
  { text: "archived", value: "archived" }
];

const COMMON_LEGACY_FIELDS = [
  {
    field: "old_slug",
    type: "string",
    schema: { max_length: 255, is_nullable: true, is_unique: true },
    meta: { note: "Legacy short slug, e.g. nd004c", interface: "input" }
  },
  {
    field: "legacy_url",
    type: "string",
    schema: { max_length: 1024, is_nullable: true },
    meta: { note: "Original legacy URL", interface: "input" }
  },
  {
    field: "raw_html_backup",
    type: "text",
    schema: { is_nullable: true },
    meta: { note: "Original HTML snapshot before cleaning", interface: "input-multiline" }
  },
  {
    field: "content_clean",
    type: "text",
    schema: { is_nullable: true },
    meta: { note: "Sanitized HTML content", interface: "input-multiline" }
  },
  {
    field: "migration_status",
    type: "string",
    schema: { max_length: 64, is_nullable: true, default_value: "draft_raw" },
    meta: {
      note: "draft_raw/cleaned/needs_review/approved/published",
      interface: "select-dropdown",
      options: {
        choices: MIGRATION_STATUS_CHOICES,
        allowNone: true
      }
    }
  },
  {
    field: "migration_errors",
    type: "json",
    schema: { is_nullable: true },
    meta: { note: "Migration diagnostics and warnings", interface: "input-code", options: { language: "json" } }
  }
];

const PIPELINE_RUNTIME_FIELDS = [
  {
    field: "pipeline_status",
    type: "string",
    schema: { max_length: 64, is_nullable: true, default_value: "pending" },
    meta: {
      note: "pending/importing/imported/failed/archived",
      interface: "select-dropdown",
      options: { choices: PIPELINE_STATUS_CHOICES, allowNone: true }
    }
  },
  {
    field: "pipeline_attempts",
    type: "integer",
    schema: { is_nullable: true, default_value: 0 },
    meta: { note: "How many import retries were attempted", interface: "input" }
  },
  {
    field: "pipeline_started_at",
    type: "dateTime",
    schema: { is_nullable: true },
    meta: { note: "Import run start timestamp", interface: "datetime" }
  },
  {
    field: "pipeline_finished_at",
    type: "dateTime",
    schema: { is_nullable: true },
    meta: { note: "Import run finish timestamp", interface: "datetime" }
  },
  {
    field: "last_pipeline_error",
    type: "text",
    schema: { is_nullable: true },
    meta: { note: "Last pipeline error message", interface: "input-multiline" }
  },
  {
    field: "quarantine_reason",
    type: "string",
    schema: { max_length: 255, is_nullable: true },
    meta: { note: "Reason why record was archived/quarantined", interface: "input" }
  }
];

const TEST_DATA_FLAG_FIELD = {
  field: "is_test_data",
  type: "boolean",
  schema: { is_nullable: true, default_value: false },
  meta: {
    note: "Marks canary/synthetic records that must stay outside public SEO surface",
    interface: "boolean"
  }
};

const CATEGORY_EXTRA_FIELDS = [
  {
    field: "layout_config",
    type: "json",
    schema: { is_nullable: true },
    meta: { note: "Dynamic layout engine JSON config", interface: "input-code", options: { language: "json" } }
  },
  {
    field: "target_route_override",
    type: "string",
    schema: { max_length: 1024, is_nullable: true },
    meta: { note: "Optional SEO redirect target override route", interface: "input" }
  },
  {
    field: "layout_config_version",
    type: "integer",
    schema: { is_nullable: true, default_value: 1 },
    meta: { note: "Monotonic version for layout_config snapshots", interface: "input" }
  }
];

const SEO_FIELDS = [
  {
    field: "seo_title",
    type: "string",
    schema: { max_length: 512, is_nullable: true },
    meta: { note: "SEO title inherited/migrated from legacy", interface: "input" }
  },
  {
    field: "seo_description",
    type: "text",
    schema: { is_nullable: true },
    meta: { note: "SEO description inherited/migrated from legacy", interface: "input-multiline" }
  },
  {
    field: "seo_keywords",
    type: "text",
    schema: { is_nullable: true },
    meta: { note: "SEO keywords inherited/migrated from legacy", interface: "input-multiline" }
  }
];

const ARTICLE_STAGE2_FIELDS = [
  {
    field: "title",
    type: "string",
    schema: { max_length: 512, is_nullable: true },
    meta: { note: "Article title", interface: "input" }
  },
  {
    field: "slug",
    type: "string",
    schema: { max_length: 255, is_nullable: true, is_unique: true },
    meta: { note: "Semantic URL slug", interface: "input" }
  },
  {
    field: "publish_date",
    type: "dateTime",
    schema: { is_nullable: true },
    meta: { note: "Legacy publish datetime", interface: "datetime" }
  },
  {
    field: "content",
    type: "text",
    schema: { is_nullable: true },
    meta: { note: "Sanitized rich content", interface: "input-rich-text-html" }
  }
];

const CATEGORY_STAGE2_FIELDS = [
  {
    field: "name",
    type: "string",
    schema: { max_length: 255, is_nullable: true },
    meta: { note: "Category display name", interface: "input" }
  },
  {
    field: "slug",
    type: "string",
    schema: { max_length: 255, is_nullable: true, is_unique: true },
    meta: { note: "Category semantic slug", interface: "input" }
  },
  {
    field: "description",
    type: "text",
    schema: { is_nullable: true },
    meta: { note: "Category description", interface: "input-multiline" }
  }
];

const PROJECT_STAGE2_FIELDS = [
  {
    field: "name",
    type: "string",
    schema: { max_length: 255, is_nullable: true },
    meta: { note: "Project name", interface: "input" }
  },
  {
    field: "slug",
    type: "string",
    schema: { max_length: 255, is_nullable: true, is_unique: true },
    meta: { note: "Project semantic slug", interface: "input" }
  },
  {
    field: "summary",
    type: "text",
    schema: { is_nullable: true },
    meta: { note: "Project summary", interface: "input-multiline" }
  },
  {
    field: "content",
    type: "text",
    schema: { is_nullable: true },
    meta: { note: "Project rich text content", interface: "input-rich-text-html" }
  }
];

const REPORT_STAGE2_FIELDS = [
  {
    field: "title",
    type: "string",
    schema: { max_length: 512, is_nullable: true },
    meta: { note: "Report title", interface: "input" }
  },
  {
    field: "year",
    type: "integer",
    schema: { is_nullable: true },
    meta: { note: "Report year", interface: "input" }
  },
  {
    field: "summary_text",
    type: "text",
    schema: { is_nullable: true },
    meta: { note: "Report summary", interface: "input-multiline" }
  },
  {
    field: "pdf_file",
    type: "string",
    schema: { max_length: 255, is_nullable: true },
    meta: { note: "Directus file id for PDF", interface: "input" }
  }
];

const QUOTE_FIELDS = [
  {
    field: "content",
    type: "text",
    schema: { is_nullable: true },
    meta: { note: "Quote content body", interface: "input-multiline" }
  },
  {
    field: "author",
    type: "string",
    schema: { max_length: 255, is_nullable: true },
    meta: { note: "Quote author", interface: "input" }
  },
  {
    field: "source_book",
    type: "string",
    schema: { max_length: 255, is_nullable: true },
    meta: { note: "Quote source/book", interface: "input" }
  },
  {
    field: "confidence",
    type: "string",
    schema: { max_length: 16, is_nullable: true },
    meta: { note: "high/medium/low", interface: "select-dropdown" }
  },
  {
    field: "review_status",
    type: "string",
    schema: { max_length: 64, is_nullable: true, default_value: "needs_review" },
    meta: { note: "needs_review/approved/rejected", interface: "select-dropdown" }
  },
  {
    field: "display_order",
    type: "integer",
    schema: { is_nullable: true, default_value: 0 },
    meta: { note: "Sort order in article rendering", interface: "input" }
  },
  {
    field: "article_old_slug",
    type: "string",
    schema: { max_length: 255, is_nullable: true },
    meta: { note: "Associated article old_slug", interface: "input" }
  },
  {
    field: "quote_key",
    type: "string",
    schema: { max_length: 64, is_nullable: true, is_unique: true },
    meta: { note: "Idempotency key for quote upsert", interface: "input" }
  }
];

const MIGRATION_AUDIT_FIELDS = [
  {
    field: "source_path",
    type: "text",
    schema: { is_nullable: true },
    meta: { note: "Source file path", interface: "input-multiline" }
  },
  {
    field: "status",
    type: "string",
    schema: { max_length: 64, is_nullable: true },
    meta: { note: "Pipeline status", interface: "input" }
  },
  {
    field: "error",
    type: "text",
    schema: { is_nullable: true },
    meta: { note: "Error details", interface: "input-multiline" }
  },
  {
    field: "checksum",
    type: "string",
    schema: { max_length: 128, is_nullable: true },
    meta: { note: "Content checksum", interface: "input" }
  },
  {
    field: "payload",
    type: "json",
    schema: { is_nullable: true },
    meta: { note: "Optional raw payload", interface: "input-code", options: { language: "json" } }
  }
];

const REDIRECT_AUDIT_FIELDS = [
  {
    field: "old_url",
    type: "string",
    schema: { max_length: 1024, is_nullable: true },
    meta: { note: "Legacy URL", interface: "input" }
  },
  {
    field: "target_url",
    type: "string",
    schema: { max_length: 1024, is_nullable: true },
    meta: { note: "Redirect target URL", interface: "input" }
  },
  {
    field: "http_code",
    type: "integer",
    schema: { is_nullable: true, default_value: 301 },
    meta: { note: "HTTP status code", interface: "input" }
  },
  {
    field: "status",
    type: "string",
    schema: { max_length: 64, is_nullable: true },
    meta: { note: "Verification result", interface: "input" }
  },
  {
    field: "notes",
    type: "text",
    schema: { is_nullable: true },
    meta: { note: "Optional validation notes", interface: "input-multiline" }
  }
];

const GLOBAL_SETTINGS_FIELDS = [
  {
    field: "site_title",
    type: "string",
    schema: { max_length: 255, is_nullable: true },
    meta: { note: "Site title", interface: "input" }
  },
  {
    field: "seo_description",
    type: "text",
    schema: { is_nullable: true },
    meta: { note: "Global SEO description", interface: "input-multiline" }
  },
  {
    field: "contact_info",
    type: "json",
    schema: { is_nullable: true },
    meta: { note: "Contact information payload", interface: "input-code", options: { language: "json" } }
  },
  {
    field: "social_links",
    type: "json",
    schema: { is_nullable: true },
    meta: { note: "Social links payload", interface: "input-code", options: { language: "json" } }
  }
];

const CATEGORY_LAYOUT_HISTORY_FIELDS = [
  {
    field: "category_old_slug",
    type: "string",
    schema: { max_length: 255, is_nullable: true },
    meta: { note: "Category old_slug", interface: "input" }
  },
  {
    field: "version",
    type: "integer",
    schema: { is_nullable: true },
    meta: { note: "Layout config version", interface: "input" }
  },
  {
    field: "old_json",
    type: "json",
    schema: { is_nullable: true },
    meta: { note: "Previous layout JSON", interface: "input-code", options: { language: "json" } }
  },
  {
    field: "new_json",
    type: "json",
    schema: { is_nullable: true },
    meta: { note: "Current layout JSON", interface: "input-code", options: { language: "json" } }
  },
  {
    field: "changed_by",
    type: "string",
    schema: { max_length: 255, is_nullable: true },
    meta: { note: "Operator or workflow actor", interface: "input" }
  },
  {
    field: "changed_at",
    type: "dateTime",
    schema: { is_nullable: true },
    meta: { note: "Change timestamp", interface: "datetime" }
  },
  {
    field: "change_source",
    type: "string",
    schema: { max_length: 64, is_nullable: true },
    meta: { note: "api/directus_ui/script", interface: "input" }
  }
];

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
      continue;
    }

    args.set(key, next);
    i += 1;
  }
  return args;
}

function stripUndefined(input) {
  if (Array.isArray(input)) {
    return input.map(stripUndefined);
  }

  if (input && typeof input === "object") {
    const out = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) {
        continue;
      }
      out[key] = stripUndefined(value);
    }
    return out;
  }

  return input;
}

class DirectusClient {
  constructor(baseUrl, token, dryRun) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.dryRun = dryRun;
    this.createdCollections = 0;
    this.createdFields = 0;
    this.createdPermissions = 0;
    this.collectionSet = new Set();
    this.fieldSet = new Set();
  }

  async request(method, path, { body, allow404 = false } = {}) {
    const url = `${this.baseUrl}${path}`;

    if (this.dryRun && ["POST", "PATCH", "DELETE"].includes(method)) {
      console.log(`[dry-run] ${method} ${url}`);
      if (body) {
        console.log(`[dry-run] body: ${JSON.stringify(body)}`);
      }
      return { data: null };
    }

    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (allow404 && res.status === 404) {
      return null;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${path} failed (${res.status}): ${text}`);
    }

    if (res.status === 204) {
      return { data: null };
    }

    return res.json();
  }

  async collectionExists(collection) {
    return this.collectionSet.has(collection);
  }

  async loadMetadata() {
    const collectionsRes = await this.request("GET", "/collections?fields=collection&limit=-1");
    const fieldsRes = await this.request("GET", "/fields?fields=collection,field&limit=-1");

    for (const item of collectionsRes?.data || []) {
      if (item?.collection) {
        this.collectionSet.add(item.collection);
      }
    }

    for (const item of fieldsRes?.data || []) {
      if (item?.collection && item?.field) {
        this.fieldSet.add(`${item.collection}.${item.field}`);
      }
    }
  }

  async ensureCollection(def) {
    const exists = await this.collectionExists(def.collection);
    if (exists) {
      console.log(`Collection exists: ${def.collection}`);
      return;
    }

    const payload = stripUndefined({
      collection: def.collection,
      meta: {
        icon: def.icon,
        note: def.note,
        accountability: "all",
        hidden: false,
        singleton: Boolean(def.singleton)
      },
      schema: {
        name: def.collection
      }
    });

    try {
      await this.request("POST", "/collections", { body: payload });
      this.createdCollections += 1;
      console.log(`Collection created: ${def.collection}`);
    } catch (error) {
      const message = String(error?.message || error);
      if (message.includes("already exists")) {
        console.log(`Collection exists: ${def.collection}`);
      } else {
        throw error;
      }
    }

    this.collectionSet.add(def.collection);
  }

  async fieldExists(collection, field) {
    return this.fieldSet.has(`${collection}.${field}`);
  }

  async ensureField(collection, def) {
    const exists = await this.fieldExists(collection, def.field);
    const patchPayload = stripUndefined({
      meta: def.meta,
      schema: def.schema
    });

    if (exists) {
      await this.request("PATCH", `/fields/${collection}/${def.field}`, { body: patchPayload });
      console.log(`Field updated: ${collection}.${def.field}`);
      return;
    }

    const payload = stripUndefined({
      field: def.field,
      type: def.type,
      meta: def.meta,
      schema: def.schema
    });

    try {
      await this.request("POST", `/fields/${collection}`, { body: payload });
      this.createdFields += 1;
      console.log(`Field created: ${collection}.${def.field}`);
    } catch (error) {
      const message = String(error?.message || error);
      if (message.includes("already exists")) {
        console.log(`Field exists: ${collection}.${def.field}`);
      } else {
        throw error;
      }
    }

    this.fieldSet.add(`${collection}.${def.field}`);
  }

  async ensurePublicReadPermission(collection) {
    const q = `/permissions?limit=1&filter[collection][_eq]=${encodeURIComponent(
      collection
    )}&filter[action][_eq]=read&filter[role][_null]=true`;
    const exists = await this.request("GET", q);
    if (Array.isArray(exists?.data) && exists.data.length > 0) {
      console.log(`Permission exists: public read ${collection}`);
      return;
    }

    const payload = {
      role: null,
      collection,
      action: "read",
      permissions: {},
      validation: null,
      presets: null,
      fields: ["*"]
    };

    try {
      await this.request("POST", "/permissions", { body: payload });
      this.createdPermissions += 1;
      console.log(`Permission created: public read ${collection}`);
    } catch (error) {
      const message = String(error?.message || error);
      if (message.includes("already exists")) {
        console.log(`Permission exists: public read ${collection}`);
      } else {
        throw error;
      }
    }
  }
}

async function login(baseUrl, email, password) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Directus login failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  return json?.data?.access_token;
}

async function run() {
  const args = parseArgs(process.argv);
  const directusUrl = String(
    args.get("url") || process.env.DIRECTUS_PUBLIC_URL || process.env.DIRECTUS_URL || "http://localhost:8055"
  );
  const dryRun = Boolean(args.get("dry-run"));
  const explicitToken = args.get("token") || process.env.DIRECTUS_TOKEN;
  const email = String(args.get("email") || process.env.DIRECTUS_ADMIN_EMAIL || "admin@example.com");
  const password = String(args.get("password") || process.env.DIRECTUS_ADMIN_PASSWORD || "ChangeMe_123456");

  const token = explicitToken ? String(explicitToken) : await login(directusUrl, email, password);
  if (!token) {
    throw new Error("No Directus token available. Provide --token or admin credentials.");
  }

  const client = new DirectusClient(directusUrl, token, dryRun);
  await client.loadMetadata();

  for (const collectionDef of [...BASE_COLLECTIONS, ...AUDIT_COLLECTIONS]) {
    await client.ensureCollection(collectionDef);
  }

  for (const baseCollection of ["articles", "projects", "categories", "reports"]) {
    for (const fieldDef of COMMON_LEGACY_FIELDS) {
      await client.ensureField(baseCollection, fieldDef);
    }
    for (const fieldDef of PIPELINE_RUNTIME_FIELDS) {
      await client.ensureField(baseCollection, fieldDef);
    }
    await client.ensureField(baseCollection, TEST_DATA_FLAG_FIELD);
  }

  for (const fieldDef of ARTICLE_STAGE2_FIELDS) {
    await client.ensureField("articles", fieldDef);
  }

  for (const fieldDef of CATEGORY_STAGE2_FIELDS) {
    await client.ensureField("categories", fieldDef);
  }

  for (const fieldDef of PROJECT_STAGE2_FIELDS) {
    await client.ensureField("projects", fieldDef);
  }

  for (const fieldDef of REPORT_STAGE2_FIELDS) {
    await client.ensureField("reports", fieldDef);
  }

  for (const collectionName of ["articles", "projects", "categories", "reports"]) {
    for (const fieldDef of SEO_FIELDS) {
      await client.ensureField(collectionName, fieldDef);
    }
  }

  for (const fieldDef of CATEGORY_EXTRA_FIELDS) {
    await client.ensureField("categories", fieldDef);
  }

  for (const fieldDef of QUOTE_FIELDS) {
    await client.ensureField("quotes", fieldDef);
  }
  await client.ensureField("quotes", TEST_DATA_FLAG_FIELD);

  for (const fieldDef of MIGRATION_AUDIT_FIELDS) {
    await client.ensureField("migration_audit", fieldDef);
  }

  for (const fieldDef of REDIRECT_AUDIT_FIELDS) {
    await client.ensureField("redirect_audit", fieldDef);
  }

  for (const fieldDef of GLOBAL_SETTINGS_FIELDS) {
    await client.ensureField("global_settings", fieldDef);
  }

  for (const fieldDef of CATEGORY_LAYOUT_HISTORY_FIELDS) {
    await client.ensureField("category_layout_history", fieldDef);
  }

  await client.ensurePublicReadPermission("articles");
  await client.ensurePublicReadPermission("projects");
  await client.ensurePublicReadPermission("categories");
  await client.ensurePublicReadPermission("quotes");
  await client.ensurePublicReadPermission("global_settings");
  await client.ensurePublicReadPermission("directus_files");

  console.log(
    `Schema bootstrap finished. created_collections=${client.createdCollections}, created_fields=${client.createdFields}, created_permissions=${client.createdPermissions}`
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
