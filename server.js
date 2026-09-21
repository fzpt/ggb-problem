// Load .env into process.env if present.
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

const express = require('express');
const path = require('node:path');
const { toNodeHandler } = require('better-auth/node');

const config = require('./config');
const providers = require('./providers');
const db = require('./db');
const settings = require('./lib/settings');
const { MODELS, findModel } = require('./lib/models');
const { auth } = require('./auth');

const app = express();
const PORT = config.port;

// Enable CORS with credentials echoing the request origin.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
 res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

async function requireAuth(req, res, next) {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      const v = Array.isArray(value) ? value[0] : value;
      if (typeof v === 'string') {
        try { headers.set(key, v); } catch {}
      }
    }
    const session = await auth.api.getSession({ headers });
    if (!session?.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    req.userId = session.user.id;
    req.user = session.user;
    next();
  } catch (err) {
    console.error('auth middleware error:', err);
    return res.status(401).json({ error: 'Not authenticated' });
  }
}

function stripDataUrl(imageDataUrl) {
  if (!imageDataUrl) return '';
  return imageDataUrl.replace(/^data:image\/[^;]+;base64,/, '');
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!settings.isAdminEmail(req.user.email)) {
      return res.status(403).json({ error: '需要管理员权限' });
    }
    next();
  });
}

// Better Auth endpoints (registration, login, social callbacks, etc.)
app.use('/api/auth', toNodeHandler(auth));

// OCR
app.post('/api/ocr', requireAuth, async (req, res, next) => {
  try {
    const { image, provider } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: 'Image is required' });
    }
    const base64 = stripDataUrl(image);
    const result = await providers.extractTextFromImage(base64, provider);
    res.json({ text: result.text, provider: provider || config.ocr.provider, raw: result.raw });
  } catch (err) {
    next(err);
  }
});

// Extract geometry commands from text
app.post('/api/extract', requireAuth, async (req, res, next) => {
  try {
    const { text, provider, options } = req.body || {};
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }
    const opts = options || {};
    opts.userId = req.userId;
    const result = await providers.extractGeometryFromText(text, provider, opts);
    res.json({ ...result, provider: provider || config.llm.provider });
  } catch (err) {
    next(err);
  }
});

// Recognize + complete a problem from an image (or plain text)
app.post('/api/analyze-image', requireAuth, async (req, res, next) => {
  try {
    const { image, text, provider } = req.body || {};
    if (!image && !text) {
      return res.status(400).json({ error: 'Image or text is required' });
    }
    const base64 = image ? stripDataUrl(image) : '';
    const result = await providers.analyzeImage(base64, provider, {
      userId: req.userId,
      text,
    });
    res.json({ ...result, provider: provider || config.llm.provider });
  } catch (err) {
    next(err);
  }
});

// Construction order analysis + GeoGebra commands from problem text
app.post('/api/construction-analysis', requireAuth, async (req, res, next) => {
  try {
    const { text, provider } = req.body || {};
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }
    const result = await providers.analyzeConstruction(text, provider, {
      userId: req.userId,
    });
    res.json({ ...result, provider: provider || config.llm.provider });
  } catch (err) {
    next(err);
  }
});

// Refine commands
app.post('/api/refine', requireAuth, async (req, res, next) => {
  try {
    const { text, currentCommands, history, instruction, provider, currentObjects, mode } = req.body || {};
    if (!instruction) {
      return res.status(400).json({ error: 'Instruction is required' });
    }
    const result = await providers.refineGeometryCommands(
      text,
      currentCommands,
      history,
      provider,
      { instruction, userId: req.userId, currentObjects, mode }
    );
    res.json({ ...result, provider: provider || config.llm.provider });
  } catch (err) {
    next(err);
  }
});

// Cancel ongoing LLM request
app.post('/api/cancel', requireAuth, async (req, res, next) => {
  try {
    const { provider } = req.body || {};
    const cancelled = providers.cancelCurrentRequest(provider, { userId: req.userId });
    res.json({ cancelled });
  } catch (err) {
    next(err);
  }
});

// Per-user state
app.get('/api/state', requireAuth, (req, res, next) => {
  try {
    const state = db.loadState(req.userId);
    res.json(state);
  } catch (err) {
    next(err);
  }
});

// ---------- 管理后台 ----------

// 登录用户都可查自己的管理员状态（用于显示入口）
app.get('/api/admin/check', requireAuth, (req, res) => {
  res.json({ admin: settings.isAdminEmail(req.user.email) });
});

app.get('/api/admin/settings', requireAdmin, (req, res, next) => {
  try {
    const s = settings.getSettings();
    res.json({
      visionModel: s.visionModel,
      textModel: s.textModel,
      zhipuKeyMasked: settings.maskKey(s.keysZhipu),
      adminEmails: settings.getAdminEmails(),
      models: MODELS,
    });
  } catch (err) {
    next(err);
  }
});

app.put('/api/admin/settings', requireAdmin, (req, res, next) => {
  try {
    const { visionModel, textModel, zhipuKey, adminEmails } = req.body || {};
    const patch = {};
    if (visionModel) {
      const m = findModel(visionModel);
      if (!m || !m.vision) {
        return res.status(400).json({ error: '图片识别模型必须是支持视觉的模型' });
      }
      patch.visionModel = visionModel;
    }
    if (textModel) {
      if (!findModel(textModel)) {
        return res.status(400).json({ error: '未知的文本生成模型: ' + textModel });
      }
      patch.textModel = textModel;
    }
    if (typeof zhipuKey === 'string' && zhipuKey.trim()) {
      patch.keysZhipu = zhipuKey.trim() === '__clear__' ? '' : zhipuKey.trim();
    }
    if (Array.isArray(adminEmails)) {
      patch.adminEmails = adminEmails
        .map((e) => String(e).trim().toLowerCase())
        .filter(Boolean);
    }
    settings.saveSettings(patch);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/test-model', requireAdmin, async (req, res, next) => {
  try {
    const { model } = req.body || {};
    const result = await providers.testModel(model, req.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// 大模型调用任务查看（含排队/运行中/最近记录）
app.get('/api/admin/tasks', requireAdmin, (req, res, next) => {
  try {
    const events = providers.getTaskEvents().map((t) => {
      const email = t.userId && t.userId !== 'anonymous' ? db.getUserById(t.userId)?.email : null;
      return {
        ...t,
        email: email || t.userId,
        model: t.modelOverride || settings.resolveModelId(t.taskType || 'text'),
      };
    });
    res.json({ tasks: events });
  } catch (err) {
    next(err);
  }
});

// 管理员取消某用户正在运行的大模型请求
app.post('/api/admin/cancel-task', requireAdmin, (req, res, next) => {
  try {
    const { userId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const cancelled = providers.cancelCurrentRequest('kimi', { userId });
    res.json({ cancelled });
  } catch (err) {
    next(err);
  }
});

app.post('/api/state', requireAuth, (req, res, next) => {
  try {
    const { problems, activeProblemId } = req.body || {};
    db.saveState(req.userId, Array.isArray(problems) ? problems : [], activeProblemId || null);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Serve built client in production
app.use(express.static(path.join(__dirname, 'client/dist')));
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

async function start() {
  const ctx = await auth.$context;
  await ctx.runMigrations();
  db.migrateLegacyUsers();
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

start();
