# HCTXF 前后端项目架构图（Directus Adapted V2）

- 版本: v2.0（风险收敛版）
- 架构基线: Next.js 15 (App Router) + Directus + MinIO + Postgres + Nginx
- 迁移基线: 旧站 `nd*.html=604`、`col*.html=39`、`nr*.html=21`、栏目签名 `COL_SIG_01~27`
- 优化目标: 降低两大高风险（数据清洗、SEO 迁移），确保上线可回滚、可审计、可观测

## 0) V2 变更摘要

- 新增 `数据质量门禁` 架构图，明确 `dry-run -> 质量阈值 -> 导入/阻断`。
- 新增 `重定向运行时` 架构图，明确 `Nginx 301 优先 + Next old_slug 兜底`。
- 新增 `发布护栏与回滚` 架构图，明确灰度批次、指标阈值和回滚触发。
- 数据模型扩展：`raw_html_backup`、`content_clean`、`migration_status`、`migration_errors`、`legacy_url`。
- SEO 链路强化：全量旧 URL 注册表（664 条）+ 映射覆盖率门禁 + 死链提交。

## 图 1: System Context（系统全景）

```mermaid
flowchart LR
  U[访客用户]
  E[搜索引擎/百度]
  BO[百度站长平台]
  O[内容运营]

  subgraph R[Runtime Environment]
    NX[Nginx Gateway]
    FE[Next.js Frontend]
    DI[Directus API]
    PG[(Postgres)]
    MI[(MinIO hctxf-assets)]
    SE[(Meilisearch 可选)]
    OBS[监控与告警]
  end

  U -->|访问站点| NX
  NX -->|新路由转发| FE
  NX -->|旧URL 301| U

  E -->|抓取页面/canonical/sitemap| FE
  FE -->|sitemap 提交协同| BO

  O -->|内容管理| DI
  FE -->|Server Components 查询| DI
  DI -->|结构化数据| PG
  DI -->|文件元数据| PG
  DI -->|文件读写| MI
  FE -->|图片/PDF 访问| MI

  FE -.二阶段接入.-> SE
  DI -.可选索引同步.-> SE

  NX --> OBS
  FE --> OBS
  DI --> OBS
```

## 图 2: Frontend Project Architecture（前端工程架构）

```mermaid
flowchart TB
  subgraph APP[frontend/app]
    LAYOUT["(public)/layout.tsx"]
    HOME["(public)/page.tsx"]
    NEWS_LIST["(public)/news/page.tsx"]
    NEWS_DETAIL["(public)/news/[slug]/page.tsx"]
    PROJ_LIST["(public)/projects/page.tsx"]
    PROJ_DETAIL["(public)/projects/[slug]/page.tsx"]
    TRANS["(public)/transparency/page.tsx"]
    ABOUT["(public)/about/page.tsx"]
    CONTACT["(public)/contact/page.tsx"]

    API_REVAL["api/revalidate/route.ts"]
    API_SEARCH["api/search/route.ts"]
    API_LEGACY["api/legacy-resolve/route.ts (兜底)"]
    SITEMAP["sitemap.xml/route.ts"]
  end

  subgraph COMP[frontend/components]
    DLR["layout/DynamicLayoutRenderer.tsx"]
    SIDENAV["layout/SidebarNav.tsx"]
    RICH["directus/RichTextRenderer.tsx"]
    IMG["directus/ImageLoader.tsx"]
    PDF["directus/PdfViewer.tsx"]
    TL["sections/TimelineList.tsx"]
    QUOTE["sections/QuoteCarousel.tsx"]
    STATS["sections/StatsCounter.tsx"]
    FCB["sections/FloatingContactButton.tsx"]
  end

  subgraph LIB[frontend/lib]
    DIRECTUS["directus.ts"]
    QUERIES["queries.ts"]
    UTILS["utils.ts"]
    SEO["seo.ts"]
  end

  subgraph TYPES[frontend/types]
    DTYPES["directus-types.ts"]
  end

  LAYOUT --> SIDENAV
  HOME --> DLR
  NEWS_LIST --> TL
  NEWS_DETAIL --> RICH
  PROJ_DETAIL --> STATS
  TRANS --> PDF
  LAYOUT --> FCB

  DLR --> QUERIES
  TL --> QUERIES
  RICH --> QUERIES
  IMG --> UTILS
  NEWS_DETAIL --> SEO

  QUERIES --> DIRECTUS
  DIRECTUS --> DTYPES

  API_REVAL --> DIRECTUS
  API_SEARCH --> DIRECTUS
  API_LEGACY --> DIRECTUS
  SITEMAP --> DIRECTUS
```

## 图 3: Backend & Storage Architecture（后端与存储）

```mermaid
flowchart LR
  subgraph DC[Docker Compose Network]
    N[Next.js Service]
    D[Directus Service]
    P[(Postgres)]
    M[(MinIO)]
    S[(Meilisearch 可选)]
    Q[(Task Queue 可选)]
  end

  N -->|HTTP/SDK| D
  D -->|SQL| P
  D -->|S3 API| M
  N -->|静态资源读取| M

  N -.可选搜索代理.-> S
  D -.可选索引同步.-> S

  D -->|Webhook/异步任务| Q
  N -->|revalidate 重试| Q
```

