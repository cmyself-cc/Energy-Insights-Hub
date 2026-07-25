# 用户反馈驱动的语义过滤增强功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 insight card 的收藏/隐藏操作升级为训练信号，通过本地关键词相似度即时影响未来 tracker 抓取，并周期性由 LLM 生成可确认的过滤规则建议。

**Architecture:** 新增三张表（`user_feedback`、`feedback_semantic_weights`、`feedback_rules_suggestions`）记录反馈与权重；在 tracker 入库前增加 `applyUserFeedbackScore` 软过滤层；前端隐藏按钮增加原因选择，配置页新增"我的反馈"标签页用于查看统计与审批 LLM 建议。

**Tech Stack:** Node.js / Express / better-sqlite3 / React / Vite

## Global Constraints

- 所有后端代码使用 ES modules（`import`/`export`）。
- 所有数据库 JSON 字段使用 `JSON.stringify`/`JSON.parse` 读写。
- 数据库迁移文件放在 `server/migrations/`，命名格式 `###_description.sql`。
- 后端服务文件放在 `server/services/`；路由放在 `server/routes/`。
- 前端组件放在 `src/components/`；API 封装放在 `src/utils/backendApi.js`。
- 不引入新依赖，优先使用现有技术栈。
- 用户反馈只影响未来 tracker 抓取，不追溯处理当前 insights 池子。
- 相似度计算使用本地关键词匹配，不调用 embedding API。
- LLM 生成的规则建议必须经过用户确认后才写入 `filter_rules`。

---

## File Structure

| 文件 | 用途 |
|------|------|
| `server/migrations/013_user_feedback.sql` | 创建 `user_feedback`、`feedback_rules_suggestions`、`feedback_semantic_weights` 表 |
| `server/services/feedbackService.js` | 记录反馈、更新语义权重、查询反馈统计 |
| `server/services/feedbackWeights.js` | 计算 insight 与反馈权重的相似度得分，提供 `applyUserFeedbackScore` |
| `server/services/feedbackSuggestionGenerator.js` | 调用 LLM 分析反馈并生成规则建议 |
| `server/routes/feedback.js` | 反馈相关 REST API |
| `server/routes/insights.js` | 修改 `POST /insights/:id/hide` 以支持原因参数 |
| `server/services/tracker.js` | 在入库前调用 `applyUserFeedbackScore` |
| `src/components/CardActions.jsx` | 隐藏按钮改为原因选择弹窗 |
| `src/components/FeedbackPage.jsx` | 配置页"我的反馈"标签页 |
| `src/components/ConfigurationPage.jsx` | 新增 feedback tab |
| `src/utils/backendApi.js` | 新增 feedback API 封装 |
| `server/services/feedbackWeights.test.js` | 权重计算单元测试 |
| `server/services/feedbackService.test.js` | 反馈服务单元测试 |

---

## Task 1: Database Migration

**Files:**
- Create: `server/migrations/013_user_feedback.sql`

**Interfaces:**
- Produces: three new tables with schemas defined in the approved design.

- [ ] **Step 1: Write migration file**

Create `server/migrations/013_user_feedback.sql`:

```sql
CREATE TABLE IF NOT EXISTS user_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insight_id INTEGER REFERENCES insights(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('bookmark', 'hide')),
  reason TEXT CHECK(reason IN ('irrelevant', 'duplicate', 'low_quality', 'not_now', NULL)),
  title TEXT,
  summary TEXT,
  keywords TEXT,
  purposes TEXT,
  categories TEXT,
  source_type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_action ON user_feedback(action);
CREATE INDEX IF NOT EXISTS idx_user_feedback_reason ON user_feedback(reason);
CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at ON user_feedback(created_at);

CREATE TABLE IF NOT EXISTS feedback_rules_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('enterprise', 'include_keyword', 'exclude_keyword')),
  name TEXT NOT NULL,
  purpose TEXT DEFAULT '',
  reason TEXT,
  evidence TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_feedback_suggestions_status ON feedback_rules_suggestions(status);

CREATE TABLE IF NOT EXISTS feedback_semantic_weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,
  term_type TEXT NOT NULL CHECK(term_type IN ('keyword', 'entity', 'category')),
  action TEXT NOT NULL CHECK(action IN ('boost', 'suppress')),
  reason_category TEXT,
  score REAL NOT NULL DEFAULT 0,
  feedback_count INTEGER DEFAULT 1,
  last_feedback_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_weights_term_action ON feedback_semantic_weights(term, action);
```

- [ ] **Step 2: Verify migration applies cleanly**

Run:
```bash
cd "/Users/cmyself/Live Projects/Energy Insights Hub"
npm run dev:server &
SERVER_PID=$!
sleep 3
sqlite3 data/energy_insights.db ".tables" | grep -E "user_feedback|feedback_rules_suggestions|feedback_semantic_weights"
kill $SERVER_PID
```

