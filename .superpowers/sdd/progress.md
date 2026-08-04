# SDD Progress Ledger

Branch: main
Base: 9cb088b
Plan: docs/superpowers/plans/2026-08-04-waf-challenge-fetch-layer.md

## Tasks
- [x] Task 1: 修复 websiteCrawler 测试基线（vitest 迁移 + mock 修正）
- [x] Task 2: 移动 decodeHtmlBuffer 到 utils.js + 声明 iconv-lite
- [x] Task 3: challenge.js 基础组件（检测/域名/缓存）
- [x] Task 4: vm 沙箱挑战求解器 + bjx fixture
- [x] Task 5: fetchHtmlSmart 统一抓取入口
- [x] Task 6: websiteCrawler 接入挑战层 + 子页 GBK 修复
- [x] Task 7: maxAgeDays 全路径生效 + publishDate 空值处理
- [x] Task 8: 正文容器兜底启发式
- [x] Task 9: routes/sources.js 发现端点接入
- [x] Task 10: bjx source + 活体冒烟 + 最终验证

## Completed

## Minor findings (for final review triage)
Task 1: complete (commits 9cb088b..cfc7e5b, review clean)
Task 2: complete (commits cfc7e5b..cf071fe, review clean)
Task 2: complete (commits cfc7e5b..cf071fe, review clean)
Task 3: complete (commits cf071fe..15dbfdf, review clean)
- Task 3 minor: TTL-expiry path untested (needs vi.useFakeTimers) — candidate for final cleanup
- Task 3 minor: IP-literal hosts collapse oddly in getRegistrableDomain (internal contract: pass hostnames only)
Task 4: complete (commits 15dbfdf..fe11fc9, review clean; trim normalized cookie live-verified against real bjx site)
- Task 4 minor: JSDoc says errors tolerated only after capture (code tolerates always); trim quantifier is [0-9a-f]+ not {10}; no synthetic passthrough test for normalization; determinism test uses one pageUrl
Task 5: complete (commits fe11fc9..d7c88e0, review clean)
- Task 5 minor: challenge/cache-hit tests record outgoing Cookie header into calls[] but never assert on it — one-line assertion candidate for final cleanup
Task 6: complete (commits d7c88e0..c741eac, review clean)
- lint baseline decision: repo-wide lint has 23 pre-existing problems (15 files); working criterion = no NEW lint issues in touched files (verified for Tasks 6+)
Task 7: complete (commits c741eac..d3947c9 incl. API-branch fallback fix, review clean)
- Task 7 minor: RSS age filter runs on feed pubDate before enrichment; enrichment-overwritten dates not re-filtered (by design, per brief placement)
Task 8: complete (commits d3947c9..e58e452, review clean)
Task 9: complete (commits e58e452..7ad65be, review clean)
- Task 9 minor: discover-subpages now returns 500 on non-2xx (was silent empty) — accepted as improvement
Task 10: complete (commits 7ad65be..4cb9f49, review clean; live smoke PASS: 10 articles, vm challenge solved + cookie cache hit)
- Task 10 minor: test output has console noise (challenge-solve logs); `</h2>` typo in websiteCrawler.test.js fixture
- Task 10 note (reviewer): DB sqlite_sequence shows historical bulk-delete traces (sources seq 318 vs few rows; insights 227→0; filter_rules 1268→1) — unrelated to this branch (INSERT-only); likely from an earlier data restore (data/*.before-restore backups exist); flag to user
