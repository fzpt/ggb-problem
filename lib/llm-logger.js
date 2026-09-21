// 大模型请求/响应日志：JSONL 格式，按大小与数量轮转。
// 文件名：llm-YYYYMMDD-序号.log；默认单文件 10MB、最多保留 100 个。
// 配置由 server.js 从 settings 同步（见 configure）。
const fs = require('node:fs');
const path = require('node:path');

const LOG_DIR = process.env.LLM_LOG_DIR || path.join(__dirname, '..', 'logs');

let maxBytes = 10 * 1024 * 1024;
let maxFiles = 100;
let current = null; // { date, seq, filePath, written }

const MAX_TEXT_CHARS = 20000;

function configure(opts = {}) {
  if (Number.isFinite(opts.maxMb) && opts.maxMb > 0) maxBytes = Math.floor(opts.maxMb * 1024 * 1024);
  if (Number.isFinite(opts.maxFiles) && opts.maxFiles > 0) maxFiles = Math.floor(opts.maxFiles);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateStamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function listLogFiles() {
  try {
    return fs.readdirSync(LOG_DIR).filter((f) => /^llm-\d{8}-\d{3}\.log$/.test(f));
  } catch {
    return [];
  }
}

function openNext() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const date = dateStamp();
  let seq = 1;
  if (current && current.date === date) {
    seq = current.seq + 1;
  } else {
    const prefix = `llm-${date}-`;
    for (const f of listLogFiles()) {
      if (f.startsWith(prefix)) {
        seq = Math.max(seq, parseInt(f.slice(prefix.length, prefix.length + 3), 10) + 1);
      }
    }
  }
  current = {
    date,
    seq,
    filePath: path.join(LOG_DIR, `llm-${date}-${String(seq).padStart(3, '0')}.log`),
    written: 0,
  };
}

function prune() {
  const files = listLogFiles()
    .map((name) => {
      try {
        return { name, mtime: fs.statSync(path.join(LOG_DIR, name)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.mtime - b.mtime);
  while (files.length > maxFiles) {
    const oldest = files.shift();
    try {
      fs.unlinkSync(path.join(LOG_DIR, oldest.name));
    } catch {
      /* ignore */
    }
  }
}

// 图片 base64 体积太大，只记录占位符；超长文本截断
function sanitize(value, depth = 0) {
  if (depth > 6) return '...';
  if (typeof value === 'string') {
    return value.length > MAX_TEXT_CHARS ? value.slice(0, MAX_TEXT_CHARS) + `…(truncated ${value.length} chars)` : value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'image_url' && v && typeof v.url === 'string' && v.url.startsWith('data:image')) {
        out[k] = { url: `<base64 image, ${v.url.length} chars>` };
      } else {
        out[k] = sanitize(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

// entry: { model, taskType, userId, ok, messages, response?, error?, durationMs }
function log(entry) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      model: entry.model,
      taskType: entry.taskType || 'text',
      userId: entry.userId || 'anonymous',
      ok: Boolean(entry.ok),
      durationMs: entry.durationMs,
      messages: sanitize(entry.messages),
      response: entry.ok ? sanitize(entry.response) : undefined,
      error: entry.ok ? undefined : entry.error,
    }) + '\n';

    if (!current || current.date !== dateStamp() || current.written + line.length > maxBytes) {
      openNext();
    }
    fs.appendFileSync(current.filePath, line);
    current.written += Buffer.byteLength(line);
    prune();
  } catch {
    // 日志失败不影响主流程
  }
}

function getStatus() {
  const files = listLogFiles()
    .map((name) => {
      try {
        const st = fs.statSync(path.join(LOG_DIR, name));
        return { name, size: st.size, mtime: st.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  return {
    dir: LOG_DIR,
    maxMb: Math.round(maxBytes / 1024 / 1024),
    maxFiles,
    fileCount: files.length,
    totalBytes: files.reduce((s, f) => s + f.size, 0),
    currentFile: current ? path.basename(current.filePath) : null,
    files: files.slice(0, 10),
  };
}

module.exports = { log, configure, getStatus, LOG_DIR };
