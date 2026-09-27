import { createAuthClient } from 'better-auth/react';

const API_BASE = '';
// GLM 等模型响应时间波动大（实测 12s-390s），客户端超时放宽到 10 分钟，
// 与服务端重试机制（300s x 3）匹配
const DEFAULT_TIMEOUT = 600000;

// Better Auth client base URL. Use the current origin so it works both in
// Vite dev (http://localhost:5173) and production (http://localhost:3000).
const AUTH_BASE_URL = typeof window !== 'undefined'
  ? window.location.origin
  : 'http://localhost:3000';

export const authClient = createAuthClient({
  baseURL: AUTH_BASE_URL,
});

export const { signIn, signUp, signOut, useSession } = authClient;

function combineSignals(s1, s2) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  s1.addEventListener('abort', onAbort, { once: true });
  s2.addEventListener('abort', onAbort, { once: true });
  if (s1.aborted || s2.aborted) controller.abort();
  return controller.signal;
}

async function post(path, body, signal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('请求超时，请检查网络或 provider 配置'));
  }, DEFAULT_TIMEOUT);
  const combined = signal
    ? { signal: combineSignals(controller.signal, signal) }
    : { signal: controller.signal };
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
      ...combined,
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text || `请求失败，状态码 ${res.status}` };
    }
    if (!res.ok) {
      throw new Error(data.error || data.message || text || `请求失败 ${res.status}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export function recognizeImage(imageDataUrl, provider = 'baidu', signal) {
  return post('/api/ocr', { image: imageDataUrl, provider }, signal);
}

export function extractCommands(text, provider = 'kimi', signal) {
  return post('/api/extract', { text, provider, options: { mode: 'direct' } }, signal);
}

// 图片/文字识别 + 题目补全，返回 { rawText, completedText }
export function analyzeProblemImage(imageDataUrl, text, signal) {
  return post('/api/analyze-image', { image: imageDataUrl || undefined, text: text || undefined }, signal);
}

// 作图分析，返回 { steps: [...], commands: [...], warnings? }
export function analyzeConstruction(text, signal) {
  return post('/api/construction-analysis', { text }, signal);
}

// 合并一步：识别 + 完善题目 + 可构造性判定 + 作图指令，单次调用完成
// 返回 { rawText, completedText, constructibility, constructNote, commands, warnings? }
export function analyzeOnce(imageDataUrl, text, signal) {
  return post('/api/analyze-once', { image: imageDataUrl || undefined, text: text || undefined }, signal);
}

export function refineCommands(
  text,
  currentCommands,
  history,
  instruction,
  provider = 'kimi',
  options = {},
  signal
) {
  return post('/api/refine', {
    text,
    currentCommands,
    history,
    instruction,
    provider,
    currentObjects: options.currentObjects,
    mode: options.mode,
  }, signal);
}

export function cancelRequest() {
  return post('/api/cancel', {});
}

// ---------- 管理后台 ----------
export function getAdminCheck() {
  return fetch(`${API_BASE}/api/admin/check`, { credentials: 'include' }).then((r) => r.json());
}

export function getAdminSettings() {
  return fetch(`${API_BASE}/api/admin/settings`, { credentials: 'include' }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `请求失败 ${r.status}`);
    return data;
  });
}

export function putAdminSettings(patch) {
  return fetch(`${API_BASE}/api/admin/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    credentials: 'include',
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `请求失败 ${r.status}`);
    return data;
  });
}

export function testAdminModel(model) {
  return post('/api/admin/test-model', { model });
}

export function getAdminTasks() {
  return fetch(`${API_BASE}/api/admin/tasks`, { credentials: 'include' }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `请求失败 ${r.status}`);
    return data;
  });
}

export function cancelAdminTask(userId) {
  return post('/api/admin/cancel-task', { userId });
}

export function getAdminLogs() {
  return fetch(`${API_BASE}/api/admin/logs`, { credentials: 'include' }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `请求失败 ${r.status}`);
    return data;
  });
}

export function getAdminAiCalls({ days = 30, limit = 200 } = {}) {
  return fetch(`${API_BASE}/api/admin/ai-calls?days=${days}&limit=${limit}`, { credentials: 'include' }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `请求失败 ${r.status}`);
    return data;
  });
}

export async function loadState() {
  const res = await fetch(`${API_BASE}/api/state`, { credentials: 'include' });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text || `请求失败，状态码 ${res.status}` };
  }
  if (!res.ok) {
    throw new Error(data.error || data.message || text || `请求失败 ${res.status}`);
  }
  return data;
}

export function saveState(state) {
  return post('/api/state', state);
}

// 每题增删改（增量同步）
export function putProblem(id, problem) {
  return fetch(`${API_BASE}/api/problems/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(problem),
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `请求失败 ${r.status}`);
    return data;
  });
}

export function deleteProblemRemote(id) {
  return fetch(`${API_BASE}/api/problems/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `请求失败 ${r.status}`);
    return data;
  });
}

export function saveActiveProblemId(activeProblemId) {
  return post('/api/state/active', { activeProblemId });
}

// 编辑锁：409 时抛出带 lockedBy 信息的错误，由调用方决定是否强制接管
async function lockFetch(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.lockedBy ? `该题正在被 ${data.lockedBy} 编辑` : (data.error || `请求失败 ${res.status}`));
    err.lockedBy = data.lockedBy;
    err.since = data.since;
    throw err;
  }
  return data;
}

export function acquireProblemLock(id, instanceId, force = false) {
  return lockFetch(`/api/problems/${id}/lock`, { instanceId, force });
}

export function releaseProblemLock(id, instanceId) {
  return lockFetch(`/api/problems/${id}/unlock`, { instanceId });
}

export function getLocks() {
  return fetch(`${API_BASE}/api/locks`, { credentials: 'include' }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `请求失败 ${r.status}`);
    return data;
  });
}

// ---------- 题目图形版本快照 ----------
export function listProblemVersions(problemId) {
  return fetch(`${API_BASE}/api/problems/${encodeURIComponent(problemId)}/versions`, { credentials: 'include' }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `请求失败 ${r.status}`);
    return data;
  });
}

export function saveProblemVersion(problemId, ggbState, force = false) {
  return post(`/api/problems/${encodeURIComponent(problemId)}/versions`, { ggbState, force });
}

export function getProblemVersion(problemId, versionId) {
  return fetch(
    `${API_BASE}/api/problems/${encodeURIComponent(problemId)}/versions/${encodeURIComponent(versionId)}`,
    { credentials: 'include' }
  ).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `请求失败 ${r.status}`);
    return data;
  });
}

export function deleteProblemVersion(problemId, versionId) {
  return fetch(
    `${API_BASE}/api/problems/${encodeURIComponent(problemId)}/versions/${encodeURIComponent(versionId)}`,
    { method: 'DELETE', credentials: 'include' }
  ).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `请求失败 ${r.status}`);
    return data;
  });
}

// ---------- 题目属性 / 知识点词表 ----------
export async function queryProblems(filters = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && v !== '') qs.set(k, v);
  }
  const res = await fetch(`${API_BASE}/api/problems/query?${qs.toString()}`, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data;
}

export function getKnowledgeTags() {
  return fetch(`${API_BASE}/api/knowledge-tags`, { credentials: 'include' }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `请求失败 ${r.status}`);
    return data;
  });
}

export function createKnowledgeTag(name, category) {
  return post('/api/knowledge-tags', { name, category });
}
