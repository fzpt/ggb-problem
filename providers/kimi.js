const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const db = require('../db');
const ggb = require('../lib/ggb-commands');
const jxg = require('../lib/jxg-steps');
const settings = require('../lib/settings');
const zhipu = require('./zhipu');
const llmLogger = require('../lib/llm-logger');
const GG_REFERENCE = ggb.referenceText();
const JXG_REFERENCE = jxg.referenceText();

const DEFAULT_MODEL = 'kimi-k2.7-code';

// 统一出口：按模型 id 分发——带 '/' 走硅基流动，glm 开头走智谱，其余走 Kimi 官方；
// 模型来自管理后台设置。
// chatCompletionDetailed 额外返回 usage 等计费信息（对比测试/核算用）。
function chatCompletionDetailed(messages, options = {}) {
  const model = options.model || settings.resolveModelId(options.taskType || 'text');
  const startedAt = Date.now();
  const logBase = {
    callId: crypto.randomUUID(),
    model,
    taskType: options.taskType || 'text',
    userId: options.userId,
    messages,
  };
  let result;
  if (model.includes('/')) {
    // 硅基流动的模型 id 一律带 '/'（如 Qwen/Qwen3.8-27B、moonshotai/Kimi-K2.7-Code）
    const sfKey = process.env.SILICONFLOW_API_KEY;
    if (!sfKey) {
      return Promise.reject(new Error('SILICONFLOW_API_KEY environment variable is not set.'));
    }
    result = callKimi(sfKey, model, messages, options.userId, {
      hostname: 'api.siliconflow.cn',
      path: '/v1/chat/completions',
      label: 'SiliconFlow',
    });
  } else if (model.startsWith('glm')) {
    const hooks = {
      setCurrent: (req) => { getUserQueueState(options.userId).currentRequest = req; },
      clearCurrent: () => {
        const st = getUserQueueState(options.userId);
        if (st.currentRequest) st.currentRequest = null;
      },
    };
    result = zhipu.chat(settings.getSettings().keysZhipu, model, messages, hooks);
  } else {
    const apiKey = config.llm.kimi.apiKey;
    if (!apiKey) {
      return Promise.reject(new Error('KIMI_API_KEY environment variable is not set.'));
    }
    result = callKimi(apiKey, model, messages, options.userId);
  }
  return result.then(
    ({ content, providerCallId, usage }) => {
      db.insertAiCall({ callId: logBase.callId, providerCallId, userId: logBase.userId, model, taskType: logBase.taskType, usage, ok: true, durationMs: Date.now() - startedAt });
      llmLogger.log({ ...logBase, ok: true, response: content, providerCallId, durationMs: Date.now() - startedAt });
      return { content, providerCallId, usage, callId: logBase.callId };
    },
    (err) => {
      db.insertAiCall({ callId: logBase.callId, providerCallId: err.providerCallId || null, userId: logBase.userId, model, taskType: logBase.taskType, usage: null, ok: false, error: err.message, durationMs: Date.now() - startedAt });
      llmLogger.log({ ...logBase, ok: false, error: err.message, providerCallId: err.providerCallId, durationMs: Date.now() - startedAt });
      throw err;
    }
  );
}

