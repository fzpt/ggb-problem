const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const ggb = require('../lib/ggb-commands');
const settings = require('../lib/settings');
const zhipu = require('./zhipu');
const llmLogger = require('../lib/llm-logger');
const GG_REFERENCE = ggb.referenceText();

const DEFAULT_MODEL = 'kimi-k2.7-code';

// 统一出口：按模型 id 分发到 Kimi 或智谱，模型来自管理后台设置
function chatCompletion(messages, options = {}) {
  const model = options.model || settings.resolveModelId(options.taskType || 'text');
  const startedAt = Date.now();
  const logBase = {
    model,
    taskType: options.taskType || 'text',
    userId: options.userId,
    messages,
  };
  if (model.startsWith('glm')) {
    const hooks = {
      setCurrent: (req) => { getUserQueueState(options.userId).currentRequest = req; },
      clearCurrent: () => {
        const st = getUserQueueState(options.userId);
        if (st.currentRequest) st.currentRequest = null;
      },
    };
    return zhipu
      .chat(settings.getSettings().keysZhipu, model, messages, hooks)
      .then((content) => {
        llmLogger.log({ ...logBase, ok: true, response: content, durationMs: Date.now() - startedAt });
        return content;
      })
      .catch((err) => {
        llmLogger.log({ ...logBase, ok: false, error: err.message, durationMs: Date.now() - startedAt });
        throw err;
      });
  }
  const apiKey = config.llm.kimi.apiKey;
  if (!apiKey) {
    return Promise.reject(new Error('KIMI_API_KEY environment variable is not set.'));
  }
  return callKimi(apiKey, model, messages, options.userId).then(
    (content) => {
      llmLogger.log({ ...logBase, ok: true, response: content, durationMs: Date.now() - startedAt });
      return content;
    },
    (err) => {
      llmLogger.log({ ...logBase, ok: false, error: err.message, durationMs: Date.now() - startedAt });
      throw err;
    }
  );
}

const SYSTEM_PROMPT_JSON = `You are a geometry-to-JSON converter. Your only job is to read a Chinese geometry problem and output a single valid JSON object in the exact schema below. Do not output any other text, explanations, markdown fences, or reasoning.

Required output schema (exact field names):
{
  "text": "the cleaned Chinese problem text",
  "geometry": {
    "points": [
      {"name": "A", "x": 0, "y": 0, "label": "A"}
    ],
    "segments": [
      {"name": "c", "from": "A", "to": "B", "label": "c"}
    ],
    "lines": [
      {"name": "l", "points": ["A", "B"], "label": "l"}
    ],
    "circles": [
      {"name": "c1", "center": "O", "radiusPoint": "A", "label": "c1"}
    ],
    "angles": [
      {"name": "alpha", "vertex": "A", "sides": ["AB", "AC"], "value": 60, "label": "60掳"}
    ],
    "polygons": [
      {"name": "tri1", "vertices": ["A", "B", "C"], "label": "ABC"}
    ],
    "constraints": [
      {"type": "equalLength", "objects": ["AB", "AC"]},
      {"type": "perpendicular", "line1": "AB", "line2": "CD"},
      {"type": "parallel", "line1": "AB", "line2": "CD"},
      {"type": "tangent", "line": "PQ", "circle": "c1"},
      {"type": "collinear", "points": ["A", "B", "C"]}
    ]
  },
  "assumptions": ["assumption 1", "assumption 2"]
}

Rules:
1. Output ONLY valid JSON. No markdown code fences. No comments outside JSON.
2. Fix obvious OCR errors but keep geometric meaning.
3. If coordinates are missing, place A at (0,0), base AB on positive x-axis, C in positive y.
4. Use uppercase letters for points, lowercase/short names for segments/lines/circles/angles/polygons.
5. The "from" and "to" of a segment must be existing point names.
6. The "sides" of an angle are two segment names that share the vertex.
7. "AB=5cm" means length 5. "鈭燗=60掳" means angle at A equals 60. "鍨傜洿" = perpendicular. "骞宠" = parallel. "鈯橭" = circle centered at O.
8. If the problem is underdetermined, choose a simple canonical shape.`;

