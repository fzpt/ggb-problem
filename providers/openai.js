const https = require('node:https');
const config = require('../config');

const DEFAULT_MODEL = 'gpt-4o';

const SYSTEM_PROMPT = `You are a geometry problem parser. Given a screenshot of a geometry problem, do two things:

1. Write a clean Chinese text version of the problem.
2. Extract a structured geometric representation as JSON with this schema:

{
  "text": "题目文字",
  "geometry": {
    "points": [{"name": "A", "x": number | null, "y": number | null, "label": "A", "construction": optional string}],
    "segments": [{"name": "c", "from": "A", "to": "B", "label": "c"}],
    "lines": [{"name": "l", "points": ["A", "B"], "label": "l"}],
    "circles": [{"name": "c1", "center": "O", "radius": number | null, "radiusPoint": "A", "label": "c1"}],
    "angles": [{"name": "alpha", "vertex": "A", "sides": ["AB", "AC"], "value": 60, "label": "60°"}],
    "polygons": [{"name": "tri1", "vertices": ["A", "B", "C"], "label": "ABC"}],
    "constraints": [{"type": "equalLength", "objects": ["AB", "AC"]}, {"type": "perpendicular", "line1": "AB", "line2": "CD"}]
  },
  "assumptions": ["若题目未给出坐标，我假设..."]
}

Rules:
- If coordinates are not given in the problem, choose reasonable canonical coordinates. Place the first point at the origin and the base on the positive x-axis when possible.
- Use GeoGebra-compatible object names: letters for points, short names for lines/circles.
- Only include the JSON, no extra prose outside it. Ensure the JSON is valid.
- The response must be valid JSON and parseable. Do not include markdown code fences around the JSON.`;

function callOpenAI(apiKey, model, messages) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      messages,
      max_tokens: 2048,
      temperature: 0.2
    });

    const request = https.request({
      hostname: 'api.openai.com',
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
        const body = Buffer.concat(chunks).toString('utf-8');
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) {
            reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          } else if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
            resolve(parsed.choices[0].message.content);
          } else {
            reject(new Error('Unexpected OpenAI response: ' + body.slice(0, 200)));
          }
        } catch (error) {
          reject(new Error('Failed to parse OpenAI response: ' + error.message));
        }
      });
    });

    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

function extract(base64, options = {}) {
  const apiKey = options.apiKey || config.llm.openai.apiKey;
  if (!apiKey) {
    return Promise.reject(new Error('OPENAI_API_KEY environment variable is not set.'));
  }

  const model = options.model || config.llm.openai.model || DEFAULT_MODEL;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Extract the geometry problem from this image.' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}`, detail: 'high' } }
      ]
    }
  ];

  return callOpenAI(apiKey, model, messages).then(content => {
    let parsed;
    try {
      const cleaned = content.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (error) {
      throw new Error('OpenAI response was not valid JSON: ' + error.message + '\nRaw: ' + content.slice(0, 500));
    }

    return {
      text: parsed.text || '',
      geometry: parsed.geometry || {},
      assumptions: parsed.assumptions || []
    };
  });
}

module.exports = { extract };