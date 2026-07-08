# Engineering Design Document (EDD)
## China Intelligence & Insights Hub / 管理驾驶舱

**Version:** 1.0  
**Date:** 2026-07-08  
**Status:** Draft for replication

---

## 1. Architecture Overview

The system is a **multi-tenant, modular cockpit platform** composed of:

1. **Portal Shell** – authentication, branding, top navigation, user session, i18n.
2. **Cockpit Host** – loads plate-specific micro-frontends and orchestrates layout.
3. **Plates / Modules** – independent functional pages (e.g., Competitive Intelligence).
4. **Backend Services** – split by domain: identity, console config, solar business logic, LLM/RAG, operations.
5. **Object Storage** – MinIO buckets for static assets, avatars, images, and generated content.

```text
┌─────────────────────────────────────────────────────────────┐
│                        User Browser                         │
│   (Chrome/Edge/Safari, min-width 1280px)                    │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTPS / HTTP2
┌───────────────────────▼─────────────────────────────────────┐
│              Kubernetes Ingress (TLS terminated)            │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   ┌─────────┐    ┌──────────┐    ┌──────────┐
   │  Portal │    │  Cockpit │    │  Static  │
   │  (UmiJS)│    │  (UmiJS) │    │  (MinIO) │
   └───┬─────┘    └────┬─────┘    └────┬─────┘
       │               │               │
       ▼               ▼               ▼
  /minibase/…    /cockpit/solar/…   /minio.*/…
  portal APIs    console/llm/solarbe  assets
```

---

## 2. Tech Stack

### 2.1 Frontend

| Layer | Technology | Version / Notes |
|-------|------------|-----------------|
| Framework | React 18 + UmiJS (Ant Design Pro pattern) | Portal: `umi.js` v1.0.0.567; Cockpit: custom webpack/Umi-like build v1.0.0.3912 |
| Routing | UmiJS convention + hash/browser history | `window.routerBase = "/portal/"` |
| UI Libraries | Ant Design (antd) + Arco Design | antd for forms/buttons/spin/layout; Arco for menus/modals |
| Table/Visualization | VTable | CSS observed; used in data-heavy plates |
| State Management | React hooks + context; possibly dva/redux (UmiJS default) | Inferred from UmiJS conventions |
| Styling | CSS Modules + Less + custom theme files | Hashed class names: `layout-sider--FrPBh` |
| i18n | Custom polyglot loader | `/polyglot/en_US` returns JSON key/value map |
| Build | Webpack with code splitting | Async chunks: `plate.3bef532f.js`, `main-common-*.js` |
| Fonts | D-DIN, D-DIN-Bold, PingFang SC, Microsoft YaHei | Loaded via `@font-face` |
| Monitoring | ByteDance/Byted frontend monitor | `/minibase/monitor/fronted/...` |

### 2.2 Backend

| Service | Domain | Notes |
|---------|--------|-------|
| minibase portal | Identity, auth, captcha, config, resources | `/minibase/portal/api/v1/...` |
| minibase monitor | Browser APM / RUM | `/minibase/monitor/fronted/...` |
| solar console | Site theming, console config, feature flags | `/cockpit/solar/console/api/v1/...` |
| solarbe | Business data: userinfo, sites, plates, operations | `/cockpit/solar/solarbe/api/v1/...` |
| solar llm | News ingestion, classification, AI interpretation | `/cockpit/solar/llm/api/v1/...` |

### 2.3 Infrastructure

| Component | Technology |
|-----------|------------|
| Container Orchestration | Kubernetes |
| Ingress | Kubernetes Ingress Controller (self-signed cert observed) |
| Static Assets | MinIO (`/minio.peon`, `/minio.minibase.avatar`, `/minio.minibase.static`) |
| CDN | Bytedance/pstatp CDN domains for some third-party trackers |
| TLS | TLSv1.3, self-signed “Acme Co / Kubernetes Ingress Controller Fake Certificate” |

---

## 3. Frontend Architecture

### 3.1 Portal Application (`/portal/`)

