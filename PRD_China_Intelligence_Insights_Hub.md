# Product Requirements Document (PRD)
## China Intelligence & Insights Hub / 管理驾驶舱

**Version:** 1.0  
**Date:** 2026-07-08  
**Status:** Draft for replication  
**Target System:** Competitive-intelligence and management-cockpit web application

---

## 1. Executive Summary

China Intelligence & Insights Hub (Chinese brand name: 管理驾驶舱, “Management Cockpit”) is a bilingual (Chinese / English), role-aware web platform that aggregates external business/news signals, classifies them by industry taxonomy, and surfaces competitive-intelligence to energy-sector analysts and decision makers.

The product is delivered as a **portal** with an authentication gateway and a **cockpit** containing multiple configurable plates/modules. The only module visible to the audited account is **Insights → Competitive Intelligence**, which is the focus of this PRD. The platform also exposes optional capabilities (home dashboard, content analysis, competitor tracking, AI knowledge, market insight, etc.) gated by site configuration and user permissions.

---

## 2. Product Vision & Goals

| Goal | Description |
|------|-------------|
| G1 | Centralize external market signals (news, WeChat articles, press releases) for China energy/transition sectors. |
| G2 | Classify content automatically with a hierarchical taxonomy (business domain, enterprise type, source). |
| G3 | Provide AI-powered interpretation of individual articles via an LLM side-panel. |
| G4 | Support bilingual content and UI (Simplified Chinese + English). |
| G5 | Offer a configurable, multi-site cockpit framework so different tenants/sites can enable different modules. |
| G6 | Ensure enterprise-grade access control, watermarking, audit logging, and monitoring. |

---

## 3. Target Users & Personas

1. **Industry Analyst (Primary)** – reads competitive intelligence, filters by sector, uses AI interpretation to summarize articles.
2. **Strategy Manager** – tracks M&A, partnerships, and energy-transition signals across SOEs and private players.
3. **Tenant Admin** – configures which plates/modules are enabled for a site, manages users, uploads branding assets.
4. **Content Curator / Operator** – maintains the taxonomy, keyword filters, and news sources.

---

## 4. Core User Flows

### 4.1 Login
1. User lands on `https://<host>/portal/auth/login?redirectURI=<target>`.
2. Login page shows tenant branding (logo, background image), account/password fields, “Remember account”, “Forgot password”, and login button.
3. On success, backend sets session cookies and redirects to the requested cockpit URL.
4. Unauthenticated access to cockpit routes is redirected back to login.

### 4.2 Browse Competitive Intelligence
1. Authenticated user enters `/cockpit/solar/pc/plate?plate_id=insight&site_id=1&tab_id=6`.
2. System loads site configuration, plates, user info, i18n strings, and news tab/filter definitions.
3. User sees filter bar (Date, Business, Enterprise Type, Source, keyword search) and a paginated card grid.
4. User changes filters; frontend calls `/llm/api/v1/news/list` with the filter payload.
5. Cards re-render with new results.

### 4.3 AI Interpretation
1. User clicks “AI Interpretation” on a news card.
2. A modal/disclaimer “AI usage guidelines” is shown on first use; user must acknowledge.
3. A right-side drawer opens titled “AI Interpretation - <article title>”.
4. System streams an LLM-generated summary; user can ask follow-up questions in a chat input.
5. User can stop generation and close the drawer.

### 4.4 Language Switch
1. User toggles between 中 / EN in the top navigation bar.
2. UI text and content switch to the selected locale (content is pre-translated; UI strings come from `/polyglot/<locale>`).

---

## 5. Functional Requirements

### 5.1 Authentication & Identity (FR-AUTH)

| ID | Requirement |
|----|-------------|
| AUTH-1 | Support username/password login via `/minibase/portal/api/v1/user/login`. |
| AUTH-2 | Support session cookie / token-based authentication; subsequent API calls carry credentials automatically. |
| AUTH-3 | Provide CSRF token (`<input name="csrf_token" value="guest">` on login page; real token after login). |
| AUTH-4 | Expose `/userinfo` returning user id, account, username, avatar, department, admin flags, bind-device flag. |
| AUTH-5 | Support “remember account” on the login form (client-side storage of username only). |
| AUTH-6 | Support “forgot password” link (exact flow not observed; placeholder or email/reset integration). |
| AUTH-7 | Integrate with optional passport services (Feishu, minibase configurable via `feature_passport_service`). |