function chatCompletion(messages, options = {}) {
  return chatCompletionDetailed(messages, options).then((r) => r.content);
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

// 合并一步：识别 + 完善题目 + 可构造性判定 + 作图指令，单次调用完成。
// 提示词历经多轮实测调优（scripts/kimi-direct-test.js），约束项均来自真实踩坑记录。
const SYSTEM_PROMPT_ONESHOT = `读取图片或文字中的几何题，输出一个 JSON 对象：
{"rawText":"识别出的题目原文","completedText":"补全点所属线段后的完整题目","constructibility":"direct | conclusion | impossible","constructNote":"constructibility 为 conclusion 时的说明，其他情况为空字符串","commands":["GeoGebra Geometry 作图指令，每行一条"]}。
只输出 JSON，不要输出其他内容。

只做作图，不要证明、验证或解答题目。

作图前必须先判断能否通过作图方式完成，constructibility 取值：
- direct：可以直接按题意作图
- conclusion：直接作图困难，需要把题目结论（或部分结论）当作已知条件来定位点
- impossible：无法用 GeoGebra Geometry 作图
constructibility 为 conclusion 时，必须在 constructNote 中说明把哪个结论当作了条件。

题目文字处理：completedText 中如果出现"如图""如图所示"等引用图片的字样，必须去掉。

作图要求：
- 确定题目中的自由点和从动点；从动点必须用几何关系（公式/约束）定位，不能写死数值坐标。条件复杂时，可以把结论当作条件进行点的定位。
- 作图过程增加的辅助元素（辅助线、辅助圆等）最后都要用 SetVisibleInView(名称, 1, false) 隐藏。

GeoGebra Geometry 应用的实测限制（必须遵守）：
- 画平行线用 Line(点, 已有的线)，没有 Parallel 命令
- 外接圆用 Circle(A, B, C)，没有 Circumcircle 命令
- 中垂线用 PerpendicularBisector，垂线用 PerpendicularLine
- 圆弧命令名是 CircularArc，不是 CircleArc
- Polyline 是一个词，不是 PolyLine
- 过点向线段作垂线求垂足时：垂足必须用辅助直线求交（lineAB = Line(A,B)；H = Intersect(PerpendicularLine(P, lineAB), lineAB)），不要和线段求交（垂足在线段外时线段求交会失败）；辅助直线按上面的隐藏规则处理
- 线段与其他直线或曲线求交点时：必须用辅助直线代替线段求交（lineAB = Line(A, B)；P = Intersect(lineAB, 另一对象)），不要与线段求交（交点落在线段延长线上时会失败）；得到交点后，必须把交点与线段两个端点分别连线 Segment(A, P)、Segment(P, B)，使交点在线段上可见；辅助直线按上面的隐藏规则处理`;

const SYSTEM_PROMPT_IMAGE_ANALYZE = `You are a geometry problem OCR and completion assistant. Analyze the input (a photo of a Chinese geometry problem, or plain problem text) and output a single valid JSON object with exactly two fields:

{
  "rawText": "the literal text recognized from the image, transcribed as-is (for text input, echo it verbatim)",
  "completedText": "the problem statement rewritten to be self-contained and complete"
}

Rules for completedText:
1. Keep the original meaning and wording; do not prove or solve the problem.
2. Fill in missing implicit information, especially which segments/lines each named point belongs to (e.g. if a point is stated without saying which segment it lies on, state it explicitly; if a triangle is mentioned, spell out its connecting segments).
3. If a letter or symbol is ambiguous from OCR, choose the geometrically sensible reading.
4. Remove figure references such as "如图" or "如图所示" from completedText (the figure is generated, not referenced).
5. Output ONLY valid JSON. No markdown fences. No explanations.`;

const SYSTEM_PROMPT_CONSTRUCTION = `You are a GeoGebra Geometry construction planner, NEVER prove, verify, or solve the problem. Given a (completed) Chinese geometry problem, output a single valid JSON object with exactly four fields,Output ONLY valid JSON. No markdown fences. No explanations:
{
  "steps": [
    {"order": 1, "object": "A, B, C", "type": "自由点", "dependencies": "无", "constraint": "仅形状要求: AB > BC, C 在直线 AB 上方"}
  ],
  "commands": ["A = (0, 0)", "B = (6, 0)", "Segment(A, B)"],
  "constructibility": "direct | conclusion | impossible",
  "constructNote": "constructibility 为 conclusion 时的说明，其他情况为空字符串"
}

Before planning, judge how the figure can be constructed, "constructibility" value:
- direct: the figure can be built directly from the problem conditions
- conclusion: direct construction is too difficult; some conclusion of the problem must be used as a given condition to position points
- impossible: cannot be drawn in GeoGebra Geometry
When constructibility is conclusion, constructNote MUST explain which conclusion was used as a condition.

The "steps" array describes the construction order analysis, one row per construction stage:
- order: 1-based integer
- object: the point(s) or main object(s) created in this stage
- type: e.g. 自由点 / 受约束点 / 交点 / 辅助点 / 线段 / 圆 etc.
- dependencies: the objects this stage depends on, or 无
- constraint: the geometric constraint that defines it (equal length, intersection, on segment, etc.)

The "commands" array is a GeoGebra Geometry script that realizes the construction:
1. ONLY the initial free points (points with no geometric constraint, e.g. the triangle's vertices) may use numeric coordinates like "A = (0, 0)". Usually just 2-4 free points.
2. Every OTHER point must be constructed through a geometric CONSTRAINT relationship. NEVER assign precomputed numeric coordinates to a constrained point.
3. If the conditions are too complex, you may use the problem's conclusion (or part of it) as a given condition to position points; mark constructibility as conclusion and explain in constructNote.
4. Then draw the final required segments/lines/circles/polygons.
5. Auxiliary/intermediate construction products (helper circles, rays, temporary points that are NOT part of the final figure) must be hidden: immediately after creating such an object named X, append the line "SetVisibleInView(X, 1, false)".
6. Give explicit names to auxiliary objects (e.g. c1, r1, E) so they can be hidden.

Verified GeoGebra Geometry command pitfalls (must obey):
- Parallel lines: use Line( <Point>, <Existing Line> ); there is NO Parallel command
- Circumcircle: use Circle(A, B, C); there is NO Circumcircle command
- Perpendicular bisector is PerpendicularBisector, perpendicular line is PerpendicularLine
- Arc command name is CircularArc, not CircleArc
- Polyline is one word, not PolyLine
- Foot of perpendicular from a point to a segment: intersect with an auxiliary LINE (lineAB = Line(A,B); H = Intersect(PerpendicularLine(P, lineAB), lineAB)), NOT with the segment (intersecting a segment fails when the foot lies outside the segment); hide the auxiliary line as above.
- Segment intersecting another line or curve: ALWAYS intersect an auxiliary line through the segment's endpoints (lineAB = Line(A, B); P = Intersect(lineAB, other)), NEVER the segment itself (intersecting a segment fails when the crossing point lies on the segment's extension). After obtaining the intersection P, connect P to BOTH endpoints of the segment: Segment(A, P) and Segment(P, B), so the intersection is visibly joined on the segment; hide the auxiliary line as above.`;

// ---------- JSXGraph 版提示词（format=jxg）：输出 JSON 构造步骤而非 GeoGebra 命令 ----------

const JXG_COMMON_RULES = `
JSON construction steps schema (each step is one JSON object, top level is an array):
${'${JXG_REFERENCE}'}

Hard rules for the "jxgSteps" array:
1. ONLY the initial free points (with no geometric constraint, e.g. the triangle's vertices) may use numeric "coords". Usually just 2-4 free points.
2. Every OTHER point must be positioned through a geometric CONSTRAINT, never precomputed numeric coords:
   - ratio/distance positioning (e.g. AD = BC/AB along a segment) -> { "type": "dilate", "of": ..., "center": ..., "ratio": ... }
   - rotation by a KNOWN numeric angle -> { "type": "rotate", "of": ..., "center": ..., "angle": ... }
   - anything else -> { "type": "exprpoint", "x": "...", "y": "..." } with expressions built ONLY from x(A), y(A), Distance(A,B), numbers, + - * / and parentheses
3. Every referenced id MUST be defined by an EARLIER step. Steps are replayed in order.
4. ids must be unique, letters/digits/underscore, start with a letter (plain names like A, B, C, D, F, M, O, H are best).
5. Auxiliary/intermediate products (helper circles, rays, temporary points NOT in the final figure) must carry "visible": false on their step.
6. NEVER prove, verify, or solve the problem. Construction only.
7. Positional constraints (e.g. "P and Q lie on opposite sides of line BC", "同侧", "异侧", "在...上方") must NEVER be expressed by guessing an "index" (an index has no stable geometric meaning). Instead add a "side" object to the intersection step: { "type": "intersection", "id": "Q", "e1": "circ1", "e2": "line1", "side": { "line": "segBC", "point": "P", "rel": "opposite" } } (use "same" for the same side). The "side.line" must be a line/segment/ray defined by an EARLIER step.`;

const SYSTEM_PROMPT_JXG_CONSTRUCTION = `You are a geometry construction planner, NEVER prove, verify, or solve the problem. Given a (completed) Chinese geometry problem, output a single valid JSON object with exactly four fields. Output ONLY valid JSON. No markdown fences. No explanations:
{
  "steps": [
    {"order": 1, "object": "A, B, C", "type": "自由点", "dependencies": "无", "constraint": "仅形状要求: AB > BC, C 在直线 AB 上方"}
  ],
  "jxgSteps": [ { "type": "point", "id": "A", "coords": [0, 0] } ],
  "constructibility": "direct | conclusion | impossible",
  "constructNote": "constructibility 为 conclusion 时的说明，其他情况为空字符串"
}

The "steps" array is the construction order analysis (same schema as above: order/object/type/dependencies/constraint, one row per stage).

Before planning, judge how the figure can be constructed, "constructibility":
- direct: the figure can be built directly from the problem conditions
- conclusion: direct construction is too difficult; some conclusion of the problem must be used as a given condition to position points
- impossible: cannot be drawn with the available step types
When constructibility is conclusion, constructNote MUST explain which conclusion was used as a condition.
${JXG_COMMON_RULES}`;

const SYSTEM_PROMPT_JXG_ONESHOT = `读取图片或文字中的几何题，输出一个 JSON 对象：
{"rawText":"识别出的题目原文","completedText":"补全点所属线段后的完整题目","constructibility":"direct | conclusion | impossible","constructNote":"constructibility 为 conclusion 时的说明，其他情况为空字符串","jxgSteps":[构造步骤数组]}。
只输出 JSON，不要输出其他内容。

只做作图，不要证明、验证或解答题目。

constructibility 判定（作图前必须先判断）：
- direct：可以直接按题意作图
- conclusion：直接作图困难，需要把题目结论（或部分结论）当作已知条件来定位点（必须在 constructNote 中说明把哪个结论当作了条件）
- impossible：无法用可用步骤类型作图

题目文字处理：completedText 中如果出现"如图""如图所示"等引用图片的字样，必须去掉。
${JXG_COMMON_RULES}`;

const SYSTEM_PROMPT_JXG_REFINE = `You are a geometry construction refiner. Given an original geometry problem, the current JSON construction steps of the diagram, and a user's adjustment instruction (Chinese), output the COMPLETE revised JSON construction steps array. NEVER prove, verify, or solve the problem.

Output format: {"jxgSteps": [ ...full revised steps array... ]}

Rules:
1. Output ONLY valid JSON. No markdown code fences. No explanations.
2. Return the FULL revised steps array (the board is rebuilt from it), not just the changes.
3. Apply the user's adjustment instruction precisely; keep the original construction intent otherwise.
4. If the user asks to move a point, update its coords (or its defining constraint).
5. If the user asks to add an element, append the necessary steps (and hide helpers with "visible": false).
6. Keep every referenced id defined by an earlier step; ids unique.
${JXG_COMMON_RULES}`;

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

function callKimi(apiKey, model, messages, userId, endpoint) {
  const ep = endpoint || {};
  const hostname = ep.hostname || 'api.moonshot.cn';
  const apiPath = ep.path || '/v1/chat/completions';
  const label = ep.label || 'Kimi';
  const state = getUserQueueState(userId);
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
      if (providerCallId && !err.providerCallId) err.providerCallId = providerCallId;
      reject(err);
    };

    state.currentRequest = https.request({
      hostname,
      port: 443,
      path: apiPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (response) => {
      providerCallId = response.headers['x-request-id'] || response.headers['x-msh-request-id'] || null;
      if (response.statusCode && response.statusCode >= 400) {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          let msg = body.slice(0, 300);
          try {
            const parsed = JSON.parse(body);
            if (parsed.error) msg = parsed.error.message || JSON.stringify(parsed.error);
          } catch { /* keep raw body */ }
          const e = new Error(`${label} HTTP ${response.statusCode}: ${msg}`);
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
            state.currentRequest = null;
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
        state.currentRequest = null;
        resolve({ content: contentParts.join(''), providerCallId, usage });
      });
    });

    state.currentRequest.on('error', (err) => {
      state.currentRequest = null;
      fail(err);
    });
    // 超时必须销毁连接，否则僵尸请求会一直占用组织唯一的并发槽位
    state.currentRequest.setTimeout(300000, () => {
      const req = state.currentRequest;
      if (req) req.destroy(new Error(`${label} request timed out`));
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

function buildCorrectionFeedback(invalid, isIncremental, kind) {
  const lines = invalid.map((v, i) => (i + 1) + '. ' + JSON.stringify(v.item) + '\n   Reason: ' + v.reason);
  const kindText = kind || (isIncremental ? 'operations array' : 'commands array');
  return 'Some entries in your previous ' + kindText + ' are invalid:\n' + lines.join('\n') +
    '\n\nOutput the complete corrected JSON again. Use ONLY commands from the verified reference. ' +
    'If an element cannot be expressed with the allowed commands, omit it.';
}

function callRefineFromText(text, currentCommands, history, options = {}) {
    const model = options.model || settings.resolveModelId('text');
  const userId = options.userId;
  const isJxg = options.format === 'jxg';
  const isIncremental = !isJxg && (options.mode === 'incremental' || (Array.isArray(options.currentObjects) && options.currentObjects.length > 0));
  const historyText = (history || []).map(h => {
    const role = h.role || (h.user ? 'user' : 'kimi');
    const textPart = h.text || h.user || (Array.isArray(h.response) ? h.response.join('\n') : h.response || '');
    return `${role === 'user' ? 'User' : 'Kimi'}: ${textPart}`;
  }).join('\n\n');

  let systemPrompt = isJxg ? SYSTEM_PROMPT_JXG_REFINE : SYSTEM_PROMPT_REFINE;
  let userContent = isJxg
    ? `Original problem:\n${text}\n\nCurrent JSON construction steps:\n${currentCommands}\n\n${historyText ? 'Adjustment history:\n' + historyText + '\n\n' : ''}New adjustment instruction:\n${options.instruction || ''}`
    : `Original problem:\n${text}\n\nCurrent GeoGebra commands:\n${currentCommands}\n\n${historyText ? 'Adjustment history:\n' + historyText + '\n\n' : ''}New adjustment instruction:\n${options.instruction || ''}`;

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
    let validation = isJxg
      ? jxg.validateSteps(parsed.jxgSteps)
      : isIncremental
      ? ggb.validateOperations(parsed.operations)
      : ggb.validateCommands(parsed.commands);

    // Plan 2: deterministic server-side check; feed concrete errors back for one retry.
    if (validation.invalid.length > 0) {
      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: buildCorrectionFeedback(validation.invalid, isIncremental, isJxg ? 'jxgSteps array' : null) });
      content = await chatCompletion(messages, { model, userId });
      parsed = parseJsonContent(content);
      validation = isJxg
        ? jxg.validateSteps(parsed.jxgSteps)
        : isIncremental
        ? ggb.validateOperations(parsed.operations)
        : ggb.validateCommands(parsed.commands);
    }

    const result = {
      text: text,
      geometry: {},
      commands: Array.isArray(parsed.commands) ? parsed.commands : [],
      assumptions: parsed.assumptions || []
    };
    if (isIncremental && !isJxg) {
      result.operations = validation.valid;
    } else if (isJxg) {
      result.jxgSteps = validation.valid;
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
  const hasImage = !!base64;
  const model = options.model || settings.resolveModelId(hasImage ? 'vision' : 'text');
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
  const hasImage = !!base64;
  const model = options.model || settings.resolveModelId(hasImage ? 'vision' : 'text');
  return enqueue(
    () => callAnalyzeImage(base64, { ...options, model }),
    options.userId,
    { type: hasImage ? '图片识别' : '文字识别', taskType: hasImage ? 'vision' : 'text', model }
  );
}

function callAnalyzeOnce(base64, options = {}) {
  const hasImage = !!base64;
  const model = options.model || settings.resolveModelId(hasImage ? 'vision' : 'text');
  const userId = options.userId;
  const isJxg = options.format === 'jxg';

  const content = [];
  if (base64) {
    content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } });
    content.push({ type: 'text', text: isJxg ? '识别这道题并生成作图步骤。' : '识别这道题并生成作图指令。' });
  } else {
    content.push({ type: 'text', text: (isJxg ? '识别并处理下面的几何题，生成作图步骤：\n' : '识别并处理下面的几何题，生成作图指令：\n') + (options.text || '') });
  }
  const messages = [
    { role: 'system', content: isJxg ? SYSTEM_PROMPT_JXG_ONESHOT : SYSTEM_PROMPT_ONESHOT },
    { role: 'user', content },
  ];

  return (async () => {
    const taskType = hasImage ? 'vision' : 'text';
    let contentText = await chatCompletion(messages, { model, userId, taskType });
    let parsed = parseJsonContent(contentText);
    let validation = isJxg
      ? jxg.validateSteps(parsed.jxgSteps)
      : ggb.validateCommands(parsed.commands);

    if (validation.invalid.length > 0) {
      messages.push({ role: 'assistant', content: contentText });
      messages.push({ role: 'user', content: buildCorrectionFeedback(validation.invalid, false, isJxg ? 'jxgSteps array' : null) });
      contentText = await chatCompletion(messages, { model, userId, taskType });
      parsed = parseJsonContent(contentText);
      validation = isJxg
        ? jxg.validateSteps(parsed.jxgSteps)
        : ggb.validateCommands(parsed.commands);
    }

    const result = {
      rawText: parsed.rawText || '',
      completedText: parsed.completedText || parsed.rawText || '',
      constructibility: parsed.constructibility || '',
      constructNote: parsed.constructNote || '',
    };
    if (isJxg) {
      result.jxgSteps = validation.valid;
    } else {
      result.commands = Array.isArray(parsed.commands) ? parsed.commands : [];
    }
    if (validation.invalid.length > 0) {
      result.warnings = validation.invalid.map((x) => `${x.item}: ${x.reason}`);
    }
    return result;
  })();
}

