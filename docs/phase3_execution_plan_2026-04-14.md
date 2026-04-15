# HCTXF 阶段三执行计划快照（2026-04-14）

## 1. 当前状态快照

- 阶段二验收状态：`PASS`（`PASS=6, WARN=0, FAIL=0`）。
- 关键产物已就绪：
  - `platform/nginx/conf.d/redirects/legacy.map`
  - `config/special-routes.json`
  - `platform/config/allowed-domains.json`
  - `reports/dry-run-full.json`
  - `reports/quote-confidence-report.json`
  - `reports/missing_assets.csv`
  - `scripts/image-dedup-cache.json`
- 前端现状：`frontend/` 仍为最小骨架（占位首页 + 基础 layout + health route）。
- Directus 现状：阶段二 schema 字段已具备，但业务数据集合当前为空（articles/categories/projects/reports 均为 0），`global_settings` 与 `category_layout_history` 尚未建立。

## 2. 阶段三总体目标（锁定）

- 通过 `layout_config` JSON 驱动页面布局，解耦旧站 27 种签名与前端代码。
- 栏目 canonical 路由锁定为：`/news/category/[slug]`。
- 发布节奏锁定为两波：
  1. 第一波：核心内容交付（动态布局、核心页面、富文本与名言、基础 SEO）。
  2. 第二波：SEO 与运维就绪（legacy resolve、sitemap/robots、灰度/回滚、监控门禁）。
- 监控方案锁定为：应用级 + Nginx 结构化日志 + 滑动窗口脚本自动回滚（本阶段不强依赖 Prometheus/Grafana）。

## 3. 明确纳入的增强策略

### 3.1 布局配置版本快照（Layout Config Versioning）

- 在 `categories` 增加 `layout_config_version`（整数）。
- 新建 `category_layout_history` 集合，字段至少包含：
  - `category_old_slug`
  - `version`
  - `old_json`
  - `new_json`
  - `changed_by`
  - `changed_at`
  - `change_source`
- 每次 `layout_config` 更新自动写入 history。
- 提供一键回退能力（脚本/API），可回到上一版本。

### 3.2 名言卡片渐进式增强（Progressive Enhancement for Quotes）

- `[quote:id=xxx]` 服务端渲染必须有可读兜底文本。
- JS 成功加载后再升级为动画 QuoteCard（Framer Motion）。
- JS 失败/禁用场景仍展示静态引用，不允许留空或暴露占位符。
- 关键区域提供 `noscript` 静态兜底。

### 3.3 冷启动预热 + ISR 强制刷新

- 发布后切流前运行 `warmup-pages`，并发访问所有 published URL，预热缓存。
- Directus webhook 触发 `/api/revalidate`（按 tag+slug 定点刷新）。
- 目标：内容更新后尽快生效，避免 ISR 冷页首访抖动。

### 3.4 自适应监控基线（Adaptive Baseline）

- `monitor-checker.ts` 每分钟执行，基于 5 分钟滑窗统计。
- 对比过去 1 小时基线，使用相对增幅判定异常。
- 触发建议：
  - 5xx 比例 > 1% 且持续 1 分钟。
  - 404 速率相对基线增幅 > 200%，且当前速率 > 10/min。
- 分时段策略：
  - 发布窗口前 30 分钟：告警但不自动回滚。
  - 稳定期：满足阈值可触发自动回滚。

## 4. 里程碑执行顺序（明日按此推进）

### M0：数据就绪（阶段三前置门禁）

- 完成正式导入：批处理事务 + 幂等 + 重试 + 隔离/自愈。
- 引入 canary 测试数据并跑自动断言：
  - 文章入库且 published。
  - 名言入 quotes。
  - 图片在 MinIO/Directus 可访问。
- 任一断言失败直接阻断 M1。

### M1：第一波（核心内容交付）

- 前端栈落地：Next.js 15 + TS strict + Tailwind 4 + typography。
- 数据层落地：Directus SDK 封装 + 类型生成。
- 页面落地：
  - `/`
  - `/news/[slug]`
  - `/news/category/[slug]`
  - `/projects/[slug]`
  - `/transparency`
  - `/about/team`
- 动态布局引擎落地：`DynamicLayoutRenderer` + 原子组件。
- 富文本渲染落地：DOMPurify 清洗、table 响应式包装、quote 占位符解析与 SSR fallback。

### M2：第二波（SEO 与运维就绪）

- API 与路由：
  - `GET /api/legacy-resolve`
  - `POST /api/revalidate`
  - `GET /sitemap.xml`
  - `GET /robots.txt`
- Nginx：
  - `map_hash_max_size 2048`
  - `map_hash_bucket_size 128`
  - legacy 重定向灰度开关
- 运维脚本：
  - `platform/scripts/rollback-enhanced.sh`
  - `platform/scripts/emergency-fallback.sh`
  - `platform/scripts/warmup-pages.(ts|mjs)`
  - `platform/scripts/shadow-traffic-check.(ts|mjs)`

### M3：监控与自动回滚

- 统一 JSON 结构化日志（Next.js + API + Nginx）。
- 实现 `platform/scripts/monitor-checker.ts`。
- 接入回滚触发链路（稳定期自动回滚，发布窗口仅告警）。
- 增加数据新鲜度探针（Directus `updated_at` 与前端可见时间戳比对）。

## 5. 验收门禁（Go/No-Go）

### Gate A（M0）

- 导入完整性通过，状态机一致。
- canary 三项断言全部通过。
- 自愈任务可重复执行且幂等。

### Gate B（M1）

- 27 种签名配置渲染通过，无硬编码模板分支。
- 抽查 50 页面渲染成功率 100%。
- 无白屏与阻断性 console 错误。

### Gate C（M2）

- 664 旧链接 301 单跳达标（含 special routes）。
- sitemap/robots/canonical 校验通过。
- 预热脚本成功后才允许全量切流。

### Gate D（M3）

- Lighthouse 达标：
  - Performance > 90
  - SEO > 95
  - Accessibility > 90
- 自动回滚与紧急静态降级脚本演练通过。

## 6. 交付物清单（阶段三）

- 源码：`frontend/`（核心页面 + 动态布局引擎）。
- 配置：`config/special-routes.json`、`platform/config/allowed-domains.json`。
- 报告：`reports/missing_assets.csv`、`reports/quote-confidence-report.json`、`final_error_report.csv`（若有隔离失败项）。
- 缓存：`scripts/image-dedup-cache.json`。
- 运维脚本：
  - `platform/scripts/rollback-enhanced.sh`
  - `platform/scripts/emergency-fallback.sh`
  - `platform/scripts/monitor-checker.ts`
  - `platform/scripts/warmup-pages.(ts|mjs)`
  - `platform/scripts/shadow-traffic-check.(ts|mjs)`
- 文档：
  - `docs/frontend-component-guide.md`
  - `docs/dynamic-layout-config-manual.md`
  - `reports/seo-redirect-e2e-report.md`

## 7. 默认兜底策略（实施时禁止变更）

- 栏目 canonical 固定 `/news/category/[slug]`。
- 两波发布顺序固定，不允许跳过 M0。
- `special-routes.json` 优先级高于数据库 override。
- quote 组件“内容可见优先于动画”。
- 任意布局错误都应降级可读，不允许白屏。

---

最后更新：2026-04-14
状态：待执行（计划已冻结，明日按里程碑推进）