const SYSTEM_PROMPT_DIRECT = `You are a GeoGebra Geometry command generator. Read a Chinese geometry problem and output a short, valid GeoGebra Geometry script. Output ONLY a JSON object with one field "commands" containing a list of command strings. No markdown fences, no explanations.

Use commands like:
- A = (0, 0)
- B = (5, 0)
- C = (2, 3.46)
- Segment(A, B)
- Line(A, B)
- Circle(O, A)
- Polygon(A, B, C)
- Angle(B, A, C)
- PerpendicularBisector(A, B)
- Tangent(P, c1)

Rules:
1. Fix obvious OCR errors first (e.g. '0' between segments usually means parallel '//' or '鈭?; 'AI' should often be 'A'; 'P.2' should be 'P銆丵').
2. Ignore proof/conclusion statements; only construct the geometric figure.
3. Output only: {"commands": ["A = (0, 0)", "B = (5, 0)", ...]}
4. First create all points with numeric coordinates.
5. Then create segments, lines, circles, polygons, angles.
6. Use simple coordinates. Do not try to satisfy every constraint exactly; aim for a clear, approximate diagram.
7. If the problem is complex, include only the main points and connections, and add a comment line starting with // for anything omitted.
8. ONLY use commands from this verified reference:
${GG_REFERENCE}
 9. Before outputting, verify every command starts with one of the allowed names or is a coordinate assignment like "A = (0, 0)". Do not invent command names. If an element cannot be constructed with these commands, omit it and add a comment starting with //.
10. Final verification: double-check every command against the allowed GeoGebra Geometry API list above. Any command not in the list must be replaced with an equivalent allowed command or omitted with a // comment.
`;

const SYSTEM_PROMPT_INCREMENTAL = `You are a GeoGebra Geometry incremental adjustment engine. Your job: given the current objects on a GeoGebra diagram, the original problem, and a user's instruction, output a JSON patch of small operations to apply on the existing diagram. NEVER output a full rebuilt command list. ONLY output operations.

Allowed output format (exactly one top-level key "operations"):
{"operations": [{"op":"setCoords","name":"A","x":-2,"y":0}, {"op":"evalCommand","cmd":"Segment(A,B)"}, {"op":"deleteObject","name":"oldLine"}, {"op":"setVisible","name":"helper","visible":false}]}

Allowed operations (use only these):
- setCoords: move an existing point. Requires name, x, y.
- evalCommand: execute one valid GeoGebra Geometry command. Requires cmd.
- deleteObject: remove an existing object by name. Requires name.
- setVisible: toggle visibility. Requires name and visible (boolean).

Commands allowed inside evalCommand (verified official syntax):
${GG_REFERENCE}

Rules:
1. Output ONLY a JSON object with an "operations" array. No markdown code fences. No explanations. No "commands" key.
2. Make the smallest possible change that satisfies the instruction.
3. Do not invent command names; verify every evalCommand starts with an allowed command name.
4. If the instruction cannot be expressed with operations, output {"operations": []}.
5. Verify every operation uses one of: setCoords, evalCommand, deleteObject, setVisible.
6. Verify every evalCommand against the allowed GeoGebra Geometry API list. Replace or omit disallowed commands.
`;

const SYSTEM_PROMPT_REFINE = `You are a GeoGebra Geometry command refiner. Given an original geometry problem, current GeoGebra commands, and a user's adjustment instruction, output a complete revised list of GeoGebra commands as JSON.

Output format: {"commands": ["A = (0,0)", "Segment(A,B)", ...]}

Rules:
1. Output ONLY valid JSON. No markdown code fences. No explanations.
2. Keep the original construction intent unless the user explicitly asks to change it.
3. Apply the user's adjustment instruction precisely.
4. If the user asks to move a point, update its coordinates.
5. If the user asks to add an element, append the necessary commands.
6. Return the FULL revised command list, not just changes.
7. Use simple numeric coordinates.
8. Fix any obvious errors in the current commands if they would prevent rendering.
9. ONLY use commands from this verified reference:
${GG_REFERENCE}
10. Before outputting, verify every command starts with one of the allowed names or is a coordinate assignment like "A = (0, 0)". Do not invent command names. If a command is not in the list, replace it with an equivalent allowed command or omit it and add a comment starting with //.
11. Final verification: double-check every command against the allowed GeoGebra Geometry API list above. Any command not in the list must be replaced with an equivalent allowed command or omitted with a // comment.
`;

