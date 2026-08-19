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
      {"name": "alpha", "vertex": "A", "sides": ["AB", "AC"], "value": 60, "label": "60°"}
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
7. "AB=5cm" means length 5. "∠A=60°" means angle at A equals 60. "垂直" = perpendicular. "平行" = parallel. "⊙O" = circle centered at O.
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
1. Fix obvious OCR errors first (e.g. '0' between segments usually means parallel '//' or '∥'; 'AI' should often be 'A'; 'P.2' should be 'P、Q').
2. Ignore proof/conclusion statements; only construct the geometric figure.
3. Output only: {"commands": ["A = (0, 0)", "B = (5, 0)", ...]}
4. First create all points with numeric coordinates.
5. Then create segments, lines, circles, polygons, angles.
6. Use simple coordinates. Do not try to satisfy every constraint exactly; aim for a clear, approximate diagram.
7. If the problem is complex, include only the main points and connections, and add a comment line starting with // for anything omitted.`;

let pendingPromise = null;
let currentRequest = null;

function callKimi(apiKey, model, messages) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      messages
    });

    currentRequest = https.request({
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
        currentRequest = null;
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

    currentRequest.on('error', (err) => {
      currentRequest = null;
      if (err.code === 'ECONNRESET') {
        reject(new Error('Kimi request was cancelled.'));
      } else {
        reject(err);
      }
    });
    currentRequest.setTimeout(300000, () => reject(new Error('Kimi request timed out')));
    currentRequest.write(payload);
    currentRequest.end();
  });
}

function cancelCurrentRequest() {
  if (currentRequest) {
    currentRequest.destroy();
    currentRequest = null;
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

const SYSTEM_PROMPT_REFINE = `You are a GeoGebra Geometry command refiner. Given an original geometry problem, current GeoGebra commands, and a user's adjustment instruction, output a complete revised list of GeoGebra commands as JSON.

Output format: {"commands": ["A = (0,0)", "Segment(A,B)", ...]}

Rules:
1. Output ONLY valid JSON. No markdown fences. No explanations.
2. Keep the original construction intent unless the user explicitly asks to change it.
3. Apply the user's adjustment instruction precisely.
4. If the user asks to move a point, update its coordinates.
5. If the user asks to add an element, append the necessary commands.
6. Return the FULL revised command list, not just changes.
7. Use simple numeric coordinates.
8. Fix any obvious errors in the current commands if they would prevent rendering.`;

function callExtractFromText(text, options = {}) {
  const apiKey = options.apiKey || config.llm.kimi.apiKey;
  if (!apiKey) {
    return Promise.reject(new Error('KIMI_API_KEY environment variable is not set.'));
  }

  const model = options.model || config.llm.kimi.model || DEFAULT_MODEL;
  const mode = options.mode || 'json';

  if (mode === 'direct') {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT_DIRECT },
      { role: 'user', content: `Generate GeoGebra Geometry commands for this problem:\n\n${text}` }
    ];
    return callKimi(apiKey, model, messages).then(content => {
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

  return callKimi(apiKey, model, messages).then(content => {
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
  if (pendingPromise) {
    return Promise.reject(new Error('Another Kimi request is still in progress. Please wait and try again.'));
  }
  pendingPromise = callExtractFromText(text, options).finally(() => {
    pendingPromise = null;
  });
  return pendingPromise;
}


function callRefineFromText(text, currentCommands, history, options = {}) {
  const apiKey = options.apiKey || config.llm.kimi.apiKey;
  if (!apiKey) {
    return Promise.reject(new Error('KIMI_API_KEY environment variable is not set.'));
  }
  const model = options.model || config.llm.kimi.model || DEFAULT_MODEL;
  const historyText = (history || []).map(h => `User: ${h.user}\nKimi:\n${(h.response || []).join('\n')}`).join('\n\n');
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT_REFINE },
    { role: 'user', content: `Original problem:\n${text}\n\nCurrent GeoGebra commands:\n${currentCommands}\n\n${historyText ? 'Adjustment history:\n' + historyText + '\n\n' : ''}New adjustment instruction:\n${options.instruction || ''}` }
  ];
  return callKimi(apiKey, model, messages).then(content => {
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

function refineFromText(text, currentCommands, history, options = {}) {
  if (pendingPromise) {
    return Promise.reject(new Error('Another Kimi request is still in progress. Please wait and try again.'));
  }
  pendingPromise = callRefineFromText(text, currentCommands, history, options).finally(() => {
    pendingPromise = null;
  });
  return pendingPromise;
}

module.exports = { extractFromText, refineFromText, cancelCurrentRequest };
