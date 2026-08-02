# 内容过滤页关键词浏览器 — 设计文档

- 日期: 2026-08-02
- 状态: Approved

## 背景与目标

内容过滤页（`src/components/ContentFiltersPage.jsx`）当前以平铺 chip 形式展示三类过滤关键词（主体 enterprise / 包含 include / 排除 exclude），当数量大（主体 200+）时难以浏览、定位、去重，且无法直观查看每个关键词的语义同义词。

目标：把三类关键词的展示重构为"字母索引 + 单列列表"浏览器，支持按拼音/英文首字母分组排序、滚动窗口浏览、首字母/关键词快速查询、按需生成并展示 LLM 中英文同义词。

## 需求（用户确认）

1. 按首字的拼音首字母（中文）或英文首字母（英文）先后排列分组。
2. 每行右侧展示该关键词的语义同义词（LLM 推荐中英文），按需生成（点击 🔄 才调用 LLM，存量 aliases 不批量预生成）。
3. 列表放在固定高度滚动窗口内（不一次显示所有行）。
4. 顶部搜索框支持两类查询：
   - 输入 2 个纯字母（如 `FB`）→ 按拼音首字母序列匹配（发布 = FB）。
   - 输入其他 → 关键词名或已有同义词的全文模糊匹配。
5. 主体、包含、排除三类关键词各自独立查询（各自有搜索框 + 列表窗口）。
6. 布局形态：字母索引条 + 单列列表（手机通讯录风格），点击字母跳转分组。

## 设计

### 布局（每个目的卡片内，三类关键词各自一个 KeywordList）

```
┌─ 主体关键词 (197) ────────────────────────────────────┐
│ [🔍 搜索框]                          [+ 添加新关键词] │
│ [A][B][C]…[Z][#]   ← 字母索引条，点击跳转             │
│ ┌────────────────────── 滚动窗口 (max-height 320px) ─┐│
│ │ A (12)                                             ││
│ │   ASB 生物柴油   │ 同义词灰色小字…   [🔄][×]       ││
│ │   bp             │ 英国石油…          [🔄][×]       ││
│ │ B (5)                                             ││
│ │   …                                              ││
│ └───────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────┘
```

- 每行：关键词（点击进入 inline 编辑）｜ 同义词（灰色小字，hover title 显示全量）｜ 🔄（按需生成）｜ ×（删除）。
- 字母索引条：点击滚动定位分组；有词的字母高亮，空字母置灰；`#` 收纳数字/符号开头。

### 拼音与排序

- 引入 `pinyin-pro`（成熟库，中英文混合支持）。
- `getInitial(name)`：
  - 中文首字符 → `pinyin(char, { pattern: 'first', toneType: 'none' })` 大写首字母。
  - 英文 → 首字母大写。
  - 数字/符号/其他 → `#`。
- 分组按首字母 A-Z 排序，`#` 组放最后。

### 搜索逻辑

- 输入为 2 个纯字母（`/^[A-Za-z]{2}$/`，按大写处理）→ 逐词匹配：关键词每个字的拼音首字母拼接后，是否以该串开头或包含（如 发布 = FB，输入 FB 命中；也支持输入 F 匹配 F 组）。
- 否则 → 关键词名 或 aliases 任一同义词的 `toLowerCase().includes(query)` 模糊匹配。

### 同义词按需生成

- 后端：`POST /api/filters/rules/:id/regenerate-aliases`，body 无需参数，返回 `{ data: { aliases } }`。
  - 实现：读取规则 name → `generateAliases(name)`（`server/lib/llmAlias.js`，已有）→ `UPDATE filter_rules SET aliases = ?`。
  - LLM 未配置/失败时返回 `aliases: []`（降级，不报错）。
- 前端：点击 🔄 → 行级 loading（按钮转圈/禁用）→ 成功后行内更新 aliases；失败 toast。

### 组件化

- 新建 `src/components/KeywordList.jsx`：
  - Props: `items`（规则数组，含 id/name/aliases）、`placeholder`、`onAdd`、`onEdit`、`onDelete`、`onRegenerateAliases`。
  - 内部状态：`query`、`activeLetter`、`regeneratingId`。
  - 派生：`grouped`（按首字母分组，搜索过滤后）、`letters`（存在的字母集合）。
- `ContentFiltersPage.jsx` 中三类关键词各渲染一个 `<KeywordList>`，传入现有 handlers（`addTypedKeyword` / `startEditTypedKeyword` / `saveTypedKeyword` / `deleteTypedKeyword`），新增 `regenerateAliases` handler。

## 后端改动

| 文件 | 改动 |
|------|------|
| `server/routes/filters.js` | 新增 `POST /rules/:id/regenerate-aliases` 路由 |
| `package.json` | 新增依赖 `pinyin-pro` |

## 前端改动

| 文件 | 改动 |
|------|------|
| `src/components/KeywordList.jsx`（新） | 字母索引 + 滚动窗口 + 搜索 + 按需同义词的列表组件 |
| `src/components/ContentFiltersPage.jsx` | 三类关键词替换为 KeywordList；新增 regenerateAliases handler |
| `src/utils/backendApi.js` | 新增 `regenerateAliases(id)` |

## 边界与风险

- 拼音库仅在浏览器端使用，构建体积增加约 ~50KB（gzip 更小），可接受。
- 存量 438 个关键词 aliases 为空，按需生成（用户已确认），不做批量预生成。
- 搜索"FB"匹配规则：关键词字的拼音首字母拼接（忽略空格/非汉字），如"发布"→"FB"；英文词（如 bp）按字母序列匹配。
- 删除/编辑/添加逻辑沿用现有 API，不改变数据模型。

## 测试

- 手动：三类关键词各自搜索（FB 命中"发布"类）、字母跳转、滚动、按需生成同义词、删除。
- 后端：`POST /rules/:id/regenerate-aliases` 用 curl 验证 aliases 更新入库。