const SYSTEM_PROMPT_IMAGE_ANALYZE = `You are a geometry problem OCR and completion assistant. Analyze the input (a photo of a Chinese geometry problem, or plain problem text) and output a single valid JSON object with exactly two fields:

{
  "rawText": "the literal text recognized from the image, transcribed as-is (for text input, echo it verbatim)",
  "completedText": "the problem statement rewritten to be self-contained and complete"
}

Rules for completedText:
1. Keep the original meaning and wording; do not solve the problem.
2. Fill in missing implicit information, especially which segments/lines each named point belongs to (e.g. if a point is stated without saying which segment it lies on, state it explicitly; if a triangle is mentioned, spell out its connecting segments).
3. If a letter or symbol is ambiguous from OCR, choose the geometrically sensible reading.
4. Output ONLY valid JSON. No markdown fences. No explanations.`;

const SYSTEM_PROMPT_CONSTRUCTION = `You are a GeoGebra Geometry construction planner. Given a (completed) Chinese geometry problem, output a single valid JSON object with exactly two fields:

{
  "steps": [
    {"order": 1, "object": "A, B, C", "type": "自由点", "dependencies": "无", "constraint": "仅形状要求: AB > BC, C 在直线 AB 上方"}
  ],
  "commands": ["A = (0, 0)", "B = (6, 0)", "Segment(A, B)"]
}

The "steps" array describes the construction order analysis, one row per construction stage:
- order: 1-based integer
- object: the point(s) or main object(s) created in this stage
- type: e.g. 自由点 / 受约束点 / 交点 / 辅助点 / 线段 / 圆 etc.
- dependencies: the objects this stage depends on, or 无
- constraint: the geometric constraint that defines it (equal length, intersection, on segment, etc.)

The "commands" array is a GeoGebra Geometry script that realizes the construction:
1. ONLY the initial free points (points with no geometric constraint, e.g. the triangle's vertices) may use numeric coordinates like "A = (0, 0)". Usually just 2-4 free points.
2. Every OTHER point must be constructed through a geometric CONSTRAINT relationship. NEVER assign precomputed numeric coordinates to a constrained point, and NEVER write computed coordinate values (e.g. "D = (4, 0)", "F = (5.6, 2.77)") — the coordinates must emerge from the construction itself. Use commands such as:
   - Intersect( <Object>, <Object> ): intersections of lines/segments/rays/circles (e.g. point on a segment, crossing points).
   - Circle( <Point>, <Segment> ) to transfer a length onto another line, then Intersect: e.g. "D on segment AB with AD = BC" becomes: c1 = Circle(A, Segment(B, C)); D = Intersect(c1, Segment(A, B)).
   - Midpoint( <Point>, <Point> ), Rotate( <Point>, <Angle>, <Point> ), Point( <Object>, <Parameter> ) for points defined by other relations.
   Example: "F = intersection of ray DE and segment AC" becomes: r = Ray(D, E); F = Intersect(r, Segment(A, C)).
3. Then draw the final required segments/lines/circles/polygons.
4. ONLY use commands from this verified reference:
${GG_REFERENCE}
5. Auxiliary/intermediate construction products (helper circles, rays, temporary points that are NOT part of the final figure) must be hidden: immediately after creating such an object named X, append the line "SetVisibleInView(X, 1, false)".
6. Give explicit names to auxiliary objects (e.g. c1, r1, E) so they can be hidden.
7. Output ONLY valid JSON. No markdown fences. No explanations.`;

// Per-user queue and current request tracking.
const userQueues = new Map();
// 任务事件环形缓冲，供管理后台查看（新任务在前）；持久化到磁盘，重启不丢
const taskEvents = [];
const MAX_TASK_EVENTS = 100;
let taskSeq = 0;
const TASKS_FILE = path.join(__dirname, '..', 'llm-tasks.jsonl');

