const API_BASE = '';
const DEFAULT_TIMEOUT = 120000;

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

export function refineCommands(text, currentCommands, history, instruction, provider = 'kimi', signal) {
  return post('/api/refine', { text, currentCommands, history, instruction, provider }, signal);
}

export function cancelRequest() {
  return post('/api/cancel', {});
}

export async function loadState() {
  const res = await fetch(`${API_BASE}/api/state`);
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
