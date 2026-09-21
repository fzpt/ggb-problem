// 服务级设置，存 SQLite app_settings 表，带内存缓存。
// 管理后台可配置：图片识别模型、文本生成模型、智谱 API Key、管理员邮箱。
const { db } = require('../db');
const { MODELS, findModel } = require('./models');

db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const ROW_KEY = 'app';

const DEFAULTS = {
  visionModel: 'kimi-k2.6',
  textModel: 'kimi-k2.7-code',
  keysZhipu: '',
  adminEmails: [],
};

let cache = null;

function load() {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(ROW_KEY);
  if (!row) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(row.value);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function getSettings() {
  if (!cache) cache = load();
  return cache;
}

function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(ROW_KEY, JSON.stringify(next));
  cache = next;
  return next;
}

// 管理员列表：设置里的 adminEmails 优先，其次 env ADMIN_EMAILS，
// 都没有则所有注册用户均为管理员（首次部署的兜底，配置 adminEmails 后收紧）。
function getAdminEmails() {
  const fromSettings = getSettings().adminEmails;
  if (Array.isArray(fromSettings) && fromSettings.length) return fromSettings;
  const fromEnv = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (fromEnv.length) return fromEnv;
  return db.prepare('SELECT email FROM user').all().map((u) => u.email).filter(Boolean);
}

function isAdminEmail(email) {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase());
}

// 任务类型 -> 模型 id（带默认值兜底）
function resolveModelId(taskType, override) {
  if (override) return override;
  const s = getSettings();
  const id = taskType === 'vision' ? s.visionModel : s.textModel;
  if (findModel(id)) return id;
  return taskType === 'vision' ? DEFAULTS.visionModel : DEFAULTS.textModel;
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

module.exports = {
  MODELS,
  getSettings,
  saveSettings,
  getAdminEmails,
  isAdminEmail,
  resolveModelId,
  maskKey,
};