### 5.2 Portal & Cockpit Framework (FR-PORTAL)

| ID | Requirement |
|----|-------------|
| PORTAL-1 | Provide a top-level portal shell with tenant logo, app title, language switch, notification bell, stock indicator dropdown, and user avatar. |
| PORTAL-2 | Provide a top horizontal navigation menu (Arco Design style) showing enabled top-level modules (e.g., “Insights”). |
| PORTAL-3 | Provide a left vertical side menu showing selected module sub-items (e.g., “Competitive Intelligence”). |
| PORTAL-4 | Support breadcrumbs or section headers (“管理驾驶舱 > Insights”). |
| PORTAL-5 | Render a configurable home dashboard when user navigates to `/pc/home`; show permission-empty state if user lacks data access. |
| PORTAL-6 | Allow per-site configuration of enabled plates, bottom tabs, AI bars, board bars, and content-insight sub-bars. |
| PORTAL-7 | Apply global watermark based on `window.__CUSTOMIZED__.watermark`. |

### 5.3 Competitive Intelligence Plate (FR-CI)

| ID | Requirement |
|----|-------------|
| CI-1 | Display plate title “Competitive Intelligence” with filter bar. |
| CI-2 | Filter bar: Date range selector (Yesterday, Last 3/7/30/90/180/365 Days), Business domain cascade selector, Enterprise Type cascade selector, Source selector, keyword search input. |
| CI-3 | Default filter: Last 180 Days, Business = All, Enterprise Type = All, Source = All. |
| CI-4 | Render results as a responsive card grid (3 columns on desktop). |
| CI-5 | Each card shows: title, publish date, source type, category tags, summary excerpt (truncated), entity/keyword chips, and an “AI Interpretation” action. |
| CI-6 | Clicking a card title opens the original article URL (external link). |
| CI-7 | Support pagination: page + page_size parameters (default page_size = 12). |
| CI-8 | Support collecting/hiding articles (API fields `is_collect`, `is_hide` on news items). |
| CI-9 | Support per-card action menu (three-dot icon) for additional options. |

### 5.4 AI Interpretation (FR-AI)

| ID | Requirement |
|----|-------------|
| AI-1 | Show legal/disclaimer modal on first use covering IP, confidentiality, and liability risks. |
| AI-2 | Open a right-side drawer with article context loaded. |
| AI-3 | Provide a one-click “Interpretate [title]” action that streams a generated summary. |
| AI-4 | Display loading state (“Generating for you…”) and a stop button. |
| AI-5 | Allow free-form follow-up questions in a chat input at the bottom of the drawer. |
| AI-6 | Attribute output to the configured LLM (e.g., “Q & A results are generated by the 豆包 large model”). |
| AI-7 | Integrate with backend LLM/RAG service endpoint (observed under `/llm/api/v1/` namespace; exact interpretation endpoint to be implemented). |

### 5.5 Internationalization (FR-I18N)

| ID | Requirement |
|----|-------------|
| I18N-1 | UI strings must be translatable; load locale packs from `/solarbe/api/v1/polyglot/<locale>`. |
| I18N-2 | Supported locales: `zh_CN` and `en_US`. |
| I18N-3 | News content must be bilingual: each article stores `zh_cn` and `en_us` objects. |
| I18N-4 | Filters display both `display_name` and `display_en_name`. |
| I18N-5 | Language toggle persists per session and reloads polyglot + content. |

### 5.6 Notifications & Comments (FR-NOTIF)

| ID | Requirement |
|----|-------------|
| NOTIF-1 | Notification bell in header with unread count from `/operations/messages/user/my` and `/operations/messages/comment/my/count`. |
| NOTIF-2 | Comment/IM integration for article discussions (`feature_comment_im`, `feature_comment_my_comments`). |
| NOTIF-3 | Global fuzzy user search (`/auth/users/global_fuzzy_search`) for @-mentions and sharing. |

