/* 立体几何原型（JSXGraph 3D）：步骤 JSON → view3d 渲染。
 * 步骤类型（原型版）：
 *   point3d    { "type", "id", "coords": [x,y,z] }
 *   segment3d  { "type", "id", "p1", "p2" }          —— p1/p2 为已定义点 id 或 [x,y,z]
 *   line3d     { "type", "id", "p1", "p2" }          —— 双向无限直线
 *   ray3d      { "type", "id", "p1", "p2" }          —— p1 为端点
 *   polygon3d  { "type", "id", "points": [...] }     —— 共面多边形
 *   sphere3d   { "type", "id", "center", "radius" }
 *   circle3d   { "type", "id", "center", "normal": [x,y,z], "radius" } —— 空间圆
 *   polyhedron3d { "type", "id", "vertices": [[x,y,z]...|点id...], "faces": [[顶点下标...]...] }
 *   pyramid3d  { "type", "id", "base": [...共面点], "apex": 点 }      —— 棱锥
 *   prism3d    { "type", "id", "base": [...共面点], "height": h }     —— 直棱柱（沿 z 平移）
 *   cuboid3d   { "type", "id", "corner": [x,y,z], "size": [a,b,c] }   —— 长方体
 */
var board = null, view = null;

function setStatus(msg, ok) {
  var el = document.getElementById('status');
  el.textContent = msg;
  el.style.color = ok === false ? '#cf222e' : '#1a7f37';
}

function initBoard() {
  if (board) JXG.JSXGraph.freeBoard(board);
  board = JXG.JSXGraph.initBoard('board', {
    boundingbox: [-8, 8, 8, -8],
    axis: false, grid: false, showCopyright: false, showNavigation: false,
    pan: { enabled: false },
    zoom: { enabled: false }
  });
  view = board.create('view3d', [
    [-7.5, -6],                     // 2D 左下角
    [15, 12],                       // 2D 宽高
    [[-8, 8], [-8, 8], [-2, 10]]    // x/y/z 三轴范围
  ], {
      xPlaneRear: { visible: false }, yPlaneRear: { visible: false },
      xPlaneFront: { visible: true, fillColor: '#f6f8fa', strokeColor: '#c9d1d9' },
      yPlaneFront: { visible: true, fillColor: '#f6f8fa', strokeColor: '#c9d1d9' }
    });
}

/* 把"点引用（id）或 [x,y,z] 坐标"解析为 point3d 对象；匿名点不显示标签 */
function resolvePoint3d(ref, registry, anonymous) {
  if (typeof ref === 'string') {
    var p = registry[ref];
    if (!p) throw new Error('未定义的点 "' + ref + '"');
    return p;
  }
  if (Array.isArray(ref) && ref.length === 3) {
    return view.create('point3d', ref, { name: '', withLabel: false, visible: false, fixed: true });
  }
  throw new Error('点参数必须是已定义点 id 或 [x,y,z] 坐标：' + JSON.stringify(ref));
}

var FACE_COLORS = ['#dbeafe', '#bfdbfe', '#93c5fd', '#dbeafe', '#bfdbfe', '#93c5fd'];