- Entry: `umi.js` + `umi.css`.
- Config injected via `window.peonAppConfig`:
  - `$$modules$$`, `$$supportModes$$`, `bannerUrl`, `logoUrl`, `enablePerf`, `subPath`.
- Routes:
  - `/portal/auth/login` – login page.
- After login, redirects to cockpit host.

### 3.2 Cockpit Application (`/cockpit/solar/`)

- Entry HTML sets `window.solarConfig`, `window.customTenant`, `window.solar` globals.
- `publicPath` points to MinIO versioned build folder:
  ```js
  `/minio.peon/solar/${version}/dist/${platform}/`
  ```
- Version observed: `1.0.0.3912` for solar cockpit.
- Platform: `pc` (also supports mobile/landscape via `window.__isPc` and `isLandscape`).

### 3.3 Layout Components

- `Layout` (antd Layout): header, sider, content.
- `Navbar` (custom): logo, module nav, language switch, stock ticker dropdown, notification bell, avatar.
- `Sider` (Arco Menu vertical): module sub-navigation.
- `PlateHost`: renders the active plate route and passes `site_id`, `plate_id`, `tab_id`.

### 3.4 State & Data Flow

1. App bootstrap loads:
   - `/console/api/v1/config` – feature flags, content-insight config.
   - `/solarbe/api/v1/userinfo` – current user.
   - `/solarbe/api/v1/sites` – site configuration.
   - `/solarbe/api/v1/plates` – available plates.
   - `/solarbe/api/v1/polyglot/<locale>` – UI strings.
   - `/console/api/v1/style` – tenant theming.
2. Plate component fetches its own tab/filter config and content.
3. Filter changes trigger POST `/llm/api/v1/news/list` and update local list state.
4. AI drawer maintains its own chat state.

### 3.5 Build & Asset Pipeline

- Webpack entry: `main.*.js`, `runtime.*.js`, `plate.*.js`, async `main-common-*` chunks.
- CSS: code-split per chunk (`*.css` alongside `*.js`).
- Images: PNG logos, background, icons served from MinIO.
- Fonts: TTF files in `/fonts/`.
- Custom theme override: `/minio.peon/custom-theme/index.css` loaded after base CSS.

---

## 4. Backend Service Design

### 4.1 minibase Portal Service

Responsibilities:
- User authentication (login/logout/session).
- Captcha generation.
- Tenant-level portal config and resource discovery.
- User profile (`/user`).

Key endpoints:
- `POST /minibase/portal/api/v1/user/login`
- `GET  /minibase/portal/api/v1/captcha`
- `GET  /minibase/portal/api/v1/config`
- `GET  /minibase/portal/api/v1/resources`
- `GET  /minibase/portal/api/v1/user`

### 4.2 Solar Console Service

Responsibilities:
- Site-level feature flags and switchers.
- Tenant theming (navigator logo, height, numeric font, tab style).
- Content-insight configuration (MinIO bucket, agent ID, interpretation tip).
- Utility endpoints for image serving.

Key endpoints:
- `GET /cockpit/solar/console/api/v1/config`
- `GET /cockpit/solar/console/api/v1/style`
- `GET /cockpit/solar/console/api/v1/utils/images?image=<path>`

### 4.3 Solarbe (Solar Backend) Service

Responsibilities:
- Userinfo and common config.
- Site and plate metadata.
- Operations messages and comments.
- User search for IM/mentions.
- Internationalization strings.

Key endpoints:
- `GET /cockpit/solar/solarbe/api/v1/userinfo`
- `GET /cockpit/solar/solarbe/api/v1/user/common_config`
- `GET /cockpit/solar/solarbe/api/v1/sites`
- `GET /cockpit/solar/solarbe/api/v1/plates?status=1&inner=1`
- `GET /cockpit/solar/solarbe/api/v1/polyglot/en_US`
- `GET /cockpit/solar/solarbe/api/v1/auth/users/global_fuzzy_search`
- `GET /cockpit/solar/solarbe/api/v1/operations/messages/user/my`
- `GET /cockpit/solar/solarbe/api/v1/operations/messages/comment/my/count`