### 5.7 Favorites (FR-FAV)

| ID | Requirement |
|----|-------------|
| FAV-1 | Provide a “收藏” (Favorites) plate for saved/collect content. |
| FAV-2 | Favorites plate is configurable per user and persisted in backend. |

---

## 6. Information Architecture

```
Portal (/)  →  Auth (/portal/auth/login)
            →  Cockpit (/cockpit/solar/pc/...)
                  ├── Home (/pc/home)
                  ├── Plate (/pc/plate?plate_id=<id>&site_id=<id>&tab_id=<id>)
                  │       └── insight → Competitive Intelligence
                  ├── Favorites (/pc/plate?plate_id=favorite)
                  └── (other configurable plates: analysis, competitor, hot, new_product, news, portal)
```

### 6.1 Site / Tenant Configuration

Each site has:
- `site_id`, `site_name`, list of admins.
- `site_conf` feature map (JSON) enabling/disabling bars and sub-bars.
- `bottom_tabs` for mobile/bottom navigation.
- Max site limit (`max_site_num`).

### 6.2 News Tab Configuration

- Tabs are defined per plate/tab_id (e.g., tab_id = 6).
- Each tab has: `tab_type`, `tab_conf` (AI feature class enable, AI filter rules), and a list of keyword exclusion rules for content filtering.

### 6.3 Filter Taxonomy

Hierarchical taxonomy stored server-side:

1. **业务领域 (Business)**
   - 常规业务 (Conventional)
     - 移动出行 (Mobility)
     - 润滑油 (Lubricant)
     - 化工 (Chemicals)
   - 能源转型 (Energy Transition)
     - 生物燃料 (Biofuel)
     - 电力/氢能 (Power/Hydrogen)
     - LNG/天然气 (LNG/Gas)
     - CCS
   - 收并购/合作伙伴 (Inorganic/Partnership)
     - 收并购 (M&A)
     - 战略合作 (Partnership)

2. **企业类型 (Enterprise Type)**
   - 国有企业 (SOEs)
     - 中石油 / PetroChina, 中石化 / Sinopec, 中海油 / CNOOC, 国家能源集团, 中航油, 三峡, etc.
   - (other enterprise categories observed but truncated)

3. **来源 (Source)** – source type filter (e.g., WeChat Official Account, news portals).

---

## 7. UI/UX Requirements

### 7.1 Visual Design

- **Primary font:** PingFang SC, Helvetica, Arial, Microsoft YaHei, sans-serif.
- **Numeric font:** D-DIN / D-DIN-Bold (loaded via `@font-face`).
- **Color palette:** Blue primary (`#5d78f2`), dark text (`#2f2f3f`), light gray background (`#f8f8fc`).
- **Layout:** fixed top header, left sidebar, main content area; minimum width 1280px.
- **Login page:** full-bleed scenic background image, centered white card, tenant logo top-left.
- **Card grid:** 3-column responsive grid, white cards with subtle shadow, rounded corners.
- **Empty / no-permission states:** centered illustration + message + list of admins + refresh link.

### 7.2 Component Libraries

- Ant Design (antd) for forms, buttons, selects, spinners, layout.
- Arco Design for menus (horizontal top nav, vertical side nav) and modals.
- VTable styles observed (future table-intensive plates).
- Custom CSS modules for layout shells (hashed class names).

### 7.3 Interactions

- Filters update results asynchronously without full page reload.
- AI drawer slides in from the right, overlays main content, dimmed backdrop.
- Pagination loads next page on page change.
- Language switch is instant for UI; content may refetch for localized summaries.

### 7.4 Accessibility

- Minimum 1280px desktop support; not mobile-first (viewport meta allows scalable).
- Visible focus states on interactive elements.
- Modal traps focus while open.

---

## 8. Data Requirements

### 8.1 News Article Entity

