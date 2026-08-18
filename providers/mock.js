// Demo provider: returns example data so the two-step flow can be tested
// without any API key or network call.

function extractText(base64, options = {}) {
  return Promise.resolve({
    text: 'In triangle ABC, AB = 5, AC = 4, angle A = 60 degrees. Draw the triangle and label sides and angles.',
    raw: { source: 'mock' }
  });
}

function triangleExample(text) {
  return {
    text: text || 'In triangle ABC, AB = 5, AC = 4, angle A = 60 degrees. Draw the triangle and label sides and angles.',
    geometry: {
      points: [
        { name: 'A', x: 0, y: 0, label: 'A' },
        { name: 'B', x: 5, y: 0, label: 'B' },
        { name: 'C', x: 2, y: 3.464, label: 'C' }
      ],
      segments: [
        { name: 'a', from: 'B', to: 'C', label: 'a' },
        { name: 'b', from: 'A', to: 'C', label: 'b' },
        { name: 'c', from: 'A', to: 'B', label: 'c' }
      ],
      angles: [
        { name: 'alpha', vertex: 'A', sides: ['AB', 'AC'], value: 60, label: '60°' }
      ],
      polygons: [
        { name: 'tri1', vertices: ['A', 'B', 'C'], label: 'ABC' }
      ]
    },
    assumptions: [
      'Mock mode: returning a sample triangle based on keywords.',
      'Point C is calculated from AB=5, AC=4, angle A=60 degrees.'
    ]
  };
}

function circleExample(text) {
  return {
    text: text || 'Circle O has radius 3. Point P is outside the circle. Draw a tangent from P to circle O.',
    geometry: {
      points: [
        { name: 'O', x: 0, y: 0, label: 'O' },
        { name: 'A', x: 3, y: 0, label: 'A' },
        { name: 'P', x: 6, y: 4, label: 'P' }
      ],
      circles: [
        { name: 'c1', center: 'O', radiusPoint: 'A', label: 'circle O' }
      ],
      segments: [
        { from: 'O', to: 'A' },
        { from: 'O', to: 'P' }
      ],
      constraints: [
        { type: 'tangent', line: 'PT', circle: 'c1' }
      ]
    },
    assumptions: [
      'Mock mode: returning a sample circle based on keywords.',
      'Point P is placed outside the circle for tangent construction.'
    ]
  };
}

function extractFromText(text, options = {}) {
  const t = (text || '').toLowerCase();
  let result;
  if (t.includes('circle') || t.includes('tangent') || t.includes('radius') || t.includes('圆')) {
    result = circleExample(text);
  } else {
    result = triangleExample(text);
  }
  return Promise.resolve(result);
}

module.exports = { extractText, extractFromText };