Expected output: three table names listed.

- [ ] **Step 3: Commit**

```bash
git add server/migrations/013_user_feedback.sql
git commit -m "feat(feedback): add user feedback tables"
```

---

## Task 2: Feedback Service

**Files:**
- Create: `server/services/feedbackService.js`
- Create: `server/services/feedbackService.test.js`

**Interfaces:**
- Produces:
  - `recordFeedback({ insightId, action, reason }) -> { id }`
  - `getFeedbackStats(days) -> { total, bookmarks, hides, byReason: {} }`
  - `getRecentFeedback(limit) -> Array<feedback>`

- [ ] **Step 1: Write failing test**

Create `server/services/feedbackService.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import db from "../db.js";
import { recordFeedback, getFeedbackStats } from "./feedbackService.js";

describe("feedbackService", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM user_feedback").run();
    db.prepare("DELETE FROM feedback_semantic_weights").run();
    db.prepare("DELETE FROM insights").run();
    db.prepare("INSERT INTO insights (title, summary, keywords, purpose) VALUES (?, ?, ?, ?)")
      .run("Test Insight", "Summary", '["宁德时代", "储能"]','["competitor"]');
  });

  afterEach(() => {
    db.prepare("DELETE FROM user_feedback").run();
    db.prepare("DELETE FROM feedback_semantic_weights").run();
    db.prepare("DELETE FROM insights").run();
  });

  it("records bookmark and creates boost weights", () => {
    const insight = db.prepare("SELECT * FROM insights WHERE title = ?").get("Test Insight");
    const result = recordFeedback({ insightId: insight.id, action: "bookmark" });
    expect(result.id).toBeDefined();

    const weights = db.prepare("SELECT * FROM feedback_semantic_weights WHERE action = 'boost'").all();
    expect(weights.length).toBe(2);
    expect(weights.map(w => w.term)).toContain("宁德时代");
  });

  it("records hide with irrelevant reason and creates suppress weights", () => {
    const insight = db.prepare("SELECT * FROM insights WHERE title = ?").get("Test Insight");
    recordFeedback({ insightId: insight.id, action: "hide", reason: "irrelevant" });
    const weights = db.prepare("SELECT * FROM feedback_semantic_weights WHERE action = 'suppress'").all();
    expect(weights.length).toBe(2);
  });

  it("returns stats", () => {
    const insight = db.prepare("SELECT * FROM insights WHERE title = ?").get("Test Insight");
    recordFeedback({ insightId: insight.id, action: "bookmark" });
    recordFeedback({ insightId: insight.id, action: "hide", reason: "duplicate" });
    const stats = getFeedbackStats(7);
    expect(stats.total).toBe(2);
    expect(stats.bookmarks).toBe(1);
    expect(stats.hides).toBe(1);
    expect(stats.byReason.duplicate).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "/Users/cmyself/Live Projects/Energy Insights Hub"
npx vitest run server/services/feedbackService.test.js
```

Expected: FAIL with "function not defined" or module not found.

- [ ] **Step 3: Implement feedbackService**

Create `server/services/feedbackService.js`:

```javascript
import db from "../db.js";

function safeJson(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function snapshotInsight(insightId) {
  const row = db.prepare("SELECT * FROM insights WHERE id = ?").get(insightId);
  if (!row) return null;
  return {
    title: row.title,
    summary: row.summary,
    keywords: safeJson(row.keywords),
    purposes: safeJson(row.purpose),
    categories: safeJson(row.categories),
    sourceType: row.source_type
  };
}

function updateWeight(term, action, reasonCategory) {
  const existing = db.prepare("SELECT * FROM feedback_semantic_weights WHERE term = ? AND action = ?").get(term, action);
  if (existing) {
    db.prepare(
      "UPDATE feedback_semantic_weights SET score = score + 1, feedback_count = feedback_count + 1, last_feedback_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(existing.id);
  } else {
    db.prepare(
      "INSERT INTO feedback_semantic_weights (term, term_type, action, reason_category, score) VALUES (?, 'keyword', ?, ?, 1)"
    ).run(term, action, reasonCategory || null);
  }
}

function updateWeightsFromFeedback(feedback) {
  const terms = feedback.keywords || [];
  if (feedback.action === "bookmark") {
    for (const term of terms) updateWeight(term, "boost", null);
    return;
  }
  if (feedback.action === "hide" && ["irrelevant", "low_quality"].includes(feedback.reason)) {
    for (const term of terms) updateWeight(term, "suppress", feedback.reason);
  }
}

export function recordFeedback({ insightId, action, reason }) {
  const insight = snapshotInsight(insightId);
  if (!insight) throw new Error("Insight not found");

  const result = db.prepare(
    "INSERT INTO user_feedback (insight_id, action, reason, title, summary, keywords, purposes, categories, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    insightId,
    action,
    reason || null,
    insight.title,
    insight.summary,
    JSON.stringify(insight.keywords),
    JSON.stringify(insight.purposes),
    JSON.stringify(insight.categories),
    insight.sourceType
  );

  const feedback = {
    id: result.lastInsertRowid,
    insightId,
    action,
    reason: reason || null,
    keywords: insight.keywords
  };
  updateWeightsFromFeedback(feedback);
  return feedback;
}

export function getFeedbackStats(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare("SELECT action, reason FROM user_feedback WHERE created_at >= ?").all(cutoff);
  const stats = { total: rows.length, bookmarks: 0, hides: 0, byReason: {} };
  for (const row of rows) {
    if (row.action === "bookmark") stats.bookmarks++;
    if (row.action === "hide") {
      stats.hides++;
      const reason = row.reason || "unknown";
      stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;
    }
  }
  return stats;
}

export function getRecentFeedback(limit = 50) {
  return db.prepare("SELECT * FROM user_feedback ORDER BY created_at DESC LIMIT ?").all(limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run server/services/feedbackService.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/feedbackService.js server/services/feedbackService.test.js
git commit -m "feat(feedback): add feedback recording and stats service"
```