function renderSteps(steps) {
  initBoard();
  var registry = {};
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    if (!s || !s.type) throw new Error('第 ' + (i + 1) + ' 步缺少 type');
    var id = s.id || ('E' + (i + 1));
    switch (s.type) {
      case 'point3d': {
        if (!Array.isArray(s.coords) || s.coords.length !== 3)
          throw new Error('第 ' + (i + 1) + ' 步：point3d 需要 coords [x,y,z]');
        var p = view.create('point3d', s.coords, {
          name: id, size: 3, strokeColor: '#d55e00', fillColor: '#d55e00',
          label: { offset: [8, 8], fontSize: 14 }
        });
        registry[id] = p;
        break;
      }
      case 'segment3d':
      case 'line3d':
      case 'ray3d': {
        if (s.p1 === undefined || s.p2 === undefined)
          throw new Error('第 ' + (i + 1) + ' 步：' + s.type + ' 需要 p1, p2');
        var a = resolvePoint3d(s.p1, registry), b = resolvePoint3d(s.p2, registry);
        registry[id] = view.create('line3d', [a, b], {
          name: id,
          straightFirst: s.type !== 'segment3d' && s.type !== 'ray3d',
          straightLast: s.type !== 'segment3d',
          strokeColor: '#0969da', strokeWidth: 2
        });
        break;
      }
      case 'polygon3d': {
        if (!Array.isArray(s.points) || s.points.length < 3)
          throw new Error('第 ' + (i + 1) + ' 步：polygon3d 需要至少 3 个点');
        var ppts = s.points.map(function (r) { return resolvePoint3d(r, registry); });
        var poly = view.create('polygon3d', ppts, {
          name: id, fillColor: '#fef3c7', fillOpacity: 0.55,
          borders: { strokeColor: '#0969da', strokeWidth: 1.5 }
        });
        registry[id] = poly;
        break;
      }
      case 'sphere3d': {
        if (s.center === undefined || s.radius === undefined)
          throw new Error('第 ' + (i + 1) + ' 步：sphere3d 需要 center, radius');
        var c = resolvePoint3d(s.center, registry);
        registry[id] = view.create('sphere3d', [c, s.radius], {
          name: id, fillColor: '#bbf7d0', fillOpacity: 0.35, strokeColor: '#16a34a', strokeWidth: 1.5
        });
        break;
      }
      case 'circle3d': {
        if (s.center === undefined || !Array.isArray(s.normal) || s.radius === undefined)
          throw new Error('第 ' + (i + 1) + ' 步：circle3d 需要 center, normal [x,y,z], radius');
        var cc = resolvePoint3d(s.center, registry);
        registry[id] = view.create('circle3d', [cc, s.normal, s.radius], {
          name: id, strokeColor: '#7c3aed', strokeWidth: 2, fillColor: 'none'
        });
        break;
      }
      case 'polyhedron3d': {
        if (!Array.isArray(s.vertices) || !Array.isArray(s.faces))
          throw new Error('第 ' + (i + 1) + ' 步：polyhedron3d 需要 vertices 与 faces');
        var verts = s.vertices.map(function (r) { return resolvePoint3d(r, registry); });
        var faces = s.faces.map(function (f, fi) {
          return [f, { fillColor: FACE_COLORS[fi % FACE_COLORS.length], fillOpacity: 0.7,
                       strokeColor: '#1e40af', strokeWidth: 1.2 }];
        });
        registry[id] = view.create('polyhedron3d', [verts, faces], { name: id });
        break;
      }
      case 'pyramid3d': {
        if (!Array.isArray(s.base) || s.base.length < 3 || s.apex === undefined)
          throw new Error('第 ' + (i + 1) + ' 步：pyramid3d 需要 base（≥3 共面点）与 apex');
        var basePts = s.base.map(function (r) { return resolvePoint3d(r, registry); });
        var apex = resolvePoint3d(s.apex, registry);
        var verts2 = basePts.concat([apex]);
        var faces2 = [];
        var baseIdx = [];
        for (var k = 0; k < basePts.length; k++) baseIdx.push(k);
        faces2.push(baseIdx);
        for (var j = 0; j < basePts.length; j++)
          faces2.push([j, (j + 1) % basePts.length, basePts.length]);
        var pf = faces2.map(function (f, fi) {
          return [f, { fillColor: FACE_COLORS[fi % FACE_COLORS.length], fillOpacity: 0.7,
                       strokeColor: '#1e40af', strokeWidth: 1.2 }];
        });
        registry[id] = view.create('polyhedron3d', [verts2, pf], { name: id });
        break;
      }
      case 'prism3d': {
        if (!Array.isArray(s.base) || s.base.length < 3 || s.height === undefined)
          throw new Error('第 ' + (i + 1) + ' 步：prism3d 需要 base（≥3 共面点）与 height');
        var bPts = s.base.map(function (r) { return resolvePoint3d(r, registry); });
        var n = bPts.length, h = s.height;
        var topPts = bPts.map(function (bp) {
          return view.create('point3d', [
            function () { return bp.X(); },
            function () { return bp.Y(); },
            function () { return bp.Z() + h; }
          ], { name: '', withLabel: false, visible: false, fixed: true });
        });
        var verts3 = bPts.concat(topPts);
        var faces3 = [];
        var bot = [], top = [];
        for (var k2 = 0; k2 < n; k2++) { bot.push(k2); top.push(2 * n - 1 - k2); }
        faces3.push(bot, top);
        for (var j2 = 0; j2 < n; j2++)
          faces3.push([j2, (j2 + 1) % n, ((j2 + 1) % n) + n, j2 + n]);
        var pf3 = faces3.map(function (f, fi) {
          return [f, { fillColor: FACE_COLORS[fi % FACE_COLORS.length], fillOpacity: 0.7,
                       strokeColor: '#1e40af', strokeWidth: 1.2 }];
        });
        registry[id] = view.create('polyhedron3d', [verts3, pf3], { name: id });
        break;
      }
      case 'cuboid3d': {
        if (!Array.isArray(s.corner) || !Array.isArray(s.size) || s.size.length !== 3)
          throw new Error('第 ' + (i + 1) + ' 步：cuboid3d 需要 corner [x,y,z] 与 size [a,b,c]');
        var o = s.corner, sz = s.size;
        var v8 = [
          [o[0], o[1], o[2]], [o[0] + sz[0], o[1], o[2]],
          [o[0] + sz[0], o[1] + sz[1], o[2]], [o[0], o[1] + sz[1], o[2]],
          [o[0], o[1], o[2] + sz[2]], [o[0] + sz[0], o[1], o[2] + sz[2]],
          [o[0] + sz[0], o[1] + sz[1], o[2] + sz[2]], [o[0], o[1] + sz[1], o[2] + sz[2]]
        ].map(function (cc2) { return resolvePoint3d(cc2, registry); });
        var f6 = [
          [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1],
          [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]
        ].map(function (f, fi) {
          return [f, { fillColor: FACE_COLORS[fi % FACE_COLORS.length], fillOpacity: 0.7,
                       strokeColor: '#1e40af', strokeWidth: 1.2 }];
        });
        registry[id] = view.create('polyhedron3d', [v8, f6], { name: id });
        break;
      }
      default:
        throw new Error('第 ' + (i + 1) + ' 步：未知类型 "' + s.type + '"');
    }
  }
  board.update();
  return steps.length;
}

