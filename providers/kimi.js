const https = require('node:https');
const config = require('../config');

const DEFAULT_MODEL = 'kimi-k2.7-code';

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
8. ONLY use GeoGebra Geometry commands that exist in this list: Point, Midpoint, Segment, Line, Ray, Vector, Polygon, Polyline, Circle, CircleArc, Semicircle, Arc, Sector, Angle, Distance, Length, Slope, PerpendicularBisector, PerpendicularLine, ParallelLine, Tangent, Intersect, Reflect, Rotate, Translate, Dilate, Parabola, Ellipse, Hyperbola, Slider, AngleBisector, Circumcircle, Incircle, Centroid, Orthocenter, Locus.
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

Allowed GeoGebra Geometry commands inside evalCommand: Point, Midpoint, Segment, Line, Ray, Vector, Polygon, Polyline, Circle, CircleArc, Semicircle, Arc, Sector, Angle, Distance, Length, Slope, PerpendicularBisector, PerpendicularLine, ParallelLine, Tangent, Intersect, Reflect, Rotate, Translate, Dilate, Parabola, Ellipse, Hyperbola, Slider, AngleBisector, Circumcircle, Incircle, Centroid, Orthocenter, Locus.

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
9. ONLY use GeoGebra Geometry commands from this allowed list: Point, Midpoint, Segment, Line, Ray, Vector, Polygon, Polyline, Circle, CircleArc, Semicircle, Arc, Sector, Angle, Distance, Length, Slope, PerpendicularBisector, PerpendicularLine, ParallelLine, Tangent, Intersect, Reflect, Rotate, Translate, Dilate, Parabola, Ellipse, Hyperbola, Slider, AngleBisector, Circumcircle, Incircle, Centroid, Orthocenter, Locus.
10. Before outputting, verify every command starts with one of the allowed names or is a coordinate assignment like "A = (0, 0)". Do not invent command names. If a command is not in the list, replace it with an equivalent allowed command or omit it and add a comment starting with //.
11. Final verification: double-check every command against the allowed GeoGebra Geometry API list above. Any command not in the list must be replaced with an equivalent allowed command or omitted with a // comment.
`;

// Per-user queue and current request tracking.
const userQueues = new Map();

function getUserQueueState(userId) {
  const key = userId || 'anonymous';
  if (!userQueues.has(key)) {
    userQueues.set(key, { queue: [], processingQueue: false, currentRequest: null });
  }
  return userQueues.get(key);
}

function enqueue(fn, userId) {
  const state = getUserQueueState(userId);
  return new Promise((resolve, reject) => {
    state.queue.push({ fn, resolve, reject });
    processQueue(userId);
  });
}

async function processQueue(userId) {
  const state = getUserQueueState(userId);
  if (state.processingQueue) return;
  state.processingQueue = true;
  while (state.queue.length) {
    const job = state.queue.shift();
    try {
      const result = await runWithRetry(job.fn);
      job.resolve(result);
    } catch (e) {
      job.reject(e);
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
      if (err.code === 'ECONNRESET') {
        reject(new Error('Kimi request was cancelled.'));
      } else {
        reject(err);
      }
    });
    state.currentRequest.setTimeout(120000, () => reject(new Error('Kimi request timed out')));
    state.currentRequest.write(payload);
    state.currentRequest.end();
  });
}

function cancelCurrentRequest(userId) {
  const state = getUserQueueState(userId);
  if (state.currentRequest) {
    state.currentRequest.destroy();
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
  const apiKey = options.apiKey || config.llm.kimi.apiKey;
  if (!apiKey) {
    return Promise.reject(new Error('KIMI_API_KEY environment variable is not set.'));
  }

  const model = options.model || config.llm.kimi.model || DEFAULT_MODEL;
  const mode = options.mode || 'json';
  const userId = options.userId;

  if (mode === 'direct') {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT_DIRECT },
      { role: 'user', content: `Generate GeoGebra Geometry commands for this problem:\n\n${text}` }
    ];
    return callKimi(apiKey, model, messages, userId).then(content => {
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

  return callKimi(apiKey, model, messages, userId).then(content => {
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
  return enqueue(() => callExtractFromText(text, options), options.userId);
}

function callRefineFromText(text, currentCommands, history, options = {}) {
  const apiKey = options.apiKey || config.llm.kimi.apiKey;
  if (!apiKey) {
    return Promise.reject(new Error('KIMI_API_KEY environment variable is not set.'));
  }
  const model = options.model || config.llm.kimi.model || DEFAULT_MODEL;
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
  return callKimi(apiKey, model, messages, userId).then(content => {
    let parsed;
    try {
      parsed = JSON.parse(cleanJsonResponse(content));
    } catch (error) {
      throw new Error('Kimi response was not valid JSON: ' + error.message + '\nRaw: ' + content.slice(0, 500));
    }
    const result = {
      text: text,
      geometry: {},
      commands: Array.isArray(parsed.commands) ? parsed.commands : [],
      assumptions: parsed.assumptions || []
    };
    if (isIncremental) {
      result.operations = Array.isArray(parsed.operations) ? parsed.operations : [];
    }
    return result;
  });
}

function refineFromText(text, currentCommands, history, options = {}) {
  return enqueue(() => callRefineFromText(text, currentCommands, history, options), options.userId);
}

module.exports = { extractFromText, refineFromText, cancelCurrentRequest };
