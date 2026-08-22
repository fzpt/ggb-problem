const Database = require('better-sqlite3');
const path = require('node:path');
const crypto = require('node:crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    active_problem_id TEXT,
    created_at INTEGER NOT NULL
  );

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
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_problems_user ON problems(user_id);
`);

function generateId() {
  return crypto.randomUUID();
}

function createUser(email, passwordHash) {
  const id = generateId();
  const now = Date.now();
  const stmt = db.prepare(
    'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)'
  );
  stmt.run(id, email, passwordHash, now);
  return { id, email };
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserById(id) {
  return db
    .prepare(
      'SELECT id, email, active_problem_id, created_at FROM users WHERE id = ?'
    )
    .get(id);
}

function setActiveProblemId(userId, problemId) {
  db.prepare('UPDATE users SET active_problem_id = ? WHERE id = ?').run(
    problemId,
    userId
  );
}

function deleteUserProblems(userId) {
  db.prepare('DELETE FROM problems WHERE user_id = ?').run(userId);
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
  createUser,
  getUserByEmail,
  getUserById,
  saveState,
  loadState,
};
