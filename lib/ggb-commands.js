// GeoGebra Geometry command reference, verified against the official GeoGebra
// source repository (github.com/geogebra/geogebra, main branch):
//   - source/shared/common/src/main/java/org/geogebra/common/kernel/commands/Commands.java
//   - source/shared/common-jre/src/main/resources/org/geogebra/common/jre/properties/command.properties
// The Geometry app uses CommandFilterFactory.createNoCasCommandFilter(); every
// command listed below is a non-CAS command, so all of them are available in
// the Geometry app. Syntax strings are the official English 2D syntax.
//
// Removed after verification (do NOT use):
//   Circumcircle  -> no such command in current GeoGebra; use Circle(A, B, C)
//   Orthocenter   -> no such command in current GeoGebra
//   ParallelLine  -> no such command; use Line(P, existingLine)
//   CircleArc     -> wrong name; official English name is CircularArc

const COMMANDS = {
  Point: {
    syntax: ['Point( <Object> )', 'Point( <Object>, <Parameter> )', 'Point( <Point>, <Vector> )', 'Point( <List> )'],
    argsMin: 1, argsMax: 2,
  },
  Midpoint: {
    syntax: ['Midpoint( <Segment> )', 'Midpoint( <Conic> )', 'Midpoint( <Point>, <Point> )'],
    argsMin: 1, argsMax: 2,
  },
  Segment: {
    syntax: ['Segment( <Point>, <Point> )', 'Segment( <Point>, <Length> )'],
    argsMin: 2, argsMax: 2,
  },
  Line: {
    syntax: ['Line( <Point>, <Point> )', 'Line( <Point>, <Parallel Line> )', 'Line( <Point>, <Direction Vector> )'],
    argsMin: 2, argsMax: 2,
  },
  Ray: {
    syntax: ['Ray( <Start Point>, <Point> )', 'Ray( <Start Point>, <Direction Vector> )'],
    argsMin: 2, argsMax: 2,
  },
  Vector: {
    syntax: ['Vector( <Point> )', 'Vector( <Start Point>, <End Point> )'],
    argsMin: 1, argsMax: 2,
  },
  Polygon: {
    syntax: ['Polygon( <List of Points> )', 'Polygon( <Point>, ..., <Point> )', 'Polygon( <Point>, <Point>, <Number of Vertices> )'],
    argsMin: 1, argsMax: 8,
  },
  Polyline: {
    syntax: ['Polyline( <List of Points> )', 'Polyline( <Point>, ..., <Point> )'],
    argsMin: 1, argsMax: 30,
  },
  Circle: {
    syntax: ['Circle( <Point>, <Radius Number> )', 'Circle( <Point>, <Segment> )', 'Circle( <Point>, <Point> )', 'Circle( <Point>, <Point>, <Point> )'],
    argsMin: 2, argsMax: 3,
  },
  CircularArc: {
    syntax: ['CircularArc( <Midpoint>, <Point>, <Point> )'],
    argsMin: 3, argsMax: 3,
  },
  CircumcircularArc: {
    syntax: ['CircumcircularArc( <Point>, <Point>, <Point> )'],
    argsMin: 3, argsMax: 3,
  },
  CircumcircularSector: {
    syntax: ['CircumcircularSector( <Point>, <Point>, <Point> )'],
    argsMin: 3, argsMax: 3,
  },
  Semicircle: {
    syntax: ['Semicircle( <Point>, <Point> )'],
    argsMin: 2, argsMax: 2,
  },
  Arc: {
    syntax: ['Arc( <Circle>, <Point>, <Point> )', 'Arc( <Ellipse>, <Point>, <Point> )', 'Arc( <Circle>, <Parameter Value>, <Parameter Value> )', 'Arc( <Ellipse>, <Parameter Value>, <Parameter Value> )'],
    argsMin: 3, argsMax: 3,
  },
  Sector: {
    syntax: ['Sector( <Conic>, <Point>, <Point> )', 'Sector( <Conic>, <Parameter Value>, <Parameter Value> )'],
    argsMin: 3, argsMax: 3,
  },
  Angle: {
    syntax: ['Angle( <Object> )', 'Angle( <Vector>, <Vector> )', 'Angle( <Line>, <Line> )', 'Angle( <Point>, <Apex>, <Point> )', 'Angle( <Point>, <Apex>, <Angle> )'],
    argsMin: 1, argsMax: 3,
  },
  Distance: {
    syntax: ['Distance( <Point>, <Object> )', 'Distance( <Line>, <Line> )'],
    argsMin: 2, argsMax: 2,
  },
  Length: {
    syntax: ['Length( <Object> )', 'Length( <Function>, <Start x-Value>, <End x-Value> )', 'Length( <Function>, <Start Point>, <End Point> )', 'Length( <Curve>, <Start t-Value>, <End t-Value> )', 'Length( <Curve>, <Start Point>, <End Point> )'],
    argsMin: 1, argsMax: 3,
  },
  Slope: {
    syntax: ['Slope( <Line> )'],
    argsMin: 1, argsMax: 1,
  },
  PerpendicularBisector: {
    syntax: ['PerpendicularBisector( <Segment> )', 'PerpendicularBisector( <Point>, <Point> )'],
    argsMin: 1, argsMax: 2,
  },
  PerpendicularLine: {
    syntax: ['PerpendicularLine( <Point>, <Line> )', 'PerpendicularLine( <Point>, <Segment> )', 'PerpendicularLine( <Point>, <Vector> )'],
    argsMin: 2, argsMax: 2,
  },
  Tangent: {
    syntax: ['Tangent( <Point>, <Conic> )', 'Tangent( <Point>, <Function> )', 'Tangent( <Point on Curve>, <Curve> )', 'Tangent( <x-Value>, <Function> )', 'Tangent( <Line>, <Conic> )', 'Tangent( <Conic>, <Conic> )'],
    argsMin: 2, argsMax: 2,
  },
  Intersect: {
    syntax: ['Intersect( <Object>, <Object> )', 'Intersect( <Object>, <Object>, <Index of Intersection Point> )', 'Intersect( <Object>, <Object>, <Initial Point> )', 'Intersect( <Function>, <Function>, <Start x-Value>, <End x-Value> )'],
    argsMin: 2, argsMax: 4,
  },
  Reflect: {
    syntax: ['Reflect( <Object>, <Point> )', 'Reflect( <Object>, <Line> )', 'Reflect( <Object>, <Circle> )'],
    argsMin: 2, argsMax: 2,
  },
  Rotate: {
    syntax: ['Rotate( <Object>, <Angle> )', 'Rotate( <Object>, <Angle>, <Point> )'],
    argsMin: 2, argsMax: 3,
  },
  Translate: {
    syntax: ['Translate( <Object>, <Vector> )', 'Translate( <Vector>, <Start Point> )'],
    argsMin: 2, argsMax: 2,
  },
  Dilate: {
    syntax: ['Dilate( <Object>, <Dilation Factor> )', 'Dilate( <Object>, <Dilation Factor>, <Dilation Center Point> )'],
    argsMin: 2, argsMax: 3,
  },
  Parabola: {
    syntax: ['Parabola( <Point>, <Line> )'],
    argsMin: 2, argsMax: 2,
  },
  Ellipse: {
    syntax: ['Ellipse( <Focus>, <Focus>, <Semimajor Axis Length> )', 'Ellipse( <Focus>, <Focus>, <Segment> )', 'Ellipse( <Focus>, <Focus>, <Point> )'],
    argsMin: 3, argsMax: 3,
  },
  Hyperbola: {
    syntax: ['Hyperbola( <Focus>, <Focus>, <Semimajor Axis Length> )', 'Hyperbola( <Focus>, <Focus>, <Segment> )', 'Hyperbola( <Focus>, <Focus>, <Point> )'],
    argsMin: 3, argsMax: 3,
  },
  Slider: {
    syntax: ['Slider( <Min>, <Max>, <Increment>, <Speed>, <Width>, <Is Angle>, <Horizontal>, <Animating>, <Random> )'],
    argsMin: 2, argsMax: 9,
  },
  AngleBisector: {
    syntax: ['AngleBisector( <Line>, <Line> )', 'AngleBisector( <Point>, <Point>, <Point> )'],
    argsMin: 2, argsMax: 3,
  },
  Incircle: {
    syntax: ['Incircle( <Point>, <Point>, <Point> )'],
    argsMin: 3, argsMax: 3,
  },
  Centroid: {
    syntax: ['Centroid( <Polygon> )'],
    argsMin: 1, argsMax: 1,
  },
  Locus: {
    syntax: ['Locus( <Point Creating Locus Line>, <Point> )', 'Locus( <Point Creating Locus Line>, <Slider> )'],
    argsMin: 2, argsMax: 2,
  },
  SetVisibleInView: {
    syntax: ['SetVisibleInView( <Object>, <View Number 1|2>, <Boolean> )'],
    argsMin: 3, argsMax: 3,
  },
};

