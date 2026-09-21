// 智谱 GLM，OpenAI 兼容接口：https://open.bigmodel.cn/api/paas/v4/chat/completions
const https = require('node:https');

// hooks: { setCurrent(req), clearCurrent() } 用于接入每用户取消机制
function chat(apiKey, model, messages, hooks) {
  if (!apiKey) {
    return Promise.reject(new Error('智谱 API Key 未配置，请在管理后台填写。'));
  }
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ model, messages });
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
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (hooks && hooks.clearCurrent) hooks.clearCurrent();
        const body = Buffer.concat(chunks).toString('utf-8');
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) {
            reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          } else if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
            resolve(parsed.choices[0].message.content);
          } else {
            reject(new Error('Unexpected GLM response: ' + body.slice(0, 200)));
          }
        } catch (e) {
          reject(new Error('Failed to parse GLM response: ' + e.message));
        }
      });
    });
    request.on('error', (err) => {
      if (hooks && hooks.clearCurrent) hooks.clearCurrent();
      reject(err);
    });
    request.setTimeout(300000, () => request.destroy(new Error('GLM request timed out')));
    if (hooks && hooks.setCurrent) hooks.setCurrent(request);
    request.write(payload);
    request.end();
  });
}

module.exports = { chat };