### 4.4 LLM Service

Responsibilities:
- News ingestion, storage, indexing.
- Taxonomy classification and filtering.
- Tab configuration.
- AI interpretation / RAG Q&A.

Key endpoints:
- `GET  /cockpit/solar/llm/api/v1/news/tabs`
- `GET  /cockpit/solar/llm/api/v1/news/filter/<tab_id>`
- `POST /cockpit/solar/llm/api/v1/news/list?page=<n>&page_size=<n>`
- (assumed) `POST /cockpit/solar/llm/api/v1/news/interpret` or similar for AI drawer.

---

## 5. Data Model

### 5.1 User

```sql
users (
  id              bigint PK,
  account         varchar unique,   -- login name, e.g. analyst.one
  username        varchar,          -- display name
  avatar          varchar url,
  department      varchar,
  email           varchar,
  phone_number    varchar,
  is_admin        boolean,
  is_developer    boolean,
  is_bind_uniq_device boolean,
  created_at      timestamptz,
  updated_at      timestamptz
)
```

### 5.2 Site / Tenant

```sql
sites (
  id              bigint PK,
  name            varchar,
  site_conf       jsonb,            -- feature bar map
  bottom_tabs     jsonb,
  max_site_num    int default 20,
  created_at      timestamptz
)

site_admins (
  site_id  bigint FK,
  user_id  bigint FK
)
```

### 5.3 Plate

```sql
plates (
  id              varchar PK,
  name            varchar,
  name_en         varchar,
  parent_id       varchar,
  tab_type        varchar,
  status          int,              -- 1 = enabled
  tab_conf        jsonb,
  sort_value      int
)
```

### 5.4 News Tab

```sql
news_tabs (
  id              bigint PK,
  tab_type        varchar,          -- e.g. "news"
  tab_conf        jsonb,            -- ai_feature_class, ai_filter
  created_at      timestamptz,
  updated_at      timestamptz
)
```

### 5.5 News Article

```sql
news_articles (
  id              bigint PK,
  tab_id          bigint FK,
  uid             varchar unique,   -- content hash / stable id
  original_url    text,
  source_type     varchar,
  publish_time    timestamptz,
  is_collect      boolean,
  is_hide         boolean,
  created_at      timestamptz,
  updated_at      timestamptz
)

news_article_locales (
  article_id      bigint FK,
  locale          varchar,          -- zh_cn, en_us
  title           text,
  summary         text,
  display_summary text,
  keywords        text,
  source_type     varchar,
  features        varchar[],
  PRIMARY KEY (article_id, locale)
)
```

### 5.6 Feature Filter Taxonomy

```sql
feature_filters (
  id              bigint PK,
  parent_id       bigint FK,
  name            varchar,
  en_name         varchar,
  description     text,
  sort_value      int,
  ctime           timestamptz,
  mtime           timestamptz
)
```

### 5.7 AI Interpretation Session (assumed)

```sql
ai_sessions (
  id              bigint PK,
  article_id      bigint FK,
  user_id         bigint FK,
  question        text,
  answer          text,
  model           varchar,
  tokens_used     int,
  created_at      timestamptz
)
```

---

## 6. API Specifications

### 6.1 Authentication

**POST** `/minibase/portal/api/v1/user/login`

Request (observed form fields):
```json
{
  "account": "analyst.one",
  "password": "<hashed-or-plain>"
}
```

Response:
```json
{
  "code": 0,
  "data": { /* user / token */ },
  "msg": "success"
}
```

### 6.2 News List

**POST** `/cockpit/solar/llm/api/v1/news/list?page=1&page_size=12`

Request body:
```json
{
  "is_i18n": true,
  "query": "",
  "date": {
    "exclude": false,
    "value": ["1730971278,day,-180,0"],
    "contains_today": false
  },
  "feature": [
    { "exclude": false, "value": [], "contains_today": false },
    { "exclude": false, "value": [], "contains_today": false }
  ],
  "page": 1,
  "page_size": 12,
  "tab_id": 6
}
```