## 图 4: Data Model Mapping（Directus 数据模型映射）

```mermaid
flowchart LR
  subgraph COL[Directus Collections]
    ART["articles\n- title/slug/old_slug\n- legacy_url\n- publish_date\n- raw_html_backup\n- content_clean\n- migration_status\n- migration_errors(json)\n- seo_*\n- category(rel)"]
    PROJ["projects\n- name/slug/old_slug\n- legacy_url\n- summary/content\n- cover_image\n- stats_json\n- seo_*"]
    CAT["categories\n- name/slug/old_slug\n- layout_template\n- layout_config(JSON)\n- seo_*"]
    QT["quotes\n- content/author/source\n- confidence\n- display_order"]
    REP["reports\n- year/title\n- pdf_file\n- summary\n- old_slug\n- seo_*"]
    GS["global_settings(singleton)\n- site_title\n- seo_description\n- contact_info"]
    MA["migration_audit\n- source_path\n- status\n- error\n- checksum"]
    RA["redirect_audit\n- source_url\n- target_url\n- mode(direct/fallback/manual/miss)"]
  end

  subgraph FE[Frontend Components]
    AH[ArticleHeader/ArticleBody]
    RA2[RelatedArticles]
    PH[ProjectHero/ProjectStats]
    SN[SidebarNav]
    DLR[DynamicLayoutRenderer]
    QC[QuoteCard/QuoteCarousel]
    RV[ReportList/PdfViewer]
    SEO2[SeoHead/Footer]
  end

  ART --> AH
  ART --> RA2
  PROJ --> PH
  CAT --> SN
  CAT --> DLR
  QT --> QC
  REP --> RV
  GS --> SEO2
  ART --> MA
  CAT --> RA
```

## 图 5: Dynamic Layout Engine（27 签名抽象）

```mermaid
flowchart TB
  LEGACY["旧站栏目签名\nCOL_SIG_01 ~ COL_SIG_27"] --> ANALYZE["签名归纳规则"]

  ANALYZE --> CFG["categories.layout_config(JSON)"]

  CFG --> RENDER["DynamicLayoutRenderer"]

  subgraph ATOM[原子布局组件]
    BA[BannerArea]
    SV[SidebarNav]
    TL[TimelineList]
    GL[GridList]
    SL[SimpleList]
  end

  RENDER --> BA
  RENDER --> SV
  RENDER --> TL
  RENDER --> GL
  RENDER --> SL

  BA --> PAGE["输出最终栏目页\n(覆盖 39 个 col 页面)"]
  SV --> PAGE
  TL --> PAGE
  GL --> PAGE
  SL --> PAGE
```

## 图 6: Data Quality Gate（数据质量门禁）

```mermaid
flowchart LR
  SRC["旧站 HTML\nnd/col/nr 页面"] --> EX["抽取器\n字段标准化"]
  EX --> AST["AST 清洗器\n去 style/危险标签"]
  AST --> MEDIA["媒体重写\n外链 -> MinIO/Directus Files"]
  AST --> TABLE["表格响应式包装\noverflow-x-auto"]
  AST --> QC["名言候选抽取\n含置信度"]

  MEDIA --> VAL["结构校验器\nDOM/链接/占位符"]
  TABLE --> VAL
  QC --> VAL

  VAL --> REPORT["dry-run 报告\nmigration_report.json"]
  REPORT --> GATE{"质量阈值通过?"}

  GATE -->|否| FIX["阻断导入\n进入修复队列"]
  GATE -->|是| IMPORT["导入 Directus\nstatus=cleaned"]

  IMPORT --> REVIEW["人工审核\nstatus=needs_review"]
  REVIEW --> APPROVE["审核通过\nstatus=approved"]
  APPROVE --> PUBLISH["发布\nstatus=published"]

  FIX --> AUDIT["migration_audit 记录"]
  IMPORT --> AUDIT
  REVIEW --> AUDIT
```

## 图 7: SEO Migration Flow（SEO 平滑迁移）

```mermaid
flowchart LR
  OLD["旧 URL 全量集合\nnd(604)+col(39)+nr(21)=664"] --> REG["legacy url registry"]
  REG --> GEN["generate-redirects\n输出 redirects.map + redirect_audit"]
  GEN --> COV{"映射覆盖率=100%?"}

  COV -->|否| BLOCK["阻断上线\n补齐映射"]
  COV -->|是| NX["Nginx 301 一跳重定向"]

  NX --> NEW["新语义路由\n/news/[slug]\n/projects/[slug]\n/transparency"]
  NEW --> FALLBACK["old_slug/legacy_url 兜底查询"]
  FALLBACK --> PAGE["SSR/SSG 页面输出"]

  PAGE --> META["继承/生成 SEO 元数据\nseo_title/description/keywords"]
  PAGE --> CANON["canonical"]
  PAGE --> SITE["sitemap.xml 动态生成"]
  SITE --> BAIDU["百度站长平台: sitemap 提交 + 死链提交"]

  BLOCK --> BAIDU
```

