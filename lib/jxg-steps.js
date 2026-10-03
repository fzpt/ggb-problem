// JSXGraph 版 JSON 构造步骤的校验器（白名单模式，接口对齐 lib/ggb-commands.js）。
// 步骤 schema 与 geometry-prototype 的 renderSteps 一致，并扩展三种类型：
//   rotate    绕点旋转（角度为数值，度）
//   dilate    位似（比例数值）：center + ratio*(of-center)，覆盖 A+d*(B-A) 类定位
//   exprpoint 表达式点（x/y 为受限表达式，支持 x(A) y(A) Distance(A,B) 与 + - * / 括号）
//
// validateSteps(steps) -> { valid: [...], invalid: [{item, reason}] }
//   item 是原始步骤对象（JSON.stringify 后入日志），reason 为中文错误说明。

const STEP_TYPES = {
  point: { coords: 'coords' },
  segment: { p1: 'pointref', p2: 'pointref' },
  line: { p1: 'pointref', p2: 'pointref' },
  ray: { p1: 'pointref', p2: 'pointref' },
  circle: {}, // center+radius | center+through | through3，组合校验
  arc: { center: 'pointref', p1: 'pointref', p2: 'pointref' },
  arc3: { through3: 'points3' },
  ellipse: { f1: 'pointref', f2: 'pointref', p: 'pointref' },
  hyperbola: { f1: 'pointref', f2: 'pointref', p: 'pointref' },
  polygon: { points: 'pointsN' },
  regularpolygon: {}, // n + (center+vertex) | n + (p1+p2 相邻顶点、逆时针)，组合校验
  midpoint: { p1: 'pointref', p2: 'pointref' },
  tricenter: { kind: 'tricenterKind', points: 'points3' },
  perpendicular: { line: 'ref', point: 'pointref' },
  intersection: {}, // (e1,e2[,index]) 或 (e1,polygon,edge[,index])，组合校验
  pline: { point: 'pointref', ref: 'ref' },
  pray: { point: 'pointref', ref: 'ref' },
  pseg: { point: 'pointref', ref: 'ref' },
  psegfree: { point: 'pointref', ref: 'ref', len: 'number' },
  mirrorpt: { of: 'pointref', axis: 'ref', t: 'mirrorType' },
  bisector: { vertex: 'pointref', p1: 'pointref', p2: 'pointref' },
  perpseg: { point: 'pointref', p1: 'pointref', p2: 'pointref' },
  rotate: { of: 'pointref', center: 'pointref', angle: 'number' },
  dilate: { of: 'pointref', center: 'pointref', ratio: 'number' },
  exprpoint: { x: 'expr', y: 'expr' },
};

// ---------- 受限表达式解析（x(A) / y(A) / Distance(A,B) + - * / 括号） ----------

function tokenizeExpr(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = src.slice(i).match(/^\d*\.?\d+(?:[eE][+-]?\d+)?/);
      if (!m) throw new Error(`无法解析的数字（位置 ${i}）`);
      tokens.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      tokens.push({ t: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    if ('+-*/(),'.includes(c)) { tokens.push({ t: c }); i++; continue; }
    throw new Error(`不支持的字符 "${c}"（位置 ${i}）`);
  }
  return tokens;
}

// 递归下降：expr := term (('+'|'-') term)*；term := factor (('*'|'/') factor)*
function parseExpr(src) {
  if (typeof src !== 'string' || !src.trim()) throw new Error('表达式为空');
  const tokens = tokenizeExpr(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  function parseFactor() {
    const tk = next();
    if (!tk) throw new Error('表达式意外结束');
    if (tk.t === 'num') return { k: 'num', v: tk.v };
    if (tk.t === '-') return { k: 'neg', a: parseFactor() };
    if (tk.t === '(') {
      const e = parseAdd();
      if (!peek() || peek().t !== ')') throw new Error('缺少右括号');
      next();
      return e;
    }
    if (tk.t === 'id') {
      if (peek() && peek().t === '(') {
        next(); // consume (
        const args = [];
        if (peek() && peek().t !== ')') {
          args.push(parseAdd());
          while (peek() && peek().t === ',') { next(); args.push(parseAdd()); }
        }
        if (!peek() || peek().t !== ')') throw new Error(`函数 ${tk.v}( 缺少右括号`);
        next();
        return { k: 'call', fn: tk.v, args };
      }
      // 裸标识符：解析为 id 节点，是否合法由 checkExpr 按上下文判定
      // （函数参数位置允许；值位置拒绝并提示写成 x(A)/y(A)）
      return { k: 'id', v: tk.v };
    }
    throw new Error(`意外的符号 "${tk.t}"`);
  }
  function parseMul() {
    let l = parseFactor();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = next().t;
      l = { k: 'bin', op, a: l, b: parseFactor() };
    }
    return l;
  }
  function parseAdd() {
    let l = parseMul();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = next().t;
      l = { k: 'bin', op, a: l, b: parseMul() };
    }
    return l;
  }
  const ast = parseAdd();
  if (pos < tokens.length) throw new Error('表达式末尾有多余内容');
  return ast;
}