Response:
```json
{
  "code": 0,
  "data": {
    "page": 1,
    "page_size": 12,
    "page_data": [ /* Article objects */ ]
  },
  "msg": "success"
}
```

### 6.3 News Tabs

**GET** `/cockpit/solar/llm/api/v1/news/tabs`

Response: tab definitions incl. `ai_filter` keyword exclusion lists.

### 6.4 News Filters

**GET** `/cockpit/solar/llm/api/v1/news/filter/<tab_id>`

Response: `date_filter` and `feature_filter` trees.

### 6.5 AI Interpretation (assumed)

**POST** `/cockpit/solar/llm/api/v1/news/interpret` (or `/agent/chat`, exact path TBD)

Request:
```json
{
  "article_id": 11649,
  "uid": "a2629cc5...",
  "locale": "en_us",
  "question": "Summarize the impact on international markets"
}
```

Response: SSE stream or JSON with generated text.

---

## 7. Authentication & Security

1. **Session cookies** set on login; APIs rely on same-origin cookie auth.
2. **CSRF token** present in login form and subsequent state-changing requests.
3. **HSTS** header enforced: `strict-transport-security: max-age=15724800; includeSubDomains`.
4. **CORS** configured as `Access-Control-Allow-Origin: *` for some static endpoints (backend APIs likely stricter).
5. **Watermark** rendered via client-side JS overlay (`mask_div_id`) to discourage screenshots.
6. **Sensitive-operation audit** feature flag (`feature_audit_sensitive_operation`) available but off.
7. **Self-signed TLS** acceptable for private deployments; production should use real certs.

---

## 8. AI / LLM Integration

### 8.1 Model

- Observed attribution: “Q & A results are generated by the 豆包 large model” (Doubao / ByteDance Volcano Engine).
- Config stored in console config:
  - `content_insight.config.newsInsight.newsInsightAgentId`
  - `showInterpretTip: true`
  - `concurrent: 3`

### 8.2 RAG Flow

1. User selects article; frontend sends article context (id, title, summary, URL) to LLM service.
2. Backend retrieves full article text (possibly from object storage bucket `news-insight`) and builds prompt.
3. LLM generates summary/answer.
4. Frontend streams response into the drawer.
5. Follow-up questions include prior conversation context.

### 8.3 Guardrails

- Disclaimer modal on first use.
- Keyword exclusion list for low-quality or politically sensitive topics.
- Rate limiting (`concurrent: 3`).
- Optional sensitive-operation audit logging.

---

## 9. Internationalization

- Locale files loaded from `/cockpit/solar/solarbe/api/v1/polyglot/<locale>`.
- Content stored per-locale in `news_article_locales`.
- URL parameter `is_i18n: true` on list requests triggers localized response.
- Ant Design locale provider + custom polyglot hook.

---

## 10. Asset Storage (MinIO)

| Bucket / Prefix | Purpose |
|-----------------|---------|
| `/minio.peon/portal/<version>/fe-static/` | Portal JS/CSS/fonts |
| `/minio.peon/solar/<version>/dist/pc/` | Cockpit JS/CSS/fonts/images |
| `/minio.peon/custom-theme/index.css` | Tenant theme override |
| `/minio.peon/solar/.../assets/` | Tenant logos, banner images |
| `/minio.minibase.avatar/` | User avatars |
| `/minio.minibase.static/` | Static images (login background) |
| `news-insight` | LLM article source content |

---

## 11. Deployment & Infrastructure

### 11.1 Kubernetes Manifests (representative)

- Ingress routing:
  - `/portal/*` → portal service
  - `/cockpit/solar/*` → cockpit static + API gateway
  - `/minibase/*` → minibase services
  - `/minio.*` → MinIO gateway
- Services:
  - `portal-web`
  - `solar-web`
  - `solar-console-api`
  - `solarbe-api`
  - `solar-llm-api`
  - `minibase-portal-api`
  - `minibase-monitor-api`
  - `minio`

### 11.2 Environment Handling

- `window.solarConfig.base_path` / `page_path` support custom base paths (Maat/Bytedance test env vs private env).
- `is_preview` flag preserves preview mode across navigations.
- `solar_env: private` indicates private deployment mode.