function persistTaskEvents() {
  try {
    const lines = taskEvents.slice().reverse().map((t) => JSON.stringify(t));
    fs.writeFileSync(TASKS_FILE, lines.join('\n') + (lines.length ? '\n' : ''));
  } catch {
    // 持久化失败不影响主流程
  }
}

function loadTaskEvents() {
  try {
    const content = fs.readFileSync(TASKS_FILE, 'utf-8');
    const parsed = content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    // 文件按最旧到最新存储，恢复为最新在前
    taskEvents.length = 0;
    taskEvents.push(...parsed.reverse().slice(0, MAX_TASK_EVENTS));
    taskSeq = taskEvents.reduce((max, t) => Math.max(max, t.id || 0), 0);
    // 重启时仍在排队/运行的任务已经不存在了，标记为中断
    for (const t of taskEvents) {
      if (t.status === 'queued' || t.status === 'running') {
        t.status = 'error';
        t.error = '服务重启，任务中断';
        t.finishedAt = t.finishedAt || Date.now();
      }
    }
  } catch {
    // 无历史文件或损坏则从头开始
  }
}
loadTaskEvents();

function pushTaskEvent(task) {
  taskEvents.unshift(task);
  if (taskEvents.length > MAX_TASK_EVENTS) taskEvents.pop();
  persistTaskEvents();
}

function getTaskEvents() {
  return taskEvents;
}

function getUserQueueState(userId) {
  const key = userId || 'anonymous';
  if (!userQueues.has(key)) {
    userQueues.set(key, { queue: [], processingQueue: false, currentRequest: null });
  }
  return userQueues.get(key);
}

function enqueue(fn, userId, meta = {}) {
  const state = getUserQueueState(userId);
  return new Promise((resolve, reject) => {
    const task = {
      id: ++taskSeq,
      userId: userId || 'anonymous',
      type: meta.type || 'unknown',
      taskType: meta.taskType || 'text',
      modelOverride: meta.model || null,
      status: 'queued',
      enqueuedAt: Date.now(),
    };
    state.queue.push({ fn, resolve, reject, task });
    pushTaskEvent(task);
    processQueue(userId);
  });
}

async function processQueue(userId) {
  const state = getUserQueueState(userId);
  if (state.processingQueue) return;
  state.processingQueue = true;
  while (state.queue.length) {
    const job = state.queue.shift();
    job.task.status = 'running';
    job.task.startedAt = Date.now();
    try {
      const result = await runWithRetry(job.fn);
      job.task.status = 'done';
      job.resolve(result);
    } catch (e) {
      job.task.status = e && e.message && e.message.includes('cancelled') ? 'cancelled' : 'error';
      job.task.error = (e && e.message) || 'unknown error';
      job.reject(e);
    } finally {
      job.task.finishedAt = Date.now();
      persistTaskEvents();
    }
  }
  state.processingQueue = false;
}

function isRetryableError(error) {
  const msg = (error && error.message || '').toLowerCase();
  return msg.includes('concurrency') || msg.includes('rate limit') || msg.includes('try again') || msg.includes('timed out');
}

async function runWithRetry(fn, retries = 3, delayMs = 1500) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isRetryableError(e) || i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastError;
}

function callKimi(apiKey, model, messages, userId) {
  const state = getUserQueueState(userId);
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ model, messages });

    state.currentRequest = https.request({
      hostname: 'api.moonshot.cn',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (response) => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        state.currentRequest = null;
        const body = Buffer.concat(chunks).toString('utf-8');
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) {
            reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          } else if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
            resolve(parsed.choices[0].message.content);
          } else {
            reject(new Error('Unexpected Kimi response: ' + body.slice(0, 200)));
          }
        } catch (error) {
          reject(new Error('Failed to parse Kimi response: ' + error.message));
        }
      });
    });

    state.currentRequest.on('error', (err) => {
      state.currentRequest = null;
      reject(err);
    });
    // 超时必须销毁连接，否则僵尸请求会一直占用组织唯一的并发槽位
    state.currentRequest.setTimeout(300000, () => {
      const req = state.currentRequest;
      if (req) req.destroy(new Error('Kimi request timed out'));
    });
    state.currentRequest.write(payload);
    state.currentRequest.end();
  });
}