---

## Task 3: Feedback Weights Scoring

**Files:**
- Create: `server/services/feedbackWeights.js`
- Create: `server/services/feedbackWeights.test.js`

**Interfaces:**
- Produces:
  - `applyUserFeedbackScore(items, options) -> { kept, dropped, scores }`
  - `loadSemanticWeights() -> { boost: Array<{term, score}>, suppress: Array<{term, score}> }`

- [ ] **Step 1: Write failing test**

Create `server/services/feedbackWeights.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import { applyUserFeedbackScore, loadSemanticWeights } from "./feedbackWeights.js";

describe("feedbackWeights", () => {
  it("loads empty weights when none exist", () => {
    const weights = loadSemanticWeights();
    expect(weights.boost).toEqual([]);
    expect(weights.suppress).toEqual([]);
  });

  it("drops item when suppress keywords match above threshold", () => {
    const weights = {
      boost: [],
      suppress: [{ term: "股价", score: 2 }, { term: "涨停", score: 1 }]
    };
    const items = [
      { title: "某公司股价大涨", summary: "今日涨停", keywords: ["股价", "涨停"] }
    ];
    const result = applyUserFeedbackScore(items, { weights, suppressThreshold: 1.5 });
    expect(result.kept.length).toBe(0);
    expect(result.dropped.length).toBe(1);
  });

  it("keeps item when no threshold crossed", () => {
    const weights = {
      boost: [{ term: "宁德时代", score: 1 }],
      suppress: [{ term: "股价", score: 1 }]
    };
    const items = [
      { title: "宁德时代储能项目", summary: "", keywords: ["宁德时代", "储能"] }
    ];
    const result = applyUserFeedbackScore(items, { weights, suppressThreshold: 2, boostThreshold: 2 });
    expect(result.kept.length).toBe(1);
    expect(result.dropped.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run server/services/feedbackWeights.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement feedbackWeights**

Create `server/services/feedbackWeights.js`:

```javascript
import db from "../db.js";

export function loadSemanticWeights() {
  const rows = db.prepare("SELECT term, action, score FROM feedback_semantic_weights").all();
  const boost = [];
  const suppress = [];
  for (const row of rows) {
    const entry = { term: row.term, score: row.score };
    if (row.action === "boost") boost.push(entry);
    else suppress.push(entry);
  }
  return { boost, suppress };
}

function normalizeText(item) {
  const parts = [
    item.title || "",
    item.summary || "",
    ...(Array.isArray(item.keywords) ? item.keywords : [])
  ];
  return parts.join(" ").toLowerCase();
}

function scoreItem(item, weights) {
  const text = normalizeText(item);
  let boostScore = 0;
  let suppressScore = 0;
  for (const { term, score } of weights.boost) {
    if (text.includes(term.toLowerCase())) boostScore += score;
  }
  for (const { term, score } of weights.suppress) {
    if (text.includes(term.toLowerCase())) suppressScore += score;
  }
  return { boostScore, suppressScore };
}