/* ---------- 示例 ---------- */
var EXAMPLES = {
  pyramid: [
    { type: 'point3d', id: 'A', coords: [2, 0, 0] },
    { type: 'point3d', id: 'B', coords: [5, 0, 0] },
    { type: 'point3d', id: 'C', coords: [3.5, 3, 0] },
    { type: 'point3d', id: 'P', coords: [3.2, 1.2, 4] },
    { type: 'polygon3d', id: 'baseABC', points: ['A', 'B', 'C'] },
    { type: 'pyramid3d', id: 'pyr1', base: ['A', 'B', 'C'], apex: 'P' },
    { type: 'segment3d', id: 'h', p1: 'P', p2: [3.2, 1.2, 0] }
  ],
  cuboid: [
    { type: 'cuboid3d', id: 'box1', corner: [0, 0, 0], size: [4, 3, 2.5] },
    { type: 'segment3d', id: 'diag', p1: [0, 0, 0], p2: [4, 3, 2.5] },
    { type: 'point3d', id: 'O', coords: [0, 0, 0] },
    { type: 'point3d', id: "B'", coords: [4, 3, 2.5] }
  ],
  sphere: [
    { type: 'point3d', id: 'O', coords: [0, 0, 2] },
    { type: 'sphere3d', id: 's1', center: 'O', radius: 2.5 },
    { type: 'circle3d', id: 'eq', center: 'O', normal: [0, 0, 1], radius: 2.5 },
    { type: 'circle3d', id: 'mer', center: 'O', normal: [1, 0, 0], radius: 2.5 },
    { type: 'point3d', id: 'A', coords: [2.5, 0, 2] },
    { type: 'segment3d', id: 'r', p1: 'O', p2: 'A' }
  ],
  combo: [
    { type: 'point3d', id: 'A', coords: [0, 0, 0] },
    { type: 'point3d', id: 'B', coords: [4, 0, 0] },
    { type: 'point3d', id: 'C', coords: [4, 4, 0] },
    { type: 'point3d', id: 'D', coords: [0, 4, 0] },
    { type: 'point3d', id: 'P', coords: [2, 2, 4] },
    { type: 'polygon3d', id: 'base', points: ['A', 'B', 'C', 'D'] },
    { type: 'pyramid3d', id: 'pyr', base: ['A', 'B', 'C', 'D'], apex: 'P' },
    { type: 'prism3d', id: 'prism', base: ['A', 'B', 'C', 'D'], height: -2 },
    { type: 'segment3d', id: 'h', p1: 'P', p2: [2, 2, 0] }
  ]
};

document.getElementById('schemaDoc').textContent =
  '步骤类型（原型版）：\n' +
  '  point3d      { type, id, coords:[x,y,z] }\n' +
  '  segment3d / line3d / ray3d   { type, id, p1, p2 }\n' +
  '  polygon3d    { type, id, points:[...] }（共面多边形）\n' +
  '  sphere3d     { type, id, center, radius }\n' +
  '  circle3d     { type, id, center, normal:[x,y,z], radius }\n' +
  '  polyhedron3d { type, id, vertices:[...], faces:[[下标...]...] }\n' +
  '  pyramid3d    { type, id, base:[...共面点], apex }\n' +
  '  prism3d      { type, id, base:[...共面点], height }\n' +
  '  cuboid3d     { type, id, corner:[x,y,z], size:[a,b,c] }\n' +
  '点参数一律支持两种写法：已定义点 id 或 [x,y,z] 坐标。';

function renderFromTextarea() {
  try {
    var steps = JSON.parse(document.getElementById('steps').value);
    if (!Array.isArray(steps)) throw new Error('顶层必须是数组');
    var n = renderSteps(steps);
    setStatus('已渲染 ' + n + ' 步。');
  } catch (e) {
    setStatus('渲染失败：' + e.message, false);
  }
}

document.getElementById('renderBtn').addEventListener('click', renderFromTextarea);
document.getElementById('copyBtn').addEventListener('click', function () {
  var ta = document.getElementById('steps');
  ta.select();
  document.execCommand('copy');
  setStatus('已复制。');
});
Array.prototype.forEach.call(document.querySelectorAll('[data-example]'), function (btn) {
  btn.addEventListener('click', function () {
    document.getElementById('steps').value =
      JSON.stringify(EXAMPLES[btn.getAttribute('data-example')], null, 2);
    renderFromTextarea();
  });
});

/* 调试入口（自动化测试用） */
window.__render3d = function (steps) {
  var n = renderSteps(steps);
  return { ok: true, count: n };
};

initBoard();
document.getElementById('steps').value = JSON.stringify(EXAMPLES.pyramid, null, 2);
renderFromTextarea();
