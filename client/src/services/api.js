const API_BASE = '';

async function post(path, body, signal) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || data.message || '请求失败');
  }
  return data;
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