const EXPR_FUNCS = { x: 1, y: 1, Distance: 2 };

// 校验 AST：函数名/参数个数合法、引用的都是已定义的点 id。
// 返回该表达式引用到的点 id 数组。
function checkExpr(ast, definedPoints, errors, path) {
  const refs = [];
  (function walk(node) {
    if (!node) return;
    if (node.k === 'num') return;
    if (node.k === 'neg') return walk(node.a);
    if (node.k === 'bin') { walk(node.a); walk(node.b); return; }
    if (node.k === 'call') {
      const argc = EXPR_FUNCS[node.fn];
      if (!argc) { errors.push(`${path}：不支持的函数 "${node.fn}"（只允许 x、y、Distance）`); return; }
      if (node.args.length !== argc) { errors.push(`${path}：函数 ${node.fn} 需要 ${argc} 个参数`); return; }
      node.args.forEach((a) => {
        if (a.k !== 'id') { errors.push(`${path}：${node.fn} 的参数必须是点 id`); return; }
        if (!definedPoints.has(a.v)) { errors.push(`${path}：引用了未定义的点 "${a.v}"`); return; }
        refs.push(a.v);
      });
      return;
    }
    if (node.k === 'id') { errors.push(`${path}：不允许直接使用点 "${node.v}"，请写成 x(${node.v})/y(${node.v})`); }
  })(ast);
  return refs;
}

// ---------- 步骤校验 ----------

const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isPointRef(v) {
  return (typeof v === 'string' && SAFE_ID.test(v)) ||
    (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n)));
}