function analyzeOnce(base64, options = {}) {
  const hasImage = !!base64;
  const model = options.model || settings.resolveModelId(hasImage ? 'vision' : 'text');
  return enqueue(
    () => callAnalyzeOnce(base64, { ...options, model }),
    options.userId,
    { type: hasImage ? '识别并生成' : '文字生成', taskType: hasImage ? 'vision' : 'text', model }
  );
}

function callAnalyzeConstruction(text, options = {}) {
  const model = options.model || settings.resolveModelId('text');
  const userId = options.userId;
  const isJxg = options.format === 'jxg';

  const messages = isJxg ? [
    { role: 'system', content: SYSTEM_PROMPT_JXG_CONSTRUCTION },
    { role: 'user', content: `Analyze the construction of this geometry problem and produce the construction plan and JSON construction steps:\n\n${text}` }
  ] : [
    { role: 'system', content: SYSTEM_PROMPT_CONSTRUCTION },
    { role: 'user', content: `Analyze the construction of this geometry problem and produce the construction plan and GeoGebra commands:\n\n${text}` }
  ];

  return (async () => {
    let content = await chatCompletion(messages, { model, userId });
    let parsed = parseJsonContent(content);
    let validation = isJxg
      ? jxg.validateSteps(parsed.jxgSteps)
      : ggb.validateCommands(parsed.commands);

    if (validation.invalid.length > 0) {
      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: buildCorrectionFeedback(validation.invalid, false, isJxg ? 'jxgSteps array' : null) });
      content = await chatCompletion(messages, { model, userId });
      parsed = parseJsonContent(content);
      validation = isJxg
        ? jxg.validateSteps(parsed.jxgSteps)
        : ggb.validateCommands(parsed.commands);
    }

    const steps = Array.isArray(parsed.steps) ? parsed.steps.map((s, i) => ({
      order: s.order != null ? s.order : i + 1,
      object: s.object || '',
      type: s.type || '',
      dependencies: s.dependencies || '无',
      constraint: s.constraint || ''
    })) : [];

    const result = {
      steps,
      constructibility: parsed.constructibility || '',
      constructNote: parsed.constructNote || '',
    };
    if (isJxg) {
      result.jxgSteps = validation.valid;
    } else {
      result.commands = validation.valid;
    }
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
  analyzeOnce,
  analyzeConstruction,
  chatCompletion,
  chatCompletionDetailed,
  SYSTEM_PROMPT_IMAGE_ANALYZE,
  SYSTEM_PROMPT_CONSTRUCTION,
  SYSTEM_PROMPT_JXG_CONSTRUCTION,
  SYSTEM_PROMPT_JXG_ONESHOT,
  SYSTEM_PROMPT_JXG_REFINE,
  getTaskEvents,
  runTask: enqueue,
  cancelCurrentRequest
};
