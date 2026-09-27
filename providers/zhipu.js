// 智谱 GLM，OpenAI 兼容接口：https://open.bigmodel.cn/api/paas/v4/chat/completions
const https = require('node:https');

// hooks: { setCurrent(req), clearCurrent() } 用于接入每用户取消机制
function chat(apiKey, model, messages, hooks) {
  if (!apiKey) {
    return Promise.reject(new Error('智谱 API Key 未配置，请在管理后台填写。'));
  }
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ model, messages, stream: true, stream_options: { include_usage: true } });
    // 响应头先于 body 到达；超时/断线时 body 读不到，但这里已能拿到服务商的请求 ID
    let providerCallId = null;
    let usage = null;
    let contentParts = [];
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (hooks && hooks.clearCurrent) hooks.clearCurrent();
      if (providerCallId && !err.providerCallId) err.providerCallId = providerCallId;
      reject(err);
    };

    const request = https.request({
      hostname: 'open.bigmodel.cn',
      port: 443,
      path: '/api/paas/v4/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (response) => {
      providerCallId = response.headers['x-request-id'] || null;
      if (response.statusCode && response.statusCode >= 400) {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          let msg = body.slice(0, 300);
          try {
            const parsed = JSON.parse(body);
            if (parsed.error) msg = parsed.error.message || JSON.stringify(parsed.error);
          } catch { /* keep raw body */ }
          const e = new Error(`GLM HTTP ${response.statusCode}: ${msg}`);
          e.providerCallId = providerCallId;
          fail(e);
        });
        return;
      }
      // SSE 流：data: 行，以 [DONE] 结束；首个 chunk 的 id 即调用 ID
      let buf = '';
      response.on('data', (chunk) => {
        buf += chunk.toString('utf-8');
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            settled = true;
            if (hooks && hooks.clearCurrent) hooks.clearCurrent();
            resolve({ content: contentParts.join(''), providerCallId, usage });
            return;
          }
          try {
            const j = JSON.parse(data);
            if (j.id && !providerCallId) providerCallId = j.id;
            if (j.usage) usage = j.usage;
            const delta = j.choices && j.choices[0] && j.choices[0].delta;
            if (delta && typeof delta.content === 'string') contentParts.push(delta.content);
          } catch {
            // 忽略不完整的 chunk 行
          }
        }
      });
      response.on('end', () => {
        if (settled) return;
        // 未收到 [DONE] 连接就结束了：内容可能不完整，但仍返回已收部分
        settled = true;
        if (hooks && hooks.clearCurrent) hooks.clearCurrent();
        resolve({ content: contentParts.join(''), providerCallId, usage });
      });
    });
    request.on('error', (err) => {
      fail(err);
    });
    request.setTimeout(300000, () => request.destroy(new Error('GLM request timed out')));
    if (hooks && hooks.setCurrent) hooks.setCurrent(request);
    request.write(payload);
    request.end();
  });
}

module.exports = { chat };
