const Database = require('better-sqlite3');
const path = require('node:path');
const crypto = require('node:crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const db = new Database(DB_PATH);

// Better Auth owns the user table. We keep problems and a one-time
// migration marker so existing users are preserved.
db.exec(`
  CREATE TABLE IF NOT EXISTS problems (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    image_data_url TEXT,
    ocr_text TEXT,
    commands TEXT,
    ggb_state TEXT,
    active_tab TEXT DEFAULT 'image',
    ocr_provider TEXT DEFAULT 'baidu',
    llm_provider TEXT DEFAULT 'kimi',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_problems_user ON problems(user_id);

  CREATE TABLE IF NOT EXISTS _migration_legacy_users_copied (
    done INTEGER PRIMARY KEY DEFAULT 1
  );

  -- AI 调用计费核算记录：只存调用标识与 token 用量，不存请求/响应内容
  CREATE TABLE IF NOT EXISTS ai_calls (
    id TEXT PRIMARY KEY,
    call_id TEXT,
    provider_call_id TEXT,
    user_id TEXT,
    model TEXT,
    task_type TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    ok INTEGER,
    error TEXT,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ai_calls_user ON ai_calls(user_id, created_at);

  -- 知识点受控词表（全局共建）与题目-知识点多对多关联
  CREATE TABLE IF NOT EXISTS knowledge_tags (
    name TEXT PRIMARY KEY,
    category TEXT,
    created_at INTEGER NOT NULL
  );

  -- 题目编辑锁：一个题同时只允许一个页面实例进入编辑态。
  -- heartbeat_at 超过 LOCK_STALE_MS 未续期视为失联，其他实例可接管。
  CREATE TABLE IF NOT EXISTS problem_locks (
    problem_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    holder_email TEXT,
    acquired_at INTEGER NOT NULL,
    heartbeat_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS problem_tags (
    problem_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (problem_id, tag)
  );

  CREATE INDEX IF NOT EXISTS idx_problem_tags_tag ON problem_tags(tag);

  -- 题目图形版本快照：每题最多保留 VERSION_LIMIT 个，含保存时间
  CREATE TABLE IF NOT EXISTS problem_versions (
    id TEXT PRIMARY KEY,
    problem_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    ggb_state TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_problem_versions_problem ON problem_versions(problem_id, created_at);
`);

// 题目属性列：来源（类型/年份/地区）与难度。按未来公共题库设计，检索面建全局索引。
function migrateProblemAttributes() {
  const cols = db.prepare('PRAGMA table_info(problems)').all().map((c) => c.name);
  const addColumn = (sql) => {
    try {
      db.exec(sql);
    } catch {
      // 列已存在（多实例并发启动等），忽略
    }
  };
  if (!cols.includes('exam_type')) addColumn('ALTER TABLE problems ADD COLUMN exam_type TEXT');
  if (!cols.includes('exam_year')) addColumn('ALTER TABLE problems ADD COLUMN exam_year INTEGER');
  if (!cols.includes('exam_region')) addColumn('ALTER TABLE problems ADD COLUMN exam_region TEXT');
  if (!cols.includes('difficulty')) addColumn('ALTER TABLE problems ADD COLUMN difficulty INTEGER');
  if (!cols.includes('refine_history')) addColumn("ALTER TABLE problems ADD COLUMN refine_history TEXT DEFAULT '[]'");
  if (!cols.includes('refine_input')) addColumn("ALTER TABLE problems ADD COLUMN refine_input TEXT DEFAULT ''");
  if (!cols.includes('engine')) addColumn("ALTER TABLE problems ADD COLUMN engine TEXT DEFAULT 'ggb'");
  if (!cols.includes('jxg_steps')) addColumn('ALTER TABLE problems ADD COLUMN jxg_steps TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_problems_year ON problems(exam_year)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_problems_difficulty ON problems(difficulty)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_problems_source ON problems(exam_type, exam_region)');
}

migrateProblemAttributes();

// Older `problems` tables had a foreign key to the legacy `users` table.
// Better Auth uses the `user` table, so that FK breaks saves. Recreate the
// table without the foreign key while preserving existing data.
function migrateProblemsForeignKey() {
  const fk = db.prepare('PRAGMA foreign_key_list(problems)').all();
  if (fk.length === 0) return;

    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
    ALTER TABLE problems RENAME TO problems_old;
    CREATE TABLE problems (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      image_data_url TEXT,
      ocr_text TEXT,
      commands TEXT,
      ggb_state TEXT,
      active_tab TEXT DEFAULT 'image',
      ocr_provider TEXT DEFAULT 'baidu',
      llm_provider TEXT DEFAULT 'kimi',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      exam_type TEXT,
      exam_year INTEGER,
      exam_region TEXT,
      difficulty INTEGER,
      refine_history TEXT DEFAULT '[]',
      refine_input TEXT DEFAULT '',
      engine TEXT DEFAULT 'ggb',
      jxg_steps TEXT
    );
    INSERT INTO problems (id, user_id, name, image_data_url, ocr_text, commands, ggb_state,
      active_tab, ocr_provider, llm_provider, created_at, updated_at,
      exam_type, exam_year, exam_region, difficulty, refine_history, refine_input)
      SELECT id, user_id, name, image_data_url, ocr_text, commands, ggb_state,
      active_tab, ocr_provider, llm_provider, created_at, updated_at,
      exam_type, exam_year, exam_region, difficulty, refine_history, refine_input FROM problems_old;
    DROP TABLE problems_old;
    CREATE INDEX IF NOT EXISTS idx_problems_user ON problems(user_id);
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

migrateProblemsForeignKey();

function generateId() {
  return crypto.randomUUID();
}

function getUserById(id) {
  return db
    .prepare(
      'SELECT id, email, activeProblemId AS active_problem_id, createdAt FROM user WHERE id = ?'
    )
    .get(id);
}

function setActiveProblemId(userId, problemId) {
  db.prepare('UPDATE user SET activeProblemId = ? WHERE id = ?').run(
    problemId,
    userId
  );
}

function migrateLegacyUsers() {
  const marker = db
    .prepare('SELECT done FROM _migration_legacy_users_copied')
    .get();
  if (marker) return;

  // Fresh installs never had the legacy `users` table; skip gracefully.
  const legacyTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    .get();
  if (!legacyTable) {
    db.prepare('INSERT INTO _migration_legacy_users_copied (done) VALUES (1)').run();
    return;
  }

  const legacyUsers = db.prepare('SELECT * FROM users').all();
  if (!legacyUsers || legacyUsers.length === 0) {
    db.prepare('INSERT INTO _migration_legacy_users_copied (done) VALUES (1)').run();
    return;
  }

  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO user
      (id, email, emailVerified, name, image, createdAt, updatedAt, activeProblemId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const u of legacyUsers) {
    insert.run(
      u.id,
      u.email,
      0,
      u.email.split('@')[0] || 'User',
      null,
      new Date(u.created_at).toISOString(),
      now,
      u.active_problem_id || null
    );
  }

  db.prepare('INSERT INTO _migration_legacy_users_copied (done) VALUES (1)').run();
}

function rowToProblem(row) {
  return {
    id: row.id,
    name: row.name,
    imageDataUrl: row.image_data_url,
    ocrText: row.ocr_text,
    commands: row.commands,
    ggbState: row.ggb_state,
    activeTab: row.active_tab,
    ocrProvider: row.ocr_provider,
    llmProvider: row.llm_provider,
    examType: row.exam_type || null,
    examYear: row.exam_year || null,
    examRegion: row.exam_region || null,
    difficulty: row.difficulty || null,
    tags: row.tags || [],
    refineHistory: safeParseJsonArray(row.refine_history),
    refineInput: row.refine_input || '',
    engine: row.engine || 'ggb',
      jxgSteps: safeParseJsonArray(row.jxg_steps),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

  function safeParseJsonArray(s) {
    try {
      const v = JSON.parse(s || '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

function getProblemsByUser(userId) {
  const rows = db
    .prepare(
      'SELECT * FROM problems WHERE user_id = ? ORDER BY created_at ASC'
    )
    .all(userId);
  const tagRows = db
    .prepare(
      `SELECT pt.problem_id, pt.tag FROM problem_tags pt
       JOIN problems p ON p.id = pt.problem_id
       WHERE p.user_id = ?`
    )
    .all(userId);
  const tagsByProblem = new Map();
  for (const t of tagRows) {
    if (!tagsByProblem.has(t.problem_id)) tagsByProblem.set(t.problem_id, []);
    tagsByProblem.get(t.problem_id).push(t.tag);
  }
  return rows.map((row) => rowToProblem({ ...row, tags: tagsByProblem.get(row.id) || [] }));
}

function loadState(userId) {
  const user = getUserById(userId);
  const problems = getProblemsByUser(userId);
  return {
    problems,
    activeProblemId: user?.active_problem_id || null,
  };
}

// 按题 upsert（增量同步）：只写入这一道题，不动该用户的其他题目。
// 与全量替换的 saveState 不同，这是"每题增删改"协议的写入路径。
function upsertProblem(userId, p) {
  const now = Date.now();
  const tags = Array.isArray(p.tags) ? p.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  const tx = db.transaction(() => {
    const existing = db
      .prepare('SELECT id FROM problems WHERE id = ? AND user_id = ?')
      .get(p.id, userId);
    if (existing) {
      db.prepare(`
        UPDATE problems SET
          name = ?, image_data_url = ?, ocr_text = ?, commands = ?, ggb_state = ?,
          active_tab = ?, ocr_provider = ?, llm_provider = ?, updated_at = ?,
          exam_type = ?, exam_year = ?, exam_region = ?, difficulty = ?,
          refine_history = ?, refine_input = ?, engine = ?, jxg_steps = ?
        WHERE id = ? AND user_id = ?
      `).run(
        p.name,
        p.imageDataUrl || null,
        p.ocrText || '',
        p.commands || '',
        p.ggbState || '',
        p.activeTab || 'image',
        p.ocrProvider || 'baidu',
        p.llmProvider || 'kimi',
        p.updated_at || now,
        p.examType || null,
        Number.isFinite(p.examYear) ? p.examYear : null,
        p.examRegion || null,
        Number.isFinite(p.difficulty) ? p.difficulty : null,
        JSON.stringify(Array.isArray(p.refineHistory) ? p.refineHistory : []),
        p.refineInput || '',
          p.engine === 'jxg' ? 'jxg' : 'ggb',
          p.jxgSteps ? JSON.stringify(p.jxgSteps) : null,
        p.id,
        userId
      );
    } else {
        db.prepare(`
        INSERT INTO problems (
          id, user_id, name, image_data_url, ocr_text, commands, ggb_state,
          active_tab, ocr_provider, llm_provider, created_at, updated_at,
          exam_type, exam_year, exam_region, difficulty, refine_history, refine_input,
          engine, jxg_steps
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        p.id,
        userId,
        p.name,
        p.imageDataUrl || null,
        p.ocrText || '',
        p.commands || '',
        p.ggbState || '',
        p.activeTab || 'image',
        p.ocrProvider || 'baidu',
        p.llmProvider || 'kimi',
        p.created_at || now,
        p.updated_at || now,
        p.examType || null,
        Number.isFinite(p.examYear) ? p.examYear : null,
        p.examRegion || null,
        Number.isFinite(p.difficulty) ? p.difficulty : null,
        JSON.stringify(Array.isArray(p.refineHistory) ? p.refineHistory : []),
        p.refineInput || '',
          p.engine === 'jxg' ? 'jxg' : 'ggb',
          p.jxgSteps ? JSON.stringify(p.jxgSteps) : null
      );
    }
    // 该题标签全量替换（题量小，直接删了重插）
    db.prepare('DELETE FROM problem_tags WHERE problem_id = ?').run(p.id);
    const insertTag = db.prepare('INSERT OR IGNORE INTO problem_tags (problem_id, tag) VALUES (?, ?)');
    const upsertVocab = db.prepare(
      'INSERT OR IGNORE INTO knowledge_tags (name, category, created_at) VALUES (?, NULL, ?)'
    );
    for (const tag of tags) {
      insertTag.run(p.id, tag);
      upsertVocab.run(tag, now);
    }
  });
  tx();
}

// 按题删除：清理标签、版本快照，并复位用户的 activeProblemId 指向
function deleteProblemById(userId, problemId) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM problem_tags WHERE problem_id = ?').run(problemId);
    db.prepare('DELETE FROM problem_versions WHERE problem_id = ? AND user_id = ?').run(problemId, userId);
    db.prepare('DELETE FROM problems WHERE id = ? AND user_id = ?').run(problemId, userId);
    db.prepare('UPDATE user SET activeProblemId = NULL WHERE id = ? AND activeProblemId = ?').run(userId, problemId);
  });
  tx();
}


// 组合查询：年份/地区/类型/难度上限/知识点，均可选；仅返回当前用户的题目
function queryProblems(userId, filters = {}) {
  const where = ['p.user_id = ?'];
  const params = [userId];
  if (filters.year != null && filters.year !== '') {
    where.push('p.exam_year = ?');
    params.push(Number(filters.year));
  }
  if (filters.region) {
    where.push('p.exam_region = ?');
    params.push(filters.region);
  }
  if (filters.type) {
    where.push('p.exam_type = ?');
    params.push(filters.type);
  }
  if (filters.maxDifficulty != null && filters.maxDifficulty !== '') {
    where.push('p.difficulty <= ?');
    params.push(Number(filters.maxDifficulty));
  }
  if (filters.tag) {
    where.push('p.id IN (SELECT problem_id FROM problem_tags WHERE tag = ?)');
    params.push(filters.tag);
  }
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.exam_type, p.exam_year, p.exam_region, p.difficulty, p.created_at, p.updated_at
       FROM problems p
       WHERE ${where.join(' AND ')}
       ORDER BY p.created_at ASC`
    )
    .all(...params);
  return rows.map((row) => rowToProblem(row));
}

// 知识点词表：全局词表 + 当前用户实际使用过的词
function getKnowledgeTags(userId) {
  const tags = db
    .prepare('SELECT name, category FROM knowledge_tags ORDER BY name')
    .all();
  const mine = db
    .prepare(
      `SELECT DISTINCT pt.tag FROM problem_tags pt
       JOIN problems p ON p.id = pt.problem_id
       WHERE p.user_id = ? ORDER BY pt.tag`
    )
    .all(userId)
    .map((r) => r.tag);
  return { tags, mine };
}

function createKnowledgeTag(name, category) {
  const n = String(name || '').trim();
  if (!n) throw new Error('词条名称不能为空');
  db.prepare(
    'INSERT OR IGNORE INTO knowledge_tags (name, category, created_at) VALUES (?, ?, ?)'
  ).run(n, category || null, Date.now());
  return { name: n, category: category || null };
}

// ---------- 题目图形版本快照 ----------
const VERSION_LIMIT = 5;

function getProblemOwner(problemId) {
  return db.prepare('SELECT user_id FROM problems WHERE id = ?').get(problemId);
}

function listProblemVersions(userId, problemId) {
  const owner = getProblemOwner(problemId);
  if (!owner || owner.user_id !== userId) return [];
  return db
    .prepare(
      'SELECT id, created_at FROM problem_versions WHERE problem_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC'
    )
    .all(problemId, userId);
}

function getProblemVersion(userId, problemId, versionId) {
  const owner = getProblemOwner(problemId);
  if (!owner || owner.user_id !== userId) return null;
  return db
    .prepare(
      'SELECT id, created_at, ggb_state FROM problem_versions WHERE id = ? AND problem_id = ? AND user_id = ?'
    )
    .get(versionId, problemId, userId);
}

// 删除一个版本快照；返回是否删除成功（存在且属于该用户）
function deleteProblemVersion(userId, problemId, versionId) {
  const owner = getProblemOwner(problemId);
  if (!owner || owner.user_id !== userId) return false;
  const info = db
    .prepare('DELETE FROM problem_versions WHERE id = ? AND problem_id = ? AND user_id = ?')
    .run(versionId, problemId, userId);
  return info.changes > 0;
}

// 保存一个版本快照。达到上限时：force=false 返回 {limited:true} 由前端询问用户；
// force=true 删除最旧版本后保存。
function insertProblemVersion(userId, problemId, ggbState, { force = false } = {}) {
  const owner = getProblemOwner(problemId);
  if (!owner || owner.user_id !== userId) throw new Error('题目不存在');
  const state = String(ggbState || '');
  if (!state.trim()) throw new Error('图形内容为空，无法保存版本');
  const count = db
    .prepare('SELECT COUNT(*) AS c FROM problem_versions WHERE problem_id = ?')
    .get(problemId).c;
  if (count >= VERSION_LIMIT) {
    if (!force) return { limited: true, limit: VERSION_LIMIT, count };
    db.prepare(
      `DELETE FROM problem_versions WHERE problem_id = ? AND id = (
         SELECT id FROM problem_versions WHERE problem_id = ? ORDER BY created_at ASC, id ASC LIMIT 1
       )`
    ).run(problemId, problemId);
  }
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  db.prepare(
    'INSERT INTO problem_versions (id, problem_id, user_id, ggb_state, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, problemId, userId, state, createdAt);
  return { limited: false, id, created_at: createdAt };
}

// 记录一次 AI 调用（计费核算用）。usage 可能为 null（失败或服务商未返回）。
function insertAiCall({ callId, providerCallId, userId, model, taskType, usage, ok, error, durationMs }) {
  try {
    db.prepare(`
      INSERT INTO ai_calls (id, call_id, provider_call_id, user_id, model, task_type,
        prompt_tokens, completion_tokens, total_tokens, ok, error, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      callId || null,
      providerCallId || null,
      userId || 'anonymous',
      model || null,
      taskType || 'text',
      usage && Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null,
      usage && Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
      usage && Number.isFinite(usage.total_tokens) ? usage.total_tokens : null,
      ok ? 1 : 0,
      error || null,
      Number.isFinite(durationMs) ? durationMs : null,
      Date.now()
    );
  } catch (e) {
    console.error('insert ai call failed', e);
  }
}

// ---------- 题目编辑锁 ----------
// 后台标签页浏览器会把 setInterval 节流（最差 1 分钟一次），
// 失联窗口放宽到 90s，避免"窗口还在却被判定失联"的误接管
const LOCK_STALE_MS = 90000;

// 加锁/续期：已被其他实例持有且未失联时返回 { ok: false, lockedBy }；
// force=true 强制接管（用于用户确认后的接管）。
function acquireLock(userId, problemId, instanceId, email, force = false) {
  const now = Date.now();
  // 顺手清理长时间失联的锁
  db.prepare('DELETE FROM problem_locks WHERE heartbeat_at < ?').run(now - 10 * 60 * 1000);
  const row = db.prepare('SELECT * FROM problem_locks WHERE problem_id = ?').get(problemId);
  if (row) {
    const stale = now - row.heartbeat_at > LOCK_STALE_MS;
    if (row.instance_id !== instanceId && !stale && !force) {
      return { ok: false, lockedBy: row.holder_email || row.user_id, since: row.acquired_at };
    }
    db.prepare(
      'UPDATE problem_locks SET user_id = ?, instance_id = ?, holder_email = ?, heartbeat_at = ? WHERE problem_id = ?'
    ).run(userId, instanceId, email || null, now, problemId);
    return { ok: true, tookOver: row.instance_id !== instanceId };
  }
  db.prepare(
    'INSERT INTO problem_locks (problem_id, user_id, instance_id, holder_email, acquired_at, heartbeat_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(problemId, userId, instanceId, email || null, now, now);
  return { ok: true };
}

// 解锁（仅持有该锁的实例可解）
function releaseLock(problemId, instanceId) {
  db.prepare('DELETE FROM problem_locks WHERE problem_id = ? AND instance_id = ?').run(problemId, instanceId);
}

// 当前用户名下所有未失联的锁（题目列表展示锁定人用）
function listLocks(userId) {
  const rows = db.prepare(
    'SELECT problem_id, holder_email, heartbeat_at FROM problem_locks WHERE user_id = ? AND heartbeat_at >= ?'
  ).all(userId, Date.now() - LOCK_STALE_MS);
  return rows;
}

// 计费核算查询：最近调用明细 + 按模型汇总（管理员用）。days=0 表示全部。
function queryAiCalls({ days = 0, limit = 200, userId = null } = {}) {
  const since = days > 0 ? Date.now() - days * 86400000 : 0;
  const where = since ? 'created_at >= ?' : '1=1';
  const params = since ? [since] : [];
  let uidClause = '';
  if (userId) {
    uidClause = ' AND user_id = ?';
    params.push(userId);
  }
  const calls = db.prepare(`
    SELECT call_id, provider_call_id, user_id, model, task_type,
      prompt_tokens, completion_tokens, total_tokens, ok, error, duration_ms, created_at
    FROM ai_calls WHERE ${where}${uidClause}
    ORDER BY created_at DESC LIMIT ?
  `).all(...params, Math.min(Math.max(Number(limit) || 200, 1), 1000));
  const summary = db.prepare(`
    SELECT model,
      COUNT(*) AS call_count,
      SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok_count,
      SUM(prompt_tokens) AS prompt_tokens,
      SUM(completion_tokens) AS completion_tokens,
      SUM(total_tokens) AS total_tokens
    FROM ai_calls WHERE ${where}${uidClause}
    GROUP BY model ORDER BY total_tokens DESC
  `).all(...params);
  return { calls, summary };
}

module.exports = {
  db,
  migrateLegacyUsers,
  getUserById,
  setActiveProblemId,
  rowToProblem,
  getProblemsByUser,
  loadState,
  upsertProblem,
  deleteProblemById,
  insertAiCall,
  queryAiCalls,
  acquireLock,
  releaseLock,
  listLocks,
  queryProblems,
  getKnowledgeTags,
  createKnowledgeTag,
  listProblemVersions,
  getProblemVersion,
  deleteProblemVersion,
  insertProblemVersion,
  VERSION_LIMIT,
};