function cancelCurrentRequest(userId) {
  const state = getUserQueueState(userId);
  if (state.currentRequest) {
    state.currentRequest.destroy(new Error('LLM request was cancelled.'));
    state.currentRequest = null;
    return true;
  }
  return false;
}

function cleanJsonResponse(content) {
  let s = (content || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  return s;
}

function callExtractFromText(text, options = {}) {
  const model = options.model || settings.resolveModelId('text');
  const mode = options.mode || 'json';
  const userId = options.userId;

  if (mode === 'direct') {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT_DIRECT },
      { role: 'user', content: `Generate GeoGebra Geometry commands for this problem:\n\n${text}` }
    ];
    return chatCompletion(messages, { model, userId }).then(content => {
      let parsed;
      try {
        parsed = JSON.parse(cleanJsonResponse(content));
      } catch (error) {
        throw new Error('Kimi response was not valid JSON: ' + error.message + '\nRaw: ' + content.slice(0, 500));
      }
      return {
        text: text,
        geometry: {},
        commands: Array.isArray(parsed.commands) ? parsed.commands : [],
        assumptions: parsed.assumptions || []
      };
    });
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT_JSON },
    { role: 'user', content: `Convert this geometry problem into the JSON schema:\n\n${text}` }
  ];

  return chatCompletion(messages, { model, userId }).then(content => {
    let parsed;
    try {
      parsed = JSON.parse(cleanJsonResponse(content));
    } catch (error) {
      throw new Error('Kimi response was not valid JSON: ' + error.message + '\nRaw: ' + content.slice(0, 500));
    }

    return {
      text: parsed.text || text,
      geometry: parsed.geometry || {},
      assumptions: parsed.assumptions || []
    };
  });
}

function extractFromText(text, options = {}) {
  return enqueue(() => callExtractFromText(text, options), options.userId, { type: '生成指令', taskType: 'text', model: options.model });
}

function parseJsonContent(content) {
  let parsed;
  try {
    parsed = JSON.parse(cleanJsonResponse(content));
  } catch (error) {
    throw new Error('Kimi response was not valid JSON: ' + error.message + '\nRaw: ' + content.slice(0, 500));
  }
  return parsed;
}

function buildCorrectionFeedback(invalid, isIncremental) {
  const lines = invalid.map((v, i) => (i + 1) + '. ' + JSON.stringify(v.item) + '\n   Reason: ' + v.reason);
  const kind = isIncremental ? 'operations array' : 'commands array';
  return 'Some entries in your previous ' + kind + ' are invalid:\n' + lines.join('\n') +
    '\n\nOutput the complete corrected JSON again. Use ONLY commands from the verified reference. ' +
    'If an element cannot be expressed with the allowed commands, omit it.';
}

function callRefineFromText(text, currentCommands, history, options = {}) {
    const model = options.model || settings.resolveModelId('text');
  const userId = options.userId;
  const isIncremental = options.mode === 'incremental' || (Array.isArray(options.currentObjects) && options.currentObjects.length > 0);
  const historyText = (history || []).map(h => {
    const role = h.role || (h.user ? 'user' : 'kimi');
    const textPart = h.text || h.user || (Array.isArray(h.response) ? h.response.join('\n') : h.response || '');
    return `${role === 'user' ? 'User' : 'Kimi'}: ${textPart}`;
  }).join('\n\n');

  let systemPrompt = SYSTEM_PROMPT_REFINE;
  let userContent = `Original problem:\n${text}\n\nCurrent GeoGebra commands:\n${currentCommands}\n\n${historyText ? 'Adjustment history:\n' + historyText + '\n\n' : ''}New adjustment instruction:\n${options.instruction || ''}`;

  if (isIncremental) {
    systemPrompt = SYSTEM_PROMPT_INCREMENTAL;
    const objectsText = JSON.stringify(options.currentObjects || [], null, 2);
    userContent = `Original problem:\n${text}\n\nCurrent GeoGebra objects (snapshot):\n${objectsText}\n\n${historyText ? 'Adjustment history:\n' + historyText + '\n\n' : ''}New adjustment instruction:\n${options.instruction || ''}`;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ];

  return (async () => {
    let content = await chatCompletion(messages, { model, userId });
    let parsed = parseJsonContent(content);
    let validation = isIncremental
      ? ggb.validateOperations(parsed.operations)
      : ggb.validateCommands(parsed.commands);

    // Plan 2: deterministic server-side check; feed concrete errors back for one retry.
    if (validation.invalid.length > 0) {
      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: buildCorrectionFeedback(validation.invalid, isIncremental) });
      content = await chatCompletion(messages, { model, userId });
      parsed = parseJsonContent(content);
      validation = isIncremental
        ? ggb.validateOperations(parsed.operations)
        : ggb.validateCommands(parsed.commands);
    }

    const result = {
      text: text,
      geometry: {},
      commands: Array.isArray(parsed.commands) ? parsed.commands : [],
      assumptions: parsed.assumptions || []
    };
    if (isIncremental) {
      result.operations = validation.valid;
    } else {
      result.commands = validation.valid;
    }
    if (validation.invalid.length > 0) {
      result.warnings = validation.invalid.map(v => v.reason);
    }
    return result;
  })();
}