### 11.3 CI/CD

- Frontend builds versioned artifacts and uploads to MinIO (`/minio.peon/solar/<version>/dist/pc/`).
- Console `version: v1.19.2` tracks backend release.
- Portal and cockpit versions are independently versioned.

---

## 12. Monitoring & Observability

- **Frontend RUM:** `/minibase/monitor/fronted/monitor_browser/collect` posts performance/error data.
- **Frontend Settings:** `/minibase/monitor/fronted/settings/get/web` configures sampling/rules.
- **Backend Tracing:** `x-tt-logid` header propagated across requests.
- **Upstream Timing:** `upstream-caught` and `x-m-request-start` headers for latency analysis.
- **Console Logs:** captured in browser for developer diagnostics.

---

## 13. Implementation Phases (Suggested)

| Phase | Deliverable |
|-------|-------------|
| P1 | Auth portal (login, session, userinfo), MinIO asset hosting, basic layout shell. |
| P2 | Site/plate config APIs, left/top navigation, i18n framework, home dashboard empty state. |
| P3 | Competitive Intelligence plate: filters, card grid, pagination, external link, collect/hide. |
| P4 | News ingestion pipeline + taxonomy classification + filter API. |
| P5 | AI interpretation drawer + LLM/RAG integration + disclaimer. |
| P6 | Notifications, comments/IM, favorites, admin console, monitoring. |
| P7 | Hardening: RBAC, audit, watermark, performance, production TLS. |

---

## 14. Assumptions & Risks

| # | Assumption / Risk | Mitigation |
|---|-------------------|------------|
| 1 | Exact LLM interpretation endpoint not observed. | Prototype with generic `/llm/interpret` and adjust after API discovery. |
| 2 | Article ingestion/crawler pipeline outside audit scope. | Build crawler/RSS/WeChat ingestion separately; keep ingestion API contract stable. |
| 3 | Permission model details not fully visible. | Implement site-based + role-based guards; refine with admin use cases. |
| 4 | Mix of Ant Design and Arco Design increases bundle size. | Audit and tree-shake; consider consolidating to one library in the long term. |
| 5 | Self-signed TLS cert in observed environment. | Use proper cert in production; support `ignoreHTTPSErrors` only for internal testing. |

---

## 15. Appendix: Observed API Inventory

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/minibase/portal/api/v1/captcha` | Captcha image |
| POST | `/minibase/portal/api/v1/user/login` | Login |
| GET | `/minibase/portal/api/v1/config` | Portal config |
| GET | `/minibase/portal/api/v1/resources` | Portal resources |
| GET | `/minibase/portal/api/v1/user` | Current user |
| GET | `/cockpit/solar/console/api/v1/config` | Console/feature flags |
| GET | `/cockpit/solar/console/api/v1/style` | Tenant theme |
| GET | `/cockpit/solar/solarbe/api/v1/userinfo` | Userinfo |
| GET | `/cockpit/solar/solarbe/api/v1/user/common_config` | User common config |
| GET | `/cockpit/solar/solarbe/api/v1/sites` | Site list |
| GET | `/cockpit/solar/solarbe/api/v1/plates` | Plate list |
| GET | `/cockpit/solar/solarbe/api/v1/polyglot/en_US` | i18n strings |
| GET | `/cockpit/solar/solarbe/api/v1/auth/users/global_fuzzy_search` | User search |
| GET | `/cockpit/solar/solarbe/api/v1/operations/messages/user/my` | User messages |
| GET | `/cockpit/solar/solarbe/api/v1/operations/messages/comment/my/count` | Comment count |
| GET | `/cockpit/solar/llm/api/v1/news/tabs` | News tabs |
| GET | `/cockpit/solar/llm/api/v1/news/filter/<tab_id>` | News filters |
| POST | `/cockpit/solar/llm/api/v1/news/list` | News list |
| GET | `/minibase/monitor/fronted/settings/get/web` | Monitor settings |
| POST | `/minibase/monitor/fronted/monitor_browser/collect` | Monitor collect |