```json
{
  "id": 11649,
  "tab_id": 6,
  "uid": "a2629cc526800c33425cca1437dbd660",
  "is_collect": false,
  "is_hide": false,
  "zh_cn": {
    "title": "...",
    "summary": "...",
    "display_summary": "",
    "url": "...",
    "publish_time": "2026年7月7日",
    "keywords": "...",
    "source_type": "微信公众号",
    "features": ["化工"]
  },
  "en_us": {
    "title": "...",
    "summary": "...",
    "publish_time": "2026-07-07",
    "keywords": "...",
    "source_type": "WeChat Official Account",
    "features": ["Chemicals"]
  }
}
```

### 8.2 Filter Value Encoding

- Date filter values encoded as relative timestamp ranges: `"<base_ts>,day,<offset_start>,<offset_end>"`.
- Feature filters use tree node ids and boolean `exclude` flags.

### 8.3 Audit & Telemetry

- Frontend monitoring endpoint (`/minibase/monitor/fronted/monitor_browser/collect`) collects performance/errors.
- Browser settings fetched from `/minibase/monitor/fronted/settings/get/web`.

---

## 9. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF-1 | **Performance:** initial page load < 3s; filter API response < 1s on LAN. |
| NF-2 | **Scalability:** support up to 20 sites per tenant (`max_site_num`). |
| NF-3 | **Security:** HTTPS (with custom/self-signed cert support), HSTS headers, CSRF tokens, session cookies. |
| NF-4 | **Privacy:** watermark user identity; AI disclaimer before LLM use; sensitive-keyword audit option. |
| NF-5 | **Reliability:** graceful empty states; retry/refresh on permission errors. |
| NF-6 | **Maintainability:** feature flags for ~30 capabilities; per-site configuration without code deploy. |
| NF-7 | **Browser support:** modern Chromium/Chrome, Edge, Safari; no IE11. |
| NF-8 | **i18n completeness:** all user-facing strings externalized. |

---

## 10. Feature Flags & Configuration

Key flags observed in `/console/api/v1/config`:

| Flag | State in Audit | Purpose |
|------|----------------|---------|
| feature_ai_service | on | Master AI service switch. |
| feature_ai_intel_mode | on | AI interpretation mode. |
| feature_ai_intel_query | on | AI Q&A chat in drawer. |
| feature_content_insight_service | on | Content insight plate available. |
| feature_market_insight_service | on | Market insight features. |
| feature_abnormal_service | on | Data abnormal detection. |
| feature_international | on | CN/EN bilingual support. |
| feature_image_service | minio | Image storage backend. |
| feature_passport_service | minibase | Identity provider. |
| feature_comment_im | on | Comment/IM integration. |
| feature_metric_push_service | on | Metric push capability. |

Site-level `site_conf` controls sub-bar visibility:
- `content_insight.sub_bar.analysis`, `.competitor`, `.hot`, `.insight`, `.new_product`, `.news`, `.portal`
- `home_bar.competitor_insight`, `.data_abnormal`, `.strategic_objectives`
- `ai_bar`, `ai_sub_bar.book|intent|smart_data`, `board_bar`

---

## 11. Success Metrics

- **Engagement:** daily active users, articles read per session, AI interpretation usage rate.
- **Coverage:** number of articles ingested per day, taxonomy classification accuracy.
- **Performance:** average API latency, page load time, error rate.
- **Adoption:** % of enabled sites actively using Competitive Intelligence plate.

---

## 12. Open Questions / Assumptions

1. Article ingestion pipeline (crawlers, RSS, WeChat monitoring) is assumed to exist outside the audited scope; this PRD focuses on the consumption UI and its APIs.
2. LLM interpretation endpoint details are not fully observed; assumed to accept `{article_id, question, locale}` and stream text.
3. Admin/console UI for taxonomy and site configuration was not accessible; described based on API responses.
4. Exact permission model (RBAC vs. data-scope) not fully visible; assume role + site-based access.

---

## 13. Appendices

### A. Screenshots Captured During Audit
- `01_login_page.png` – branded login screen
- `02_after_login.png` / `dashboard_insight.png` – Competitive Intelligence grid
- `ai_guidelines.png` – AI usage disclaimer modal
- `ai_interpret_result2.png` – AI interpretation side drawer
- `home_page.png` – no-data-resource permission empty state

### B. Reversed API Summary
See EDD Section 7 for full API list.
