-- 024: resource ownership —— 给 M2/M4 的归属隔离补列。
-- 存量行的 owner 统一归「第一个 admin」（users 表由 023 建好，本迁移在其后执行）。
-- submit_state 是 Task 12 反馈审批流的状态机：none（普通反馈，未提交）/
-- submitted（用户已提交，待审）/ accepted / rejected。
-- 注意：better-sqlite3 不支持 ALTER TABLE ... ADD COLUMN IF NOT EXISTS，
-- 幂等由 runner 的 _migrations 记录保证（db.js 跳过已记录的迁移）。

ALTER TABLE reports ADD COLUMN owner_id INTEGER;
ALTER TABLE report_jobs ADD COLUMN owner_id INTEGER;
ALTER TABLE report_templates ADD COLUMN owner_id INTEGER;
ALTER TABLE user_feedback ADD COLUMN user_id INTEGER;
ALTER TABLE user_feedback ADD COLUMN submit_state TEXT NOT NULL DEFAULT 'none'
  CHECK(submit_state IN ('none','submitted','accepted','rejected'));
ALTER TABLE feedback_rules_suggestions ADD COLUMN submitter_id INTEGER;

UPDATE reports            SET owner_id = (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1);
UPDATE report_jobs        SET owner_id = (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1);
UPDATE report_templates   SET owner_id = (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1);
UPDATE user_feedback      SET user_id  = (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1);

-- feedback_rules_suggestions.submitter_id 刻意**不回填**：存量建议全是匿名系统生成物，
-- 挂到某个管理员头上是伪造归属。Task 12 之后产生的建议才会写 submitter_id。
