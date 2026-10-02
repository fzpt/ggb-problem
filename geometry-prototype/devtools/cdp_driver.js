/* CDP 测试驱动（替代 /tmp 旧版）：node cdp_driver.js <port|x> <scenario.js>
 * scenario 文件顶层定义 async function run(ctx)，ctx = { ev, mouse, sleep, log }。
 * mouse(type, x, y, opts)：type = mousePressed | mouseReleased | mouseMoved；
 *   opts = { button:'left', clickCount:1, modifiers }，modifiers 沿用旧约定：2 表示多选键。
 */
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

async function main() {
  const portArg = process.argv[2];
  const scenarioPath = process.argv[3] || process.argv[2];
  const port = /^\d+$/.test(portArg || '') ? parseInt(portArg, 10) : 19224;
  if (!scenarioPath || scenarioPath === portArg) {
    console.error('usage: node cdp_driver.js <port|x> <scenario.js>');
    process.exit(2);
  }
  const list = JSON.parse(await httpGet('http://127.0.0.1:' + port + '/json'));
  const page = list.find((t) => t.type === 'page' && /^file:/.test(t.url)) || list.find((t) => t.type === 'page');
  if (!page) { console.error('no page target'); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let seq = 0;
  const pending = new Map();
  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout: ' + method)); } }, 30000);
  });

  const ev = async (code) => {
    const r = await send('Runtime.evaluate', {
      expression: code, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      const t = r.exceptionDetails.text || (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || 'eval error';
      throw new Error('page eval failed: ' + t);
    }
    return r.result && r.result.value;
  };
  const mouse = async (type, x, y, opts) => {
    const o = opts || {};
    const params = { type, x: Math.round(x), y: Math.round(y) };
    if (type === 'mousePressed' || type === 'mouseReleased') {
      params.button = o.button || 'left';
      params.clickCount = o.clickCount || 1;
    }
    if (o.modifiers) params.modifiers = o.modifiers;
    await send('Input.dispatchMouseEvent', params);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log('[SCN]', ...a);
  const ctx = { ev, mouse, sleep, log };

  const code = fs.readFileSync(scenarioPath, 'utf8');
  const fn = new Function('ctx', code + '\nreturn run(ctx);');
  const timeout = setTimeout(() => { console.error('scenario timeout'); process.exit(3); }, 240000);
  try {
    await fn(ctx);
  } finally {
    clearTimeout(timeout);
    ws.close();
  }
}

main().catch((e) => { console.error('driver error:', e.message); process.exit(1); });