function validateSteps(steps) {
  const valid = [];
  const invalid = [];
  if (!Array.isArray(steps)) {
    return { valid, invalid: [{ item: steps, reason: '顶层必须是步骤数组' }] };
  }
  const defined = new Set();       // 已定义的 id（任意对象）
  const definedPoints = new Set(); // 已定义的点 id（表达式/点引用用）
  const fail = (item, reason) => invalid.push({ item, reason });

  steps.forEach((s, idx) => {
    const where = `第 ${idx + 1} 步`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      return fail(s, `${where}：必须是对象`);
    }
    const spec = STEP_TYPES[s.type];
    if (!spec) return fail(s, `${where}：不支持的类型 "${s.type}"`);

    const errors = [];
    // 逐字段校验
    for (const [field, kind] of Object.entries(spec)) {
      const v = s[field];
      const p = `${where}字段 ${field}`;
      if (kind === 'coords') {
        if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => Number.isFinite(n))) {
          errors.push(`${p} 需要 [x,y] 数值坐标`);
        }
      } else if (kind === 'pointref') {
        if (!isPointRef(v)) errors.push(`${p} 需要点 id 或 [x,y] 坐标`);
      } else if (kind === 'ref') {
        if (!(typeof v === 'string' && SAFE_ID.test(v))) errors.push(`${p} 需要对象 id`);
      } else if (kind === 'points3') {
        if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => isPointRef(x))) {
          errors.push(`${p} 需要三个点`);
        }
      } else if (kind === 'pointsN') {
        if (!Array.isArray(v) || v.length < 3 || !v.every((x) => isPointRef(x))) {
          errors.push(`${p} 需要至少三个点`);
        }
      } else if (kind === 'number') {
        if (!Number.isFinite(v)) errors.push(`${p} 需要数值`);
      } else if (kind === 'tricenterKind') {
        if (!['incenter', 'circumcenter', 'orthocenter'].includes(v)) errors.push(`${p} 只能是 incenter/circumcenter/orthocenter`);
      } else if (kind === 'mirrorType') {
        if (!['axial', 'central'].includes(v)) errors.push(`${p} 只能是 axial/central`);
      } else if (kind === 'expr') {
        try {
          const ast = parseExpr(v);
          checkExpr(ast, definedPoints, errors, p);
        } catch (e) {
          errors.push(`${p}：${e.message}`);
        }
      }
    }

    // 组合校验
    if (s.type === 'circle') {
      const a = s.through3 ? 1 : 0, b = (s.center && (s.radius !== undefined || s.through)) ? 1 : 0;
      if (a + b !== 1) errors.push(`${where}：circle 需要且只能给一种：through3 或 center+radius 或 center+through`);
      if (s.through3 && (!Array.isArray(s.through3) || s.through3.length !== 3 || !s.through3.every((x) => isPointRef(x)))) {
        errors.push(`${where}：through3 需要三个点`);
      }
      if (s.center !== undefined && !isPointRef(s.center)) errors.push(`${where}：center 需要点`);
      if (s.through !== undefined && !isPointRef(s.through)) errors.push(`${where}：through 需要点`);
      if (s.radius !== undefined && !Number.isFinite(s.radius)) errors.push(`${where}：radius 需要数值`);
    }
    if (s.type === 'intersection') {
      const poly = s.polygon !== undefined;
      if (!isPointRefOkId(s.e1)) errors.push(`${where}：e1 需要对象 id`);
      if (poly) {
        if (!(typeof s.polygon === 'string' && SAFE_ID.test(s.polygon))) errors.push(`${where}：polygon 需要多边形 id`);
        if (!Number.isInteger(s.edge) || s.edge < 0) errors.push(`${where}：edge 需要非负整数`);
      } else if (!(typeof s.e2 === 'string' && SAFE_ID.test(s.e2))) {
        errors.push(`${where}：e2 需要对象 id（或多边形形式 polygon+edge）`);
      }
      if (s.index !== undefined && (!Number.isInteger(s.index) || s.index < 0)) {
        errors.push(`${where}：index 需要非负整数`);
      }
      /* 位置约束（同侧/异侧）：side 存在时 index 被忽略，按叉积符号动态选点 */
      if (s.side !== undefined) {
        const sd = s.side;
        if (!sd || typeof sd !== 'object' || Array.isArray(sd)) {
          errors.push(`${where}：side 需要对象 {"line","point","rel"}`);
        } else {
          if (!(typeof sd.line === 'string' && SAFE_ID.test(sd.line))) {
            errors.push(`${where}：side.line 需要直线/线段/射线对象 id`);
          }
          if (!isPointRef(sd.point)) errors.push(`${where}：side.point 需要点 id`);
          if (sd.rel !== 'opposite' && sd.rel !== 'same') {
            errors.push(`${where}：side.rel 只能是 "opposite"（异侧）或 "same"（同侧）`);
          }
        }
      }
    }
    if (s.type === 'regularpolygon') {
      if (!Number.isInteger(s.n) || s.n < 3 || s.n > 60) errors.push(`${where}：n 需要 3～60 的整数`);
      const hasCenterForm = s.center !== undefined || s.vertex !== undefined;
      const hasTwoForm = s.p1 !== undefined || s.p2 !== undefined;
      if (hasCenterForm === hasTwoForm) errors.push(`${where}：regularpolygon 需要且只能给一种：center+vertex（中心模式）或 p1+p2（两点模式，相邻顶点、逆时针方向）`);
      else if (hasCenterForm && (s.center === undefined || s.vertex === undefined)) errors.push(`${where}：center 和 vertex 必须同时给出`);
      else if (hasTwoForm && (s.p1 === undefined || s.p2 === undefined)) errors.push(`${where}：p1 和 p2 必须同时给出`);
      if (s.center !== undefined && !isPointRef(s.center)) errors.push(`${where}：center 需要点`);
      if (s.vertex !== undefined && !isPointRef(s.vertex)) errors.push(`${where}：vertex 需要点`);
      if (s.p1 !== undefined && !isPointRef(s.p1)) errors.push(`${where}：p1 需要点`);
      if (s.p2 !== undefined && !isPointRef(s.p2)) errors.push(`${where}：p2 需要点`);
    }

    // 引用必须已定义（内联 [x,y] 视为自动建点，无需检查）
    const refFields = ['p1', 'p2', 'center', 'through', 'point', 'of', 'vertex', 'line', 'ref', 'e1', 'e2', 'polygon', 'axis'];
    for (const f of refFields) {
      const v = s[f];
      if (typeof v === 'string' && SAFE_ID.test(v) && !defined.has(v)) {
        errors.push(`${where}：引用了未定义的对象 "${v}"`);
      }
    }
    for (const f of ['through3', 'points']) {
      if (Array.isArray(s[f])) {
        for (const v of s[f]) {
          if (typeof v === 'string' && SAFE_ID.test(v) && !defined.has(v)) {
            errors.push(`${where}：引用了未定义的点 "${v}"`);
          }
        }
      }
    }
    if (s.type === 'intersection' && s.side && typeof s.side === 'object') {
      if (typeof s.side.line === 'string' && SAFE_ID.test(s.side.line) && !defined.has(s.side.line)) {
        errors.push(`${where}：side.line 引用了未定义的对象 "${s.side.line}"`);
      }
      if (typeof s.side.point === 'string' && SAFE_ID.test(s.side.point) && !definedPoints.has(s.side.point)) {
        errors.push(`${where}：side.point 引用了未定义的点 "${s.side.point}"`);
      }
    }

    // id 唯一性
    const ids = [s.id, s.id_line, s.end].filter((x) => x !== undefined && x !== null);
    for (const id of ids) {
      if (typeof id !== 'string' || !SAFE_ID.test(id)) {
        errors.push(`${where}：id "${id}" 非法（字母开头，仅字母数字下划线）`);
      } else if (defined.has(id)) {
        errors.push(`${where}：id "${id}" 重复定义`);
      }
    }

    if (errors.length) return fail(s, errors.join('；'));

    // 登记（确认通过后）
    for (const id of ids) defined.add(id);
    const definesPoint =
      ['point', 'midpoint', 'tricenter', 'mirrorpt', 'rotate', 'dilate', 'exprpoint', 'intersection', 'perpendicular'].includes(s.type) ||
      s.type === 'pseg' || s.type === 'psegfree'; // end 也是点
    if (definesPoint) {
      if (s.id) definedPoints.add(s.id);
      if (s.end) definedPoints.add(s.end);
      if (s.type === 'perpendicular' && s.id) definedPoints.add(s.id); // id 注册垂足
    }
    valid.push(s);
  });

  return { valid, invalid };
}