// Official replacements for names that models often invent.
const REPLACEMENT_NOTES = [
  'Circumcircle(A,B,C) does NOT exist: use Circle( <Point>, <Point>, <Point> ) for a circumcircle.',
  'Orthocenter does NOT exist as a command.',
  'ParallelLine does NOT exist: use Line( <Point>, <Line> ) for a parallel line.',
  'CircleArc does NOT exist: the official name is CircularArc( <Midpoint>, <Point>, <Point> ).',
  'PerpendicularBisector and PerpendicularLine are the official English names (not LineBisector / OrthogonalLine).',
  'Polyline is the official English name (not PolyLine).',
];

// A bare coordinate assignment such as "A = (0, 0)" or "P_1 = (3, 4)".
const ASSIGNMENT_RE = /^[A-Za-z][A-Za-z0-9_]*\s*=\s*\([\s\S]*\)\s*$/;

function splitArgs(inner) {
  const args = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

// A named command assignment such as "segAB = Segment(A, B)" or "D = Intersect(c1, sAB)".
const NAMED_CMD_RE = /^[A-Za-z][A-Za-z0-9_]*\s*=\s*([A-Za-z][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*$/;

function checkCommandCall(name, argsInner) {
  const def = COMMANDS[name];
  if (!def) {
    return { ok: false, reason: `unknown command "${name}"` };
  }
  const argc = splitArgs(argsInner).length;
  if (argc < def.argsMin || argc > def.argsMax) {
    const expected = def.syntax.join(' | ');
    return { ok: false, reason: `"${name}" takes ${def.argsMin}-${def.argsMax} argument(s), got ${argc}. Use: ${expected}` };
  }
  return { ok: true };
}

// Returns { ok: true } or { ok: false, reason: string }.
function validateCommandLine(line) {
  const s = (line || '').trim();
  if (!s) return { ok: false, reason: 'empty command' };
  if (s.startsWith('//')) return { ok: true };
  if (ASSIGNMENT_RE.test(s)) return { ok: true };

  const bare = s.match(/^([A-Za-z][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*$/);
  if (bare) return checkCommandCall(bare[1], bare[2]);

  const named = s.match(NAMED_CMD_RE);
  if (named) return checkCommandCall(named[1], named[2]);

  // Arithmetic/value assignment such as "alpha = (180° - aB) / 2" or "r = 2x + 1":
  // RHS contains only identifiers, numbers, operators, parens and the degree sign.
  const arith = s.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/);
  const rhs = arith && arith[2].trim();
  const hasCall = rhs && /[A-Za-z][A-Za-z0-9_]*\s*\(/.test(rhs);
  if (rhs && !hasCall && /^[A-Za-z0-9_°\s+\-*/^().]+$/.test(rhs) && !/[A-Za-z0-9_]\s+[A-Za-z(]/.test(rhs)) {
    return { ok: true };
  }

  // Mixed expression such as "s = Distance(A, B) + 1": every "Name(" on the RHS
  // must be a whitelisted command, and the rest must be pure arithmetic.
  if (rhs && hasCall) {
    const withoutCalls = rhs.replace(/[A-Za-z][A-Za-z0-9_]*\s*\([^()]*\)/g, '0');
    if (
      /^[A-Za-z0-9_°\s+\-*/^().]+$/.test(withoutCalls) &&
      ![...rhs.matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*\(/g)].some((mm) => !COMMANDS[mm[1]])
    ) {
      return { ok: true };
    }
  }

  return { ok: false, reason: `not a command call or assignment: "${s}"` };
}

// Validate a refine result. Returns { valid: [...], invalid: [{item, reason}] }.
function validateEntry(item, getCmd) {
  const cmd = getCmd(item);
  const r = validateCommandLine(cmd);
  return r.ok ? { ok: true } : { ok: false, reason: r.reason, item };
}

function validateCommands(commands) {
  const valid = [];
  const invalid = [];
  for (const c of commands || []) {
    const r = validateEntry(c, (x) => x);
    if (r.ok) valid.push(c);
    else invalid.push({ item: c, reason: r.reason });
  }
  return { valid, invalid };
}

function validateOperations(operations) {
  const valid = [];
  const invalid = [];
  for (const op of operations || []) {
    if (!op || typeof op !== 'object') {
      invalid.push({ item: op, reason: 'operation is not an object' });
      continue;
    }
    if (op.op === 'evalCommand') {
      const r = validateCommandLine(op.cmd);
      if (r.ok) valid.push(op);
      else invalid.push({ item: op, reason: r.reason });
    } else if (op.op === 'setCoords') {
      if (op.name == null || op.x == null || op.y == null) {
        invalid.push({ item: op, reason: 'setCoords requires name, x, y' });
      } else {
        valid.push(op);
      }
    } else if (op.op === 'deleteObject' || op.op === 'setVisible') {
      if (!op.name) invalid.push({ item: op, reason: `${op.op} requires name` });
      else valid.push(op);
    } else {
      invalid.push({ item: op, reason: `unknown op "${op.op}"` });
    }
  }
  return { valid, invalid };
}

// Compact reference text injected into the LLM prompts.
function referenceText() {
  const lines = Object.entries(COMMANDS).map(([name, def]) => {
    return '- ' + def.syntax.join(' | ');
  });
  const notes = REPLACEMENT_NOTES.map((n) => '- ' + n);
  return [
    'Verified GeoGebra Geometry commands (official syntax):',
    ...lines,
    '',
    'Important:',
    ...notes,
  ].join('\n');
}

module.exports = { COMMANDS, validateCommandLine, validateCommands, validateOperations, referenceText };
