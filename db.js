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
`);

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
      updated_at INTEGER NOT NULL
    );
    INSERT INTO problems SELECT * FROM problems_old;
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

function deleteUserProblems(userId) {
  db.prepare('DELETE FROM problems WHERE user_id = ?').run(userId);
}

function migrateLegacyUsers() {
  const marker = db
    .prepare('SELECT done FROM _migration_legacy_users_copied')
    .get();
  if (marker) return;

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
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getProblemsByUser(userId) {
  const rows = db
    .prepare(
      'SELECT * FROM problems WHERE user_id = ? ORDER BY created_at ASC'
    )
    .all(userId);
  return rows.map(rowToProblem);
}

function loadState(userId) {
  const user = getUserById(userId);
  const problems = getProblemsByUser(userId);
  return {
    problems,
    activeProblemId: user?.active_problem_id || null,
  };
}

function saveState(userId, problems, activeProblemId) {
  const now = Date.now();
  const tx = db.transaction(() => {
    deleteUserProblems(userId);
    const insert = db.prepare(
      `INSERT INTO problems (
        id, user_id, name, image_data_url, ocr_text, commands, ggb_state,
        active_tab, ocr_provider, llm_provider, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const p of problems) {
      insert.run(
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
        now
      );
    }
    setActiveProblemId(userId, activeProblemId);
  });
  tx();
}

module.exports = {
  db,
  migrateLegacyUsers,
  getUserById,
  setActiveProblemId,
  deleteUserProblems,
  rowToProblem,
  getProblemsByUser,
  saveState,
  loadState,
};