## 图 8: Redirect Runtime（重定向运行时）

```mermaid
flowchart LR
  REQ["请求旧链接\n/nd004c.html"] --> HIT{"Nginx map 命中?"}
  HIT -->|是| R301["301 -> 新路由"]
  HIT -->|否| LEGACY["/api/legacy-resolve\nold_slug + legacy_url 查询"]

  LEGACY --> FOUND{"数据库命中?"}
  FOUND -->|是| R2["301 -> 语义路由"]
  FOUND -->|否| NF["404 页面"]

  R301 --> OK["200 新页面"]
  R2 --> OK

  NF --> DL["deadlink 队列"]
  LEGACY --> LOG["redirect_audit 日志"]
  R301 --> LOG
  R2 --> LOG
```

## 图 9: Content Sanitization & Import Pipeline（内容清洗迁移）

```mermaid
flowchart TB
  HTML["旧站正文 HTML\n(module12 + 富文本)"] --> CLEAN["migrate-content\nAST 规则清洗"]

  CLEAN --> REMOVE["移除内联 style\n统一交给 Tailwind"]
  CLEAN --> SAFE["XSS 清洗\nscript/事件属性剔除"]
  CLEAN --> IMG["图片/附件 URL 重写\n-> MinIO/Directus 文件ID"]
  CLEAN --> QUOTE["名言候选抽取\n欧阳修/高尔基/莎士比亚"]

  QUOTE --> CONF{"置信度 >= 阈值?"}
  CONF -->|是| SLOT["插入 [quote:id=xxx] 占位符"]
  CONF -->|否| KEEP["保留原文并标记 needs_review"]

  REMOVE --> MERGE["生成 content_clean"]
  SAFE --> MERGE
  IMG --> MERGE
  SLOT --> MERGE
  KEEP --> MERGE

  MERGE --> BACKUP["写入 raw_html_backup + content_clean"]
  BACKUP --> IMPORT["导入 Directus Draft"]
  IMPORT --> QA["人工 QA 审核"]
```

## 图 10: Publish/Revalidate Runtime（发布与重建链路）

```mermaid
flowchart LR
  EDITOR["运营在 Directus 改内容"] --> WEBHOOK["Directus Webhook"]

  WEBHOOK --> API["POST /api/revalidate\n签名校验"]
  API --> TAG["revalidateTag"]
  API --> PATH["revalidatePath"]

  TAG --> CACHE["Next.js 缓存失效"]
  PATH --> CACHE

  CACHE --> NEXTREQ["下一次请求触发新渲染"]
  NEXTREQ --> USER["用户看到最新页面"]

  API --> LOG["审计日志/错误告警"]
  LOG --> RETRY{"重试次数未超限?"}
  RETRY -->|是| QUEUE["重试队列"]
  RETRY -->|否| OPS["人工介入"]
  QUEUE --> API
```

## 图 11: Release Guardrail & Rollback（发布护栏与回滚）

```mermaid
flowchart TB
  PLAN["灰度发布计划\n批次: news -> projects -> transparency"] --> DEPLOY["批次上线"]
  DEPLOY --> MON["监控面板\n301命中率/404率/媒体404率/fallback命中率/审核积压"]

  MON --> PASS{"指标达标?"}
  PASS -->|是| NEXT["进入下一批"]
  PASS -->|否| RB["回滚触发\n切回旧站 upstream"]

  RB --> RCA["根因分析 + 修复"]
  RCA --> REDEPLOY["重新灰度"]
  REDEPLOY --> MON

  NEXT --> DONE{"全部批次完成?"}
  DONE -->|否| DEPLOY
  DONE -->|是| STABLE["稳定运行"]
```

## 12) 接口、脚本与数据约束

- 关键 API：
  - `POST /api/revalidate`（签名校验 + 重试 + 审计）
  - `GET /api/legacy-resolve`（old_slug/legacy_url 兜底）
  - `GET /sitemap.xml`（动态 sitemap）
- 关键脚本：
  - `scripts/generate-redirects.ts`
  - `scripts/validate-redirects.ts`
  - `scripts/migrate-content.ts`
- 关键字段约束：
  - `old_slug`：同集合唯一
  - `migration_status`：`draft_raw/cleaned/needs_review/approved/published`
  - `raw_html_backup`：不可覆盖删除（审计保留）

## 13) 上线门禁（Go/No-Go）

- `redirect coverage = 100%`（664 条旧 URL 全覆盖）
- `301 单跳`（禁止链式跳转）
- `内容清洗 dry-run 通过`（阻断阈值内）
- `人工审核通过率达标`（仅 approved 才可发布）
- `灰度监控指标达标`（未达标立即回滚）

## 14) 备注与边界

- 必做链路: 301 重定向、`old_slug` 兜底、`/api/revalidate`、动态 sitemap、人工审核门禁。
- 二阶段可选: Meilisearch 检索、任务队列扩展、自动告警分级策略。
- 本文档作为实施蓝图，后续代码落地必须与图中接口和门禁保持一致。
