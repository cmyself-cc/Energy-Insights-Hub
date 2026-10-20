import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 路径解析与 server/db.js:9-18 **逐字同构**（DATA_DIR 覆盖 → <repo>/data；NODE_ENV=test
// 时用测试库，否则用生产库名）。刻意**不** import ./db.js：那个模块在 import 时就会
// `new Database(DB_PATH)`，而 better-sqlite3 在文件不存在时会**创建**它 —— 在一个只是想
// 读一眼行数的钩子里创建数据库文件是不可接受的副作用。
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const IS_TEST = process.env.NODE_ENV === "test";
const DB_PATH = process.env.DB_PATH || (
  IS_TEST
    ? path.join(DATA_DIR, "test-energy_insights.db")
    : path.join(DATA_DIR, "energy_insights.db")
);

const TEST_DB_BASENAME = "test-energy_insights.db";

// 与 server/testUtils.js 的 clearAuthTables() 同一张清单。顺序无关（这里只读不删）。
const AUTH_TABLES = ["users", "sessions", "pending_identities", "invite_codes", "user_views"];

// 为什么需要这个钩子：「测试跑完之后 auth 表是干净的」此前只是**数据性质的巧合** ——
// 全量跑看起来干净，是因为 023_users_auth.test.js 恰好在写 auth 表的文件里最后完成、
// 它的 beforeEach 顺手擦掉了别人的残留，而 vitest **不承诺完成顺序**。
// 把这条性质提到构建级：任何一次全量跑结束时留下残行，整个跑就是失败的，
// 不管当时是哪个文件、以什么顺序留下的。
//
// ⚠️ vitest 4.1.10 **没有** `globalTeardown` 这个配置项（`grep -rn globalTeardown`
// 在 node_modules/vitest/dist 与 node_modules/@vitest 下零命中；配置类型只有
// `globalSetup?: string | string[]`）。真实的契约是：globalSetup 文件可以导出
// `setup` 和/或 `teardown`（或一个 default，其返回值可作为 teardown）。本文件只需要
// teardown，所以只导出 teardown。teardown 抛出的错误会被收集进运行结果并让整个跑失败。
export async function teardown() {
  // 🔴 硬安全护栏（AGENTS.md：未经批准不得触碰生产数据）。解析出来的路径只要不是测试库
  // 那个文件名，就立刻抛错、**不打开任何东西**。这条护栏也顺带覆盖了 NODE_ENV 不是 test
  // 的情况：那时上面的解析会得到生产库名，于是这里会响亮地失败，而不是去检查一个错的库、
  // 然后「安静地通过」。
  if (path.basename(DB_PATH) !== TEST_DB_BASENAME) {
    throw new Error(
      `[testGlobalSetup] refusing to inspect a non-test database: resolved path is "${DB_PATH}" `
      + `(basename must be exactly "${TEST_DB_BASENAME}"). Check NODE_ENV / DB_PATH / DATA_DIR.`
    );
  }

  // 全新克隆还没跑过任何测试时文件不存在，这不是失败。
  if (!fs.existsSync(DB_PATH)) return;

  // readonly：这个钩子只观察、绝不修改。fileMustExist 与上面的 existsSync 双保险。
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const tableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
    const dirty = [];
    for (const t of AUTH_TABLES) {
      // 迁移还没建出这张表时跳过，让全新克隆不会因为表缺失而失败。
      if (!tableExists.get(t)) continue;
      // 表名来自上面的硬编码常量清单，不是外部输入，所以这里的字符串拼接是安全的
      // （与 testUtils.js 的 clearAuthTables() 同一写法）。
      const rows = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
      if (rows > 0) dirty.push(`${t}=${rows}`);
    }
    if (dirty.length > 0) {
      const msg = `[testGlobalSetup] 测试库在整轮跑完之后不干净：${dirty.join(" ")}。`
        + `凡是写 auth 表（${AUTH_TABLES.join(" / ")}）的测试文件都必须带 `
        + `afterAll(() => { clearAuthTables(); })——beforeEach 只保证本文件内每个用例从干净状态开始，`
        + `管不到文件跑完之后。单跑可疑文件（npx vitest run <file>）再读这 5 张表即可定位。`
        + ` 库路径：${DB_PATH}`;
      // 🔴 光 throw 是**没有牙的**，实测过：vitest 4.1.10 的 Vitest.close()
      // （node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js:13937-13950）把 teardown 的错误
      // 收进 teardownErrors，然后只 `logger.error("error during close", …)` 打一条日志，
      // **不参与退出码计算** —— 掏空 023_users_auth.test.js 的 afterAll 之后重跑，
      // 输出是 `Test Files 1 passed (1)` + 一条 "error during close"，而 `npx vitest run`
      // 仍然 **exit 0**。那样的话这个钩子只是装饰。
      // 所以退出码必须自己摁下去：globalSetup 与 vitest 主进程同一个进程，vitest 自己的
      // 错误路径也是用 process.exitCode = 1（同文件 :14565），而它退出时调的
      // process.exit() 不带参数、会沿用这个值。
      process.exitCode = 1;
      console.error(msg);
      // 仍然 throw：让 vitest 那条 "error during close" 也带上消息与栈，两处都看得见。
      throw new Error(msg);
    }
  } finally {
    db.close();
  }
}