export function applyUserFeedbackScore(items, options = {}) {
  const weights = options.weights || loadSemanticWeights();
  const suppressThreshold = options.suppressThreshold ?? 2;
  const boostThreshold = options.boostThreshold ?? 2;

  const kept = [];
  const dropped = [];
  const scores = [];

  for (const item of items) {
    const { boostScore, suppressScore } = scoreItem(item, weights);
    scores.push({ title: item.title, boostScore, suppressScore });

    if (suppressScore >= suppressThreshold) {
      dropped.push({ ...item, feedbackReason: "suppress_match", boostScore, suppressScore });
      continue;
    }
    kept.push({ ...item, boostScore, suppressScore, boosted: boostScore >= boostThreshold });
  }

  return { kept, dropped, scores };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run server/services/feedbackWeights.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/feedbackWeights.js server/services/feedbackWeights.test.js
git commit -m "feat(feedback): add semantic weight scoring for tracker"
```

---

## Task 4: Integrate Scoring into Tracker

**Files:**
- Modify: `server/services/tracker.js`

**Interfaces:**
- Consumes: `applyUserFeedbackScore` from `server/services/feedbackWeights.js`

- [ ] **Step 1: Import and integrate**

Modify `server/services/tracker.js`:

```javascript
import { applyUserFeedbackScore, loadSemanticWeights } from "./feedbackWeights.js";
```

After the existing `applyPostFilter` block and before the `if (kept.length > 0)` insert block, add:

```javascript
const semanticWeights = loadSemanticWeights();
const hasWeights = semanticWeights.boost.length > 0 || semanticWeights.suppress.length > 0;
if (hasWeights) {
  const scored = applyUserFeedbackScore(kept, { weights: semanticWeights });
  console.log(`[tracker] Source ${source.name}: ${scored.dropped.length} dropped by feedback weights, ${scored.kept.length} kept`);
  kept = scored.kept;
}
```

- [ ] **Step 2: Verify tracker still runs**

Run:
```bash
cd "/Users/cmyself/Live Projects/Energy Insights Hub"
npm run test -- server/routes/tracker.test.js
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/services/tracker.js
git commit -m "feat(feedback): apply semantic weights in tracker pipeline"
```

---

## Task 5: Feedback REST API

**Files:**
- Create: `server/routes/feedback.js`
- Modify: `server/index.js`

**Interfaces:**
- Produces:
  - `POST /feedback` body `{ insightId, action, reason }`
  - `GET /feedback/stats`
  - `GET /feedback/suggestions`
  - `POST /feedback/suggestions/:id/accept`
  - `POST /feedback/suggestions/:id/reject`
  - `POST /feedback/generate-suggestions`

- [ ] **Step 1: Create feedback route**

Create `server/routes/feedback.js`:

```javascript
import { Router } from "express";
import db from "../db.js";
import { recordFeedback, getFeedbackStats } from "../services/feedbackService.js";

const router = Router();

router.post("/", (req, res) => {
  try {
    const { insightId, action, reason } = req.body;
    if (!insightId || !action) {
      return res.status(400).json({ error: "insightId and action are required" });
    }
    const feedback = recordFeedback({ insightId, action, reason });
    res.json({ data: feedback });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/stats", (_req, res) => {
  try {
    const stats = getFeedbackStats(30);
    res.json({ data: stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/suggestions", (_req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM feedback_rules_suggestions ORDER BY created_at DESC").all();
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/suggestions/:id/accept", (req, res) => {
  try {
    const suggestion = db.prepare("SELECT * FROM feedback_rules_suggestions WHERE id = ?").get(req.params.id);
    if (!suggestion) return res.status(404).json({ error: "Suggestion not found" });

    db.prepare(
      "INSERT INTO filter_rules (type, name, active, priority, purpose) VALUES (?, ?, 1, 0, ?)"
    ).run(suggestion.type, suggestion.name, suggestion.purpose || "");

    db.prepare(
      "UPDATE feedback_rules_suggestions SET status = 'accepted', decided_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(req.params.id);

    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/suggestions/:id/reject", (req, res) => {
  try {
    db.prepare(
      "UPDATE feedback_rules_suggestions SET status = 'rejected', decided_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(req.params.id);
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
```

- [ ] **Step 2: Register route in server**

Modify `server/index.js` to import and register:

```javascript
import feedbackRoutes from "./routes/feedback.js";
```

And add:

```javascript
app.use("/api/feedback", feedbackRoutes);
```

- [ ] **Step 3: Keep insights hide endpoint minimal**

`POST /:id/hide` remains responsible only for setting `hidden = 1`. Feedback recording is handled explicitly by the frontend via `POST /api/feedback`.

No changes needed to `server/routes/insights.js` for this feature.

- [ ] **Step 4: Verify API**

Run:
```bash
cd "/Users/cmyself/Live Projects/Energy Insights Hub"
npm run dev:server &
SERVER_PID=$!
sleep 3
curl -s -X POST http://localhost:3001/api/feedback -H "Content-Type: application/json" -d '{"insightId":1,"action":"bookmark"}' | head -c 200
kill $SERVER_PID
```

Expected: JSON response with `data.id`.

- [ ] **Step 5: Commit**

```bash
git add server/routes/feedback.js server/index.js
git commit -m "feat(feedback): add feedback REST API"
```

---

## Task 6: Frontend CardActions Hide Reason

**Files:**
- Modify: `src/components/CardActions.jsx`

**Interfaces:**
- Consumes: existing `onHide` prop; now calls `onHide(reason)`.

- [ ] **Step 1: Add reason selection modal**

Replace the hide menu item in `CardActions.jsx` with a two-step flow:

```jsx
const HIDE_REASONS = [
  { key: "irrelevant", label: { zh: "不相关", en: "Irrelevant" } },
  { key: "duplicate", label: { zh: "重复/已看过", en: "Duplicate / Seen" } },
  { key: "low_quality", label: { zh: "质量差", en: "Low quality" } },
  { key: "not_now", label: { zh: "暂时不感兴趣", en: "Not now" } }
];

export default function CardActions({ darkMode, language, bookmarked, onBookmark, onHide, itemUrl }) {
  const t = i18n[language];
  const [open, setOpen] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const ref = useRef(null);

  // ... existing click-outside handler ...

  const startHide = (e) => {
    e.stopPropagation();
    setOpen(false);
    setShowReason(true);
  };

  const confirmHide = (reason) => {
    onHide(reason);
    setShowReason(false);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* existing trigger button */}
      {open && (
        <div style={{ /* existing menu style */ }}>
          <button onClick={(e) => { e.stopPropagation(); onBookmark(); setOpen(false); }} style={menuItemStyle}>
            {bookmarked ? t.competitiveIntelligence.removeBookmark : t.competitiveIntelligence.bookmark}
          </button>
          {itemUrl && (
            <a href={itemUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.stopPropagation(); setOpen(false); }} style={{ ...menuItemStyle, textDecoration: "none", display: "block" }}>
              {t.competitiveIntelligence.viewOriginal}
            </a>
          )}
          <button onClick={startHide} style={menuItemStyle}>
            {t.competitiveIntelligence.hide}
          </button>
        </div>
      )}

      {showReason && (
        <div style={{
          position: "absolute",
          top: 32,
          right: 0,
          minWidth: 180,
          background: darkMode ? COLORS.background.cardDark : "#fff",
          border: `1px solid ${darkMode ? COLORS.border.dark : COLORS.border.light}`,
          borderRadius: BORDER_RADIUS.md,
          boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
          zIndex: 25,
          padding: "8px 0"
        }}>
          <div style={{ padding: "8px 14px", fontSize: FONT_SIZES.sm, color: darkMode ? "#aaa" : COLORS.text.light }}>
            {language === "zh" ? "为什么隐藏？" : "Why hide?"}
          </div>
          {HIDE_REASONS.map(r => (
            <button
              key={r.key}
              onClick={(e) => { e.stopPropagation(); confirmHide(r.key); }}
              style={menuItemStyle}
            >
              {r.label[language] || r.label.en}
            </button>
          ))}
          <button onClick={(e) => { e.stopPropagation(); setShowReason(false); }} style={menuItemStyle}>
            {language === "zh" ? "取消" : "Cancel"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire hide reason through IntelligencePage and App**

Modify `src/components/IntelligencePage.jsx` to pass reason into `onHide`:

```jsx
onHide={(reason) => { onHide(item, reason); }}
```

Modify `src/App.jsx` `hideItem` to accept reason and record feedback:

```javascript
const hideItem = async (item, reason) => {
  try {
    if (item.id) {
      await backendApi.hideInsight(item.id);
      if (reason) {
        await backendApi.recordFeedback(item.id, "hide", reason);
      }
    }
    const newHidden = [...hidden, item.title];
    setHidden(newHidden);
    addToast(language === "zh" ? "已隐藏该文章" : "Article hidden", "info");
  } catch (e) {
    console.error("Hide failed:", e);
    addToast(language === "zh" ? "隐藏失败" : "Hide failed", "error");
  }
};
```

Also add bookmark feedback: modify `toggleBookmark` to call `backendApi.recordFeedback` when adding a bookmark:

```javascript
const toggleBookmark = async (item) => {
  const adding = !bookmarks.find(b => b.title === item.title);
  const newBookmarks = adding
    ? [...bookmarks, item]
    : bookmarks.filter(b => b.title !== item.title);
  setBookmarks(newBookmarks);
  storage.saveBookmarks(newBookmarks);
  if (adding && item.id) {
    try { await backendApi.recordFeedback(item.id, "bookmark"); } catch (e) { console.error("Bookmark feedback failed:", e); }
  }
  addToast(newBookmarks.length > bookmarks.length ? t.toasts.addedToBookmarks : t.toasts.removedFromBookmarks, "success");
};
```

- [ ] **Step 3: Verify build**

Run:
```bash
cd "/Users/cmyself/Live Projects/Energy Insights Hub"
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/CardActions.jsx
git commit -m "feat(feedback): add hide reason selection in card actions"
```

---

## Task 7: Frontend Feedback Page

**Files:**
- Create: `src/components/FeedbackPage.jsx`
- Modify: `src/components/ConfigurationPage.jsx`
- Modify: `src/utils/backendApi.js`

**Interfaces:**
- Produces: `FeedbackPage` component rendered inside ConfigurationPage.
- Consumes: backendApi feedback methods.

- [ ] **Step 1: Add backendApi methods**

Modify `src/utils/backendApi.js`:

```javascript
recordFeedback: (insightId, action, reason) => request("/feedback", {
  method: "POST",
  body: JSON.stringify({ insightId, action, reason })
}),
getFeedbackStats: () => request("/feedback/stats"),
getFeedbackSuggestions: () => request("/feedback/suggestions"),
acceptFeedbackSuggestion: (id) => request(`/feedback/suggestions/${id}/accept`, { method: "POST" }),
rejectFeedbackSuggestion: (id) => request(`/feedback/suggestions/${id}/reject`, { method: "POST" }),
generateFeedbackSuggestions: () => request("/feedback/generate-suggestions", { method: "POST" })
```

- [ ] **Step 2: Create FeedbackPage**

Create `src/components/FeedbackPage.jsx`:

```jsx
import { useEffect, useState } from "react";
import { COLORS, FONT_SIZES, BORDER_RADIUS } from "../constants/theme";
import { i18n } from "../constants/i18n";
import { backendApi } from "../utils/backendApi";

const REASON_LABELS = {
  zh: { irrelevant: "不相关", duplicate: "重复/已看过", low_quality: "质量差", not_now: "暂时不感兴趣" },
  en: { irrelevant: "Irrelevant", duplicate: "Duplicate / Seen", low_quality: "Low quality", not_now: "Not now" }
};

export default function FeedbackPage({ darkMode, language }) {
  const t = i18n[language];
  const [stats, setStats] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const [statsRes, sugRes] = await Promise.all([
        backendApi.getFeedbackStats(),
        backendApi.getFeedbackSuggestions()
      ]);
      setStats(statsRes.data);
      setSuggestions(sugRes.data || []);
    } catch (e) {
      console.error("Feedback load failed:", e);
    }
  };

  useEffect(() => { load(); }, []);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      await backendApi.generateFeedbackSuggestions();
      await load();
    } catch (e) {
      console.error("Generate suggestions failed:", e);
    }
    setLoading(false);
  };

  const handleAccept = async (id) => {
    await backendApi.acceptFeedbackSuggestion(id);
    await load();
  };

  const handleReject = async (id) => {
    await backendApi.rejectFeedbackSuggestion(id);
    await load();
  };

  const cardBg = darkMode ? COLORS.background.cardDark : COLORS.background.card;
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;

  return (
    <div>
      <h2 style={{ fontSize: FONT_SIZES.xl, color: text, marginBottom: 16 }}>
        {language === "zh" ? "我的反馈" : "My Feedback"}
      </h2>

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
          <StatBox label={language === "zh" ? "总反馈" : "Total"} value={stats.total} darkMode={darkMode} />
          <StatBox label={language === "zh" ? "收藏" : "Bookmarks"} value={stats.bookmarks} darkMode={darkMode} />
          <StatBox label={language === "zh" ? "隐藏" : "Hidden"} value={stats.hides} darkMode={darkMode} />
        </div>
      )}

      {stats && stats.hides > 0 && (
        <div style={{ background: cardBg, border, borderRadius: BORDER_RADIUS.lg, padding: 16, marginBottom: 24 }}>
          <h3 style={{ fontSize: FONT_SIZES.md, color: text, marginBottom: 12 }}>
            {language === "zh" ? "隐藏原因分布" : "Hide reasons"}
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {Object.entries(stats.byReason).map(([reason, count]) => (
              <span key={reason} style={{
                padding: "6px 12px", borderRadius: BORDER_RADIUS.sm,
                background: darkMode ? "#333" : "#f0f0f0",
                color: text, fontSize: FONT_SIZES.sm
              }}>
                {(REASON_LABELS[language]?.[reason] || reason)}: {count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontSize: FONT_SIZES.md, color: text, margin: 0 }}>
          {language === "zh" ? "规则建议" : "Rule suggestions"}
        </h3>
        <button onClick={handleGenerate} disabled={loading} style={{
          padding: "8px 16px", borderRadius: BORDER_RADIUS.md, border: "none",
          background: COLORS.primary, color: "#fff", fontSize: FONT_SIZES.sm, cursor: "pointer"
        }}>
          {loading ? (language === "zh" ? "生成中..." : "Generating...") : (language === "zh" ? "生成建议" : "Generate")}
        </button>
      </div>

      {suggestions.filter(s => s.status === "pending").length === 0 && (
        <div style={{ color: darkMode ? "#888" : COLORS.text.light, fontSize: FONT_SIZES.sm }}>
          {language === "zh" ? "暂无待处理的规则建议" : "No pending suggestions"}
        </div>
      )}

      {suggestions.filter(s => s.status === "pending").map(s => (
        <div key={s.id} style={{ background: cardBg, border, borderRadius: BORDER_RADIUS.lg, padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontWeight: 600, color: text, fontSize: FONT_SIZES.base }}>
              {s.type}: {s.name}
            </span>
            <span style={{ fontSize: FONT_SIZES.sm, color: darkMode ? "#888" : COLORS.text.light }}>
              {s.purpose || "global"}
            </span>
          </div>
          <p style={{ color: darkMode ? "#bbb" : COLORS.text.secondary, fontSize: FONT_SIZES.sm, marginBottom: 12 }}>
            {s.reason}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => handleAccept(s.id)} style={{
              padding: "6px 12px", borderRadius: BORDER_RADIUS.sm, border: "none",
              background: COLORS.primary, color: "#fff", fontSize: FONT_SIZES.sm, cursor: "pointer"
            }}>
              {language === "zh" ? "采纳" : "Accept"}
            </button>
            <button onClick={() => handleReject(s.id)} style={{
              padding: "6px 12px", borderRadius: BORDER_RADIUS.sm, border: `1px solid ${border}`,
              background: "transparent", color: text, fontSize: FONT_SIZES.sm, cursor: "pointer"
            }}>
              {language === "zh" ? "忽略" : "Reject"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatBox({ label, value, darkMode }) {
  const bg = darkMode ? COLORS.background.cardDark : COLORS.background.card;
  const border = darkMode ? COLORS.border.dark : COLORS.border.light;
  const text = darkMode ? "#e8e8e8" : COLORS.text.primary;
  return (
    <div style={{ background: bg, border, borderRadius: BORDER_RADIUS.lg, padding: 16, textAlign: "center" }}>
      <div style={{ fontSize: FONT_SIZES.xl, fontWeight: 700, color: COLORS.primary }}>{value}</div>
      <div style={{ fontSize: FONT_SIZES.sm, color: text }}>{label}</div>
    </div>
  );
}
```

- [ ] **Step 3: Add feedback tab to ConfigurationPage**

Modify `src/components/ConfigurationPage.jsx`:

```javascript
import FeedbackPage from "./FeedbackPage";
```

Add to `TABS`:

```javascript
{ key: "feedback", icon: "✦", labelKey: "feedback" }
```

Add tab rendering:

```jsx
{tab === "feedback" && <FeedbackPage darkMode={darkMode} language={language} />}
```

Add to i18n if missing.

- [ ] **Step 4: Verify build**

Run:
```bash
npm run build
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/FeedbackPage.jsx src/components/ConfigurationPage.jsx src/utils/backendApi.js
if [ -f src/constants/i18n.js ]; then git add src/constants/i18n.js; fi
git commit -m "feat(feedback): add feedback page in configuration"
```

---

## Task 8: LLM Suggestion Generator

**Files:**
- Create: `server/services/feedbackSuggestionGenerator.js`
- Modify: `server/routes/feedback.js`

**Interfaces:**
- Produces: `generateSuggestions()` that populates `feedback_rules_suggestions`.

- [ ] **Step 1: Implement generator**

Create `server/services/feedbackSuggestionGenerator.js`:

```javascript
import db from "../db.js";
import { fetchWithTimeout } from "../crawlers/utils.js";

function safeJson(value) {
  if (!value) return [];
  try { return JSON.parse(value); } catch { return []; }
}

function buildRequest(config, messages, maxTokens = 2000) {
  const isAnthropic = config.providerId === "anthropic";
  const url = isAnthropic ? `${config.baseUrl}/messages` : `${config.baseUrl}/chat/completions`;
  const headers = isAnthropic
    ? { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }
    : { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` };
  return { url, headers, body: { model: config.modelId, messages, max_tokens: maxTokens, temperature: 0.3 } };
}

function extractContent(data, config) {
  if (config.providerId === "anthropic") return data.content?.[0]?.text || "";
  return data.choices?.[0]?.message?.content || "";
}

export async function generateSuggestions() {
  const config = {
    providerId: process.env.LLM_PROVIDER || "openai",
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    modelId: process.env.LLM_MODEL || "gpt-4o-mini",
    apiKey: process.env.LLM_API_KEY
  };
  if (!config.apiKey) throw new Error("LLM API key not configured");

  const rows = db.prepare("SELECT * FROM user_feedback ORDER BY created_at DESC LIMIT 100").all();
  if (rows.length === 0) return { generated: 0 };

  const samples = rows.map(r => ({
    action: r.action,
    reason: r.reason,
    title: r.title,
    summary: r.summary,
    keywords: safeJson(r.keywords),
    purposes: safeJson(r.purposes),
    categories: safeJson(r.categories)
  }));

  const prompt = `你是一名能源情报平台的规则优化助手。请分析用户的收藏和隐藏反馈，提炼出可以用于过滤未来文章的关键词规则。

反馈数据：
${JSON.stringify(samples, null, 2)}

要求：
1. 只建议高频、明确、可执行的规则；
2. 每个建议必须附带理由和证据（引用具体标题或关键词）；
3. 不要过度泛化：不要因一篇具体负面反馈就排除整个企业或主题；
4. 区分三种规则类型：enterprise（企业）、include_keyword（包含关键词）、exclude_keyword（排除关键词）；
5. 如果反馈中多次出现某个企业/关键词被收藏，建议加入 include_keyword 或 enterprise；
6. 如果反馈中多次出现某个企业/关键词因"不相关"或"质量差"被隐藏，建议加入 exclude_keyword；
7. 为每个建议指定最相关的 purpose：competitor、policy、tech，如果不确定则留空字符串。

返回 ONLY a valid JSON array, no markdown, no explanation. 每个对象字段：
- type: "enterprise" | "include_keyword" | "exclude_keyword"
- name: string
- purpose: "competitor" | "policy" | "tech" | ""
- reason: string
- evidence: string[]`;

  const { url, headers, body } = buildRequest(config, [{ role: "user", content: prompt }]);
  const response = await fetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify(body) }, 60000);
  if (!response.ok) throw new Error(`LLM API failed: ${response.status}`);

  const data = await response.json();
  const txt = extractContent(data, config).replace(/```json\s*|\s*```/g, "").trim();
  const suggestions = JSON.parse(txt);
  if (!Array.isArray(suggestions)) throw new Error("Invalid suggestions format");

  const insert = db.prepare(
    "INSERT INTO feedback_rules_suggestions (type, name, purpose, reason, evidence) VALUES (?, ?, ?, ?, ?)"
  );
  const insertMany = db.transaction((list) => {
    for (const s of list) {
      insert.run(s.type, s.name, s.purpose || "", s.reason || "", JSON.stringify(s.evidence || []));
    }
  });
  insertMany(suggestions);

  return { generated: suggestions.length };
}
```

- [ ] **Step 2: Register generate endpoint**

Modify `server/routes/feedback.js`:

```javascript
import { generateSuggestions } from "../services/feedbackSuggestionGenerator.js";
```

Add endpoint:

```javascript
router.post("/generate-suggestions", async (_req, res) => {
  try {
    const result = await generateSuggestions();
    res.json({ data: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Verify endpoint**

Run:
```bash
cd "/Users/cmyself/Live Projects/Energy Insights Hub"
npm run dev:server &
SERVER_PID=$!
sleep 3
curl -s -X POST http://localhost:3001/api/feedback/generate-suggestions -H "Content-Type: application/json" | head -c 200
kill $SERVER_PID
```

Expected: JSON response. If no feedback exists, error "No feedback"; otherwise success.

- [ ] **Step 4: Commit**

```bash
git add server/services/feedbackSuggestionGenerator.js server/routes/feedback.js
git commit -m "feat(feedback): add LLM suggestion generator"
```

---

## Task 9: Integration Test & Final Verification

**Files:**
- Modify: `server/routes/tracker.test.js` if needed

**Interfaces:**
- Verifies: feedback weights affect tracker output.

- [ ] **Step 1: Run full test suite**

Run:
```bash
cd "/Users/cmyself/Live Projects/Energy Insights Hub"
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Manual end-to-end check**

1. Start backend and frontend:
   ```bash
   npm run dev
   ```
2. Open `http://localhost:5177`.
3. Hide an insight with reason "不相关".
4. Check `http://localhost:3001/api/feedback/stats` returns updated stats.
5. Check `feedback_semantic_weights` table contains suppress terms.
6. Generate suggestions via UI and verify pending suggestions appear.
7. Accept a suggestion and verify it appears in `filter_rules`.

- [ ] **Step 3: Commit any final fixes**

```bash
git add .
git commit -m "feat(feedback): integrate user feedback semantic filtering"
```

---

## Self-Review

**Spec coverage:**
- ✅ 三张表：`user_feedback`、`feedback_semantic_weights`、`feedback_rules_suggestions`（Task 1）。
- ✅ 隐藏原因四分：irrelevant / duplicate / low_quality / not_now（Task 6）。
- ✅ 即时生效：tracker 调用 `applyUserFeedbackScore`（Task 3-4）。
- ✅ 周期汇总：LLM 生成建议（Task 8）。
- ✅ 半自动确认：用户接受/拒绝建议（Task 5、7）。
- ✅ 本地关键词相似：权重基于 keywords/title/summary 文本匹配（Task 3）。
- ✅ 只影响未来抓取：不改变当前池子查询逻辑（Task 4）。

**Placeholder scan:**
- 无 TBD/TODO/"implement later"。
- 每个 task 都包含完整代码和命令。

**Type consistency:**
- `recordFeedback` 返回 `{ id, insightId, action, reason, keywords }`。
- `applyUserFeedbackScore` 返回 `{ kept, dropped, scores }`。
- 路由与 service 签名一致。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-25-user-feedback-semantic-filtering.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