function refineFromText(text, currentCommands, history, options = {}) {
  return enqueue(() => callRefineFromText(text, currentCommands, history, options), options.userId, { type: '指令调整', taskType: 'text', model: options.model });
}

function callAnalyzeImage(base64, options = {}) {
  const model = options.model || settings.resolveModelId('vision');
  const userId = options.userId;

  const content = [];
  if (base64) {
    content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } });
    content.push({
      type: 'text',
      text: 'Recognize and complete this geometry problem. Output only the JSON object.'
    });
  } else {
    content.push({
      type: 'text',
      text: 'Complete this geometry problem text: fill in missing implicit information, especially which segments/lines each named point belongs to, while keeping the original meaning. Output only the JSON object.\n\nProblem text:\n' + (options.text || '')
    });
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT_IMAGE_ANALYZE },
    { role: 'user', content }
  ];

  return chatCompletion(messages, { model, userId }).then(contentText => {
    const parsed = parseJsonContent(contentText);
    return {
      rawText: parsed.rawText || '',
      completedText: parsed.completedText || parsed.rawText || ''
    };
  });
}

function analyzeImage(base64, options = {}) {
  return enqueue(() => callAnalyzeImage(base64, options), options.userId, { type: '图片识别', taskType: 'vision', model: options.model });
}

function callAnalyzeConstruction(text, options = {}) {
  const model = options.model || settings.resolveModelId('text');
  const userId = options.userId;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT_CONSTRUCTION },
    { role: 'user', content: `Analyze the construction of this geometry problem and produce the construction plan and GeoGebra commands:\n\n${text}` }
  ];

  return (async () => {
    let content = await chatCompletion(messages, { model, userId });
    let parsed = parseJsonContent(content);
    let validation = ggb.validateCommands(parsed.commands);

    if (validation.invalid.length > 0) {
      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: buildCorrectionFeedback(validation.invalid, false) });
      content = await chatCompletion(messages, { model, userId });
      parsed = parseJsonContent(content);
      validation = ggb.validateCommands(parsed.commands);
    }

    const steps = Array.isArray(parsed.steps) ? parsed.steps.map((s, i) => ({
      order: s.order != null ? s.order : i + 1,
      object: s.object || '',
      type: s.type || '',
      dependencies: s.dependencies || '无',
      constraint: s.constraint || ''
    })) : [];

    const result = { steps, commands: validation.valid };
    if (validation.invalid.length > 0) {
      result.warnings = validation.invalid.map(v => v.reason);
    }
    return result;
  })();
}

function analyzeConstruction(text, options = {}) {
  return enqueue(() => callAnalyzeConstruction(text, options), options.userId, { type: '作图分析', taskType: 'text', model: options.model });
}

module.exports = {
  extractFromText,
  refineFromText,
  analyzeImage,
  analyzeConstruction,
  chatCompletion,
  getTaskEvents,
  runTask: enqueue,
  cancelCurrentRequest
};
