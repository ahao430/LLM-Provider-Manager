-- 运维日志与待办（v0.34.0）：渠道管理者的日常工作记录与计划。
-- 日志只追加（误写可删单条）；待办可完成 / 重开。channel_id 可空 = 不针对特定渠道。
CREATE TABLE IF NOT EXISTS ops_logs (
    id         TEXT PRIMARY KEY,
    channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_logs_time ON ops_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS todos (
    id         TEXT PRIMARY KEY,
    channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
    title      TEXT NOT NULL,
    note       TEXT,
    due_date   TEXT,
    done       INTEGER NOT NULL DEFAULT 0,
    done_at    TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todos_done ON todos(done, due_date);
