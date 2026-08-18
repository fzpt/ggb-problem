// Load .env if present before reading config.
const fsEnv = require('node:fs');
const pathEnv = require('node:path');
const envPath = pathEnv.join(__dirname, '.env');
if (fsEnv.existsSync(envPath)) {
  fsEnv.readFileSync(envPath, 'utf-8')
    .split(/\r?\n/)
    .forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2] || '';
      }
    });
}

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const config = require('./config');
const { extractTextFromImage, extractGeometryFromText, generateCommands, cancelCurrentRequest } = require('./providers');

const root = __dirname;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseImageDataUrl(body) {
  const match = body.image.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) {
    throw new Error('image must be a data URL like data:image/png;base64,...');
  }
  return match[2];
}

function providerHint(providerType, providerName) {
  if (providerName === 'baidu') {
    return '请设置 BAIDU_API_KEY 和 BAIDU_SECRET_KEY 环境变量。';
  }
  if (providerName === 'kimi') {
    return '请设置 KIMI_API_KEY 环境变量。';
  }
  if (providerName === 'openai') {
    return '请设置 OPENAI_API_KEY 环境变量。';
  }
  return '';
}

async function handleOcr(req, res) {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw.toString('utf-8'));
    if (!body.image || typeof body.image !== 'string') {
      return sendJson(res, 400, { error: 'Missing or invalid image field.' });
    }
    const base64 = parseImageDataUrl(body);
    const provider = body.provider || config.ocr.provider;
    const result = await extractTextFromImage(base64, provider, body.options || {});
    sendJson(res, 200, { provider, text: result.text });
  } catch (error) {
    console.error('[/api/ocr] error:', error);
    const provider = (() => {
      try { return JSON.parse(raw.toString('utf-8')).provider || config.ocr.provider; } catch { return config.ocr.provider; }
    })();
    sendJson(res, 500, {
      error: error.message || 'OCR failed',
      hint: providerHint('ocr', provider)
    });
  }
}

async function handleExtract(req, res) {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw.toString('utf-8'));
    if (!body.text || typeof body.text !== 'string') {
      return sendJson(res, 400, { error: 'Missing or invalid text field.' });
    }
    const provider = body.provider || config.llm.provider;
    const extracted = await extractGeometryFromText(body.text, provider, body.options || {});
    const commands = extracted.commands || generateCommands(extracted.geometry);

    sendJson(res, 200, {
      provider,
      text: extracted.text,
      geometry: extracted.geometry,
      assumptions: extracted.assumptions || [],
      commands
    });
  } catch (error) {
    console.error('[/api/extract] error:', error);
    const provider = (() => {
      try { return JSON.parse(raw.toString('utf-8')).provider || config.llm.provider; } catch { return config.llm.provider; }
    })();
    sendJson(res, 500, {
      error: error.message || 'Extraction failed',
      hint: providerHint('llm', provider)
    });
  }
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(root, safePath));

  if (!filePath.startsWith(root)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/ocr') {
    handleOcr(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/extract') {
    handleExtract(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/cancel') {
    const cancelled = cancelCurrentRequest();
    sendJson(res, 200, { cancelled });
    return;
  }

  serveStatic(req, res);
});

server.listen(config.port, () => {
  console.log(`GeoGebra photo pipeline running at http://localhost:${config.port}`);
  console.log(`OCR provider: ${config.ocr.provider}`);
  console.log(`LLM provider: ${config.llm.provider}`);
});