function isPointRefOkId(v) {
  return typeof v === 'string' && SAFE_ID.test(v);
}

// 供 system prompt 内嵌的 schema 说明（精简版，全量见 geometry-prototype/README.md）
function referenceText() {
  return [
    '{ "type": "point", "id": "A", "coords": [x, y] } —— 自由点；可加 "on": "曲线id" 表示约束在曲线上的动点',
    '{ "type": "segment"|"line"|"ray", "id", "p1", "p2" } —— p1/p2 为点 id 或 [x,y]',
    '{ "type": "circle", "id", "center", "radius" } 或 { "center", "through" } 或 { "through3": [p1,p2,p3] }',
    '{ "type": "arc", "id", "center", "p1", "p2" } —— 圆心—起点—终点',
    '{ "type": "arc3", "id", "through3": [A,B,C] } —— 三点圆弧',
    '{ "type": "ellipse", "id", "f1", "f2", "p" } —— 椭圆：两焦点 f1/f2 + 曲线上一点 p（三点不共线）',
    '{ "type": "hyperbola", "id", "f1", "f2", "p" } —— 双曲线：两焦点 f1/f2 + 曲线上一点 p（三点不共线）',
    '{ "type": "polygon", "id", "points": [...] }（≥3 点）',
    '{ "type": "regularpolygon", "id", "n": 5, "center", "vertex" } 或 { "n", "p1", "p2" } —— 正 N 边形；两点形式为相邻顶点、按逆时针方向',
    '{ "type": "midpoint", "id", "p1", "p2" }',
    '{ "type": "tricenter", "id", "kind": "incenter"|"circumcenter"|"orthocenter", "points": [A,B,C] }',
    '{ "type": "perpendicular", "id"（垂足）, "id_line"（垂线，可选）, "line", "point" }',
    '{ "type": "intersection", "id", "e1", "e2", "index"? } 或 "e1"+"polygon"+"edge"+"index"? —— index 只是交点序号，几何含义不固定',
    '{ "type": "intersection", "id", "e1", "e2", "side": {"line","point","rel":"opposite"|"same"} } —— 位置约束（两点在直线两侧/同侧等）必须用 side，不要用 index 猜；side.line 为更早定义的直线/线段/射线',
    '{ "type": "pline"|"pray", "id", "point", "ref" } —— 过点作平行直线/射线',
    '{ "type": "pseg", "id", "point", "ref", "end"? } —— 等长平行线段',
    '{ "type": "psegfree", "id", "point", "ref", "len", "end"? } —— 不等长平行线段（len 有向长度）',
    '{ "type": "mirrorpt", "id", "of", "axis", "t": "axial"|"central" }',
    '{ "type": "bisector", "id", "vertex", "p1", "p2" } —— 角平分线',
    '{ "type": "perpseg", "id", "point", "p1", "p2" } —— 垂线段',
    '{ "type": "rotate", "id", "of", "center", "angle" } —— 绕 center 旋转 angle 度（数值）',
    '{ "type": "dilate", "id", "of", "center", "ratio" } —— 位似点 center+ratio*(of-center)',
    '{ "type": "exprpoint", "id", "x": "表达式", "y": "表达式" } —— 表达式点；表达式只可用 x(A)、y(A)、Distance(A,B)、数字、+ - * / 括号，引用必须先定义',
    '规则：id 可省略（被引用时必填）；引用必须指向**前面已定义**的 id；作图辅助对象记得加 "visible": false 步骤属性隐藏（对象列表里也可切换显隐）',
  ].join('\n');
}

module.exports = { STEP_TYPES, validateSteps, parseExpr, referenceText };
