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
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

const config = require('./config');
const providers = require('./providers');
const db = require('./db');

const app = express();
const PORT = config.port;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const COOKIE_NAME = 'token';

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
app.use(cookieParser());

function setAuthCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    cookie.stringifySetCookie({
      name: COOKIE_NAME,
      value: token,
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 7,
      sameSite: 'lax',
      path: '/',
      secure: false,
    })
  );
}

function clearAuthCookie(res) {
  res.setHeader(
    'Set-Cookie',
    cookie.stringifySetCookie({
      name: COOKIE_NAME,
      value: '',
      httpOnly: true,
      expires: new Date(0),
      sameSite: 'lax',
      path: '/',
      secure: false,
    })
  );
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '7d' });
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function stripDataUrl(imageDataUrl) {
  if (!imageDataUrl) return '';
  return imageDataUrl.replace(/^data:image\/[^;]+;base64,/, '');
}

// Auth endpoints
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const existing = db.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = db.createUser(email, passwordHash);
    const token = signToken(user.id);
    setAuthCookie(res, token);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const user = db.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = signToken(user.id);
    setAuthCookie(res, token);
    res.json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res, next) => {
  try {
    const user = db.getUserById(req.userId);
    if (!user) {
      clearAuthCookie(res);
      return res.status(401).json({ error: 'User not found' });
    }
    res.json({ id: user.id, email: user.email });
  } catch (err) {
    next(err);
  }
});

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
    const result = await providers.extractGeometryFromText(text, provider, options);
    res.json({ ...result, provider: provider || config.llm.provider });
  } catch (err) {
    next(err);
  }
});

// Refine commands
app.post('/api/refine', requireAuth, async (req, res, next) => {
  try {
    const { text, currentCommands, history, instruction, provider } = req.body || {};
    if (!instruction) {
      return res.status(400).json({ error: 'Instruction is required' });
    }
    const result = await providers.refineGeometryCommands(
      text,
      currentCommands,
      history,
      provider,
      { instruction }
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
    const cancelled = providers.cancelCurrentRequest(provider);
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

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
