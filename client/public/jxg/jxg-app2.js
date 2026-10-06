/* ============================================================
 * jxg-app2.js —— 拖拽/吸附/约束、选择与高亮、命中测试、框选、对称、平行、交点
 * 与其它 jxg-app*.js 以普通 <script> 顺序加载，共享全局作用域。
 * ============================================================ */

/* 是否有进行中的构建（多步拾取/多边形顶点/交点选线/平行/对称/旋转/框选）。
 * Esc 与"构建中右键 = Esc"共用此判定；拾取态定义在 jxg-app4.js（后加载），
 * 事件触发时都已就绪，这里用 typeof 兜底防止加载期引用报错。 */
function isConstructing() {
  return !!(typeof pendingPts !== 'undefined' && pendingPts.length) ||
         !!(typeof polyPts !== 'undefined' && polyPts.length) ||
         !!(typeof pendingCurve !== 'undefined' && pendingCurve) ||
         !!(typeof pendingParPoint !== 'undefined' && pendingParPoint !== null) ||
         !!(typeof symPending !== 'undefined' && symPending.length) ||
         !!(typeof symAxis !== 'undefined' && symAxis) ||
         !!(typeof marqueeState !== 'undefined' && marqueeState) ||
         !!(typeof symMarquee !== 'undefined' && symMarquee);
}
/* 右键菜单：挂在画板容器上 */
document.getElementById('jxgbox').addEventListener('contextmenu', function (e) {
  if (suppressCtxOnce) { suppressCtxOnce = false; e.preventDefault(); return; }
  if (typeof READ_ONLY !== 'undefined' && READ_ONLY) return;   // 只读态无右键菜单
  e.preventDefault();
  /* 构建过程中：右键等价 Esc —— 取消当前构建并停留在当前工具，不弹对象菜单。
   * 右键按下在构建工具里本来就不产生拾取（board.on('down') 对右键提前返回），
   * 因此到这里时构建仍停留在按下前的状态，直接取消即可。 */
  if (isConstructing()) {
    hideCtxMenu();
    try { setMode(mode); } catch (eC) {}   // 同模式重入：清空拾取态/预览/框选/高亮
    try { setStatus('已取消当前构建。', true); } catch (eS) {}
    return;
  }
  var cPos0 = board.getCoordsTopLeftCorner(e);
  var absPos0 = JXG.getPosition(e);
  var sx = absPos0[0] - cPos0[0], sy = absPos0[1] - cPos0[1];
  var coords = getUsrCoords(e);
  var x = coords.usrCoords[1], y = coords.usrCoords[2];
  var hit = null;
  try { hit = findPointNear(sx, sy) || findObjectAt(sx, sy, x, y); } catch (err) { hit = null; }
  if (!hit) { hideCtxMenu(); return; }
  showCtxMenu(e.clientX, e.clientY, hit);
});
/* 点菜单外任意处 / Esc 关闭菜单与属性面板 */
document.addEventListener('mousedown', function (e) {
  var m = document.getElementById('ctxmenu');
  if (m && m.style.display === 'block' && !m.contains(e.target)) hideCtxMenu();
});
/* 属性面板激活时：点画板上的元素 / 对象列表行 → 切换显示该元素属性；
 * 点空白或其他界面不关闭（只能经 × 按钮 / Esc 关闭）。
 * 必须用捕获阶段：JSXGraph 会拦截对象上的 mousedown 冒泡，冒泡阶段收不到。 */
document.addEventListener('mousedown', function (e) {
  var p = document.getElementById('proppanel');
  if (!p || p.style.display !== 'block') return;
  if (p.contains(e.target)) return;
  var m = document.getElementById('ctxmenu');
  if (m && m.contains(e.target)) return;
  if (!(e.target && e.target.closest)) return;
  if (e.target.closest('#jxgbox')) {
    try {
      var cPos1 = board.getCoordsTopLeftCorner(e);
      var absPos1 = JXG.getPosition(e);
      var sx1 = absPos1[0] - cPos1[0], sy1 = absPos1[1] - cPos1[1];
      var uc = getUsrCoords(e);
      var hit1 = findPointNear(sx1, sy1) || findObjectAt(sx1, sy1, uc.usrCoords[1], uc.usrCoords[2]);
      if (hit1 && hit1._defKind !== 'perpline' && hit1._defKind !== 'sidecand' && board.objects[hit1.id]) {
        var sel1 = selectedObjs.filter(function (a) { return board.objects[a.id]; });
        openPropPanel(sel1.length > 1 && isSelected(hit1) ? sel1 : hit1);
      }
    } catch (err) {}
  } else {
    var row = e.target.closest('.objrow');
    var rid = row && row.getAttribute('data-id');
    if (rid && board.objects[rid]) {
      var ro = board.objects[rid];
      var sel2 = selectedObjs.filter(function (a) { return board.objects[a.id]; });
      openPropPanel(sel2.length > 1 && isSelected(ro) ? sel2 : ro);
    }
  }
}, true);
window.addEventListener('resize', function () { hideCtxMenu(); });

var mode = 'point';          // 当前工具
var pendingPts = [];         // 两步工具（线段/直线/圆）暂存的点
var pendingReused = false;   // 本次两步操作中是否复用了已有点
var pendingInter = false;    // 本次两步操作中是否生成了联动交点
var polyPts = [];            // 多边形工具暂存的点
var pendingCurve = null;       // 交点工具暂存的第一条曲线
var pendingParPoint = null;    // 平行工具暂存的过点
var pendingParRef = null;      // 平行工具暂存的参照线（线段/直线/射线）
var symAxis = null;            // 对称工具暂存的对称轴（线对象）/对称中心（点对象）
var symPending = [];           // 对称工具多选的待对称对象 id
var symMarquee = null;         // 对称工具框选中的暂存 {x0,y0,x1,y1,div}
var lastSymDownTime = 0, lastSymDownX = 0, lastSymDownY = 0;  // 对称工具双击检测

/* 组合手势历史捆绑：多次点击完成一次作图的工具，整组只记一条撤销。
 * histBundled：false=无；'open'=手势进行中尚未创建对象（懒记——第一次真正创建
 * 时才 pushHistory）；true=已记一条，同手势后续创建全部跳过。 */
var histBundled = false;
/* 多次点击完成一次作图的工具（线段/圆/正多边形/交点/平行…）：进入即开包 */
var COMPOSITE_BUNDLE_MODES = {
  segment: 1, line: 1, ray: 1, circle: 1,
  circle3: 1, arc: 1, arc3: 1, ngon: 1, polygon: 1,
  ellipse: 1, hyperbola: 1, parabola: 1, conic: 1,
  intersect: 1, midpoint: 1, perpendicular: 1, perpseg: 1,
  bisector: 1, incenter: 1, circumcenter: 1, orthocenter: 1,
  pline: 1, pray: 1, pseg: 1, psegfree: 1,
  mang: 1, adrive: 1
};
var gestureGroupIds = [];   // 本次手势创建的对象内部 id（登记列表分组用）
var objGroups = [];         // 对象列表分组：组合手势生成的对象块，列表拖拽不可拆散
/* 结束一次组合手势：登记列表分组（按内部 id，存活且 >1 个才成组；
 * 内部 id 撤销后不再复用，避免分组误套到同名新对象上），重置开包状态 */
function closeHistoryBundle() {
  if (histBundled === true && gestureGroupIds.length > 1) {
    var ids = gestureGroupIds.filter(function (id, i) {
      return id && gestureGroupIds.indexOf(id) === i && createdIds.indexOf(id) >= 0;
    });
    if (ids.length > 1) objGroups.push(ids);
  }
  histBundled = false;
  gestureGroupIds = [];
}
var createdIds = [];         // 用户创建的对象 id（用于删除/清空时过滤坐标轴）
var autoN = 0;
var panState = null;         // 选择模式下拖动空白背景平移视图时的暂存状态
var blankDownAddKey = false; // 选择模式空白处按下时是否按住 Shift/Ctrl（纯点击空白取消选择用）
var marqueeState = null;      // 独立框选工具的拉框暂存 {x0,y0,x1,y1,div,addKey}
var rightPan = null;         // 右键拖动平移视图暂存 {sx,sy,moved}
var suppressCtxOnce = false; // 右键拖动松手后抑制一次 contextmenu
var lastDownTime = 0, lastDownX = 0, lastDownY = 0;  // 双击检测（多边形双击结束）
var lastPolyFinishMs = 0;   // 多边形闭合时刻：双击结束的第二次按下不得另起新多边形
var lastListRefresh = 0;     // 对象列表节流刷新的时间戳

/* ---------- 对象列表自动刷新：任何增删后更新 ---------- */
(function () {
  var _create = board.create.bind(board);
  board.create = function () {
    var el = _create.apply(null, arguments);
    /* 批量重建期间（suppressHistory=true）跳过逐个刷新，由 renderSteps 统一刷一次，避免闪烁 */
    if (!suppressHistory) { try { refreshObjectList(); } catch (e) {} }
    /* 给可自由拖动的普通点挂上拖拽吸附（glider 约束在曲线上、固定点不吸） */
    try { attachSnap(el); } catch (e2) {}
    return el;
  };
  var _remove = board.removeObject.bind(board);
  board.removeObject = function (o) {
    var r = _remove(o);
    if (!suppressHistory) { try { refreshObjectList(); } catch (e) {} }
    return r;
  };
})();

/* ---------- 拖拽吸附网格 ---------- */
var SNAP_PX = 6;   // 吸附阈值：点离最近格线交点 ≤ 该屏幕像素数就吸上
var SNAP_CURVE_PX = 7;   // 贴线阈值：拖点时离曲线 ≤ 该屏幕像素数就优先贴到线上
function snapThresholdPx() {
  /* 缩放很远、格子很密时阈值不能超过约 1/3 格，避免"永远在吸" */
  return Math.min(SNAP_PX, 0.35 * Math.min(board.unitX, board.unitY));
}
/* 把用户坐标点 (px,py) 投影到曲线 cv 上的最近点（用户坐标）。
 * 线段取线段内最近点；直线取无限直线垂足；射线只取正向（含起点）；
 * 圆取径向投影；圆弧投影超出角度范围时取最近端点。投影失败返回 null。 */
/* 椭圆/双曲线参数采样（用户坐标）：t 均匀取 [0,2π)，
 * 跳过非有限值与渐近线附近发散的超大坐标（双曲线在渐近线方向无界）。 */
function conicSamplePoints(o, n, bound) {
  var pts = [], N = n || 96, i, t, x, y;
  var lim = (typeof bound === 'number' && bound > 0) ? bound : 1e4;
  for (i = 0; i < N; i++) {
    t = 2 * Math.PI * i / N;
    try { x = o.X(t); y = o.Y(t); } catch (e) { continue; }
    if (!isFinite(x) || !isFinite(y)) continue;
    if (Math.abs(x) > lim || Math.abs(y) > lim) continue;
    pts.push([x, y]);
  }
  return pts;
}
/* 圆锥曲线动画路径：在当前视口范围截断的采样折线（用户坐标）。
 * 双曲线采样跨过渐近线时相邻点落在不同分支、距离超大：这类段记为 0 长"瞬移"，
 * 动画沿折线按弧长匀速推进，瞬移点直接跳变（不横穿画面）；
 * 椭圆等封闭曲线折线首尾自然闭合，无瞬移。 */
function conicAnimPath(cv) {
  try {
    var bb = board.getBoundingBox();
    var span = Math.max(bb[2] - bb[0], bb[1] - bb[3]);
    if (!(span > 0)) return null;
    var smp = conicSamplePoints(cv, 480, 1.5 * span);
    if (smp.length < 2) return null;
    var jump = 0.9 * span;   // 相邻采样间距超过该值：判定为跨渐近线瞬移段
    var pts = smp, n = pts.length;
    var cum = new Array(n + 1), total = 0, i, d;
    cum[0] = 0;
    for (i = 1; i < n; i++) {
      d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      total += (d > jump) ? 0 : d;
      cum[i] = total;
    }
    d = Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]);
    total += (d > jump) ? 0 : d;
    cum[n] = total;
    return { pts: pts, cum: cum, total: total };
  } catch (e) { return null; }
}
/* 折线上弧长 s 处的点（s 按总长取模；0 长瞬移段直接返回段终点） */
function conicPathPointAt(path, s) {
  var pts = path.pts, cum = path.cum, total = path.total, n = pts.length;
  if (n === 0) return null;
  if (n === 1 || !(total > 0)) return pts[0];
  s = ((s % total) + total) % total;
  var i = 0;
  while (i < n - 1 && cum[i + 1] < s) i++;
  var seg = cum[i + 1] - cum[i];
  var a = pts[i], b = pts[(i + 1) % n];
  if (seg <= 0) return b;
  var f = (s - cum[i]) / seg;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
function projectPointToCurve(px, py, cv) {
  if (!cv) return null;
  try {
    var et = cv.elType;
    if (isConicEl(cv)) {
      /* 圆锥曲线：优先用 JSXGraph 数值投影（glider 同款，渐近线附近也准），失败回退采样取点 */
      try {
        var pr = JXG.Math.Geometry.projectCoordsToCurve(px, py, 0, cv, board);
        if (pr && pr[0] && isFinite(pr[0].usrCoords[1]) && isFinite(pr[0].usrCoords[2])) {
          return [pr[0].usrCoords[1], pr[0].usrCoords[2]];
        }
      } catch (e0) {}
      var smp = conicSamplePoints(cv), bq = null, bd = Infinity;
      for (var si = 0; si < smp.length; si++) {
        var dd2 = (smp[si][0] - px) * (smp[si][0] - px) + (smp[si][1] - py) * (smp[si][1] - py);
        if (dd2 < bd) { bd = dd2; bq = smp[si]; }
      }
      return bq;
    }
    if (et === 'segment' || et === 'line') {
      var A = cv.point1, B = cv.point2;
      if (!A || !B) return null;
      var ax = A.X(), ay = A.Y();
      var vx = B.X() - ax, vy = B.Y() - ay;
      var L2 = vx * vx + vy * vy;
      if (L2 < 1e-12) return [ax, ay];
      var t = ((px - ax) * vx + (py - ay) * vy) / L2;
      if (et === 'segment') t = Math.max(0, Math.min(1, t));
      else if (cv._defKind === 'ray' || cv._defKind === 'bisector') t = Math.max(0, t);
      return [ax + vx * t, ay + vy * t];
    }
    if (et === 'circle' || et === 'circumcircle' || et === 'arc') {
      var c = symCircleCenter(cv);
      var r = radiusOf(cv);
      if (!c || !isFinite(r) || r <= 0) return null;
      var cx = c.X(), cy = c.Y();
      var dx = px - cx, dy = py - cy;
      var d = Math.hypot(dx, dy);
      if (d < 1e-9) return null;   // 点恰在圆心：投影不定，跳过贴线
      var qx = cx + dx / d * r, qy = cy + dy / d * r;
      if (et === 'arc') {
        var p1 = cv.parents[1] && board.objects[cv.parents[1]];
        var p2 = cv.parents[2] && board.objects[cv.parents[2]];
        if (p1 && p2) {
          var a1 = Math.atan2(p1.Y() - cy, p1.X() - cx);
          var a2 = Math.atan2(p2.Y() - cy, p2.X() - cx);
          while (a2 <= a1) a2 += 2 * Math.PI;   // 与建弧一致：统一按逆时针走
          var aq = Math.atan2(qy - cy, qx - cx);
          while (aq < a1) aq += 2 * Math.PI;
          if (aq > a2) {   // 投影落在圆弧范围外：取最近端点
            var d1 = (qx - p1.X()) * (qx - p1.X()) + (qy - p1.Y()) * (qy - p1.Y());
            var d2 = (qx - p2.X()) * (qx - p2.X()) + (qy - p2.Y()) * (qy - p2.Y());
            var pe = d1 <= d2 ? p1 : p2;
            return [pe.X(), pe.Y()];
          }
        }
      }
      return [qx, qy];
    }
  } catch (e) { return null; }
  return null;
}
/* 点拖到离网格点足够近时吸到网格点上。
 * 每次 mousemove 都重新判定：拖离阈值自动松开、不锁死，不松手可继续移动。 */
function snapPointToGrid(pt) {
  if (!pt || pt.elType !== 'point' || pt._defKind === 'glider') return;
  if (!pt.isDraggable || !board.objects[pt.id]) return;
  pt._snapCurve = null;
  /* 1) 贴线优先：SNAP_CURVE_PX 内取投影最近的一条曲线。
   * 排除以该点为定义点的曲线（避免自吸附退化）、多级依赖曲线、辅助垂线段与不可见曲线。
   * 多选整体移动时也只有被鼠标点中的主点会走到这里（跟随点由 update 镜像刚性位移，
   * 不触发 drag、不吸附），主点吸到线上整组同步平移，行为与吸格点一致。 */
  var sp = toScreenPx(pt.X(), pt.Y());
  var best = null, bestQ = null, bestD = Infinity, i, o;
  forEachSnapCurve(function (cand) {
    o = cand;
    if (o._polyBorderOf) {
      /* 多边形边：该点是该多边形顶点（含直接/间接依赖关系）时不吸，避免自吸附退化 */
      var poly = board.objects[o._polyBorderOf.polyId];
      if (poly && (definesPoint(poly, pt) || curveDependsOn(poly, pt))) return;
    }
    if (definesPoint(o, pt)) return;
    if (curveDependsOn(o, pt)) return;   // 多级依赖：拖动中不吸到（直接或间接）由该点定义的曲线上
    if (o.getAttribute && o.getAttribute('visible') === false) return;
    var q = projectPointToCurve(pt.X(), pt.Y(), o);
    if (!q) return;
    var qs = toScreenPx(q[0], q[1]);
    var dd = Math.hypot(sp[0] - qs[0], sp[1] - qs[1]);
    if (dd <= SNAP_CURVE_PX && dd < bestD) { best = o; bestQ = q; bestD = dd; }
  });
  if (best) {
    pt._snapCurve = best;   // 供「拖点到线松手加约束」复用候选线
    pt.setPosition(JXG.COORDS_BY_USER, bestQ);
    return;
  }
  /* 2) 无近线才贴格点：只吸到图上有格线的交叉点（主格线间隔的整数倍），
   * 不吸所有整数点；网格隐藏时不吸附 */
  if (!boardGridOn()) return;
  var step = gridMajorStep();
  if (!(step > 0)) return;
  var gx = Math.round(pt.X() / step) * step;
  var gy = Math.round(pt.Y() / step) * step;
  gx = Math.round(gx * 1e6) / 1e6;
  gy = Math.round(gy * 1e6) / 1e6;
  var dx = (gx - pt.X()) * board.unitX, dy = (gy - pt.Y()) * board.unitY;
  var thr = snapThresholdPx();
  if (dx * dx + dy * dy <= thr * thr) pt.setPosition(JXG.COORDS_BY_USER, [gx, gy]);
}
/* 当前主格线间隔（用户单位）：取坐标轴刻度元素的 getDistanceMajorTicks，
 * 与格线绘制同源（unifyGridTicks 已保证两轴同间隔），缩放后自动跟随变化 */
function gridMajorStep() {
  try {
    for (var id in board.objects) {
      var o = board.objects[id];
      if (o && o.elType === 'ticks' && typeof o.getDistanceMajorTicks === 'function') {
        var d = o.getDistanceMajorTicks();
        if (d > 0) return d;
      }
    }
  } catch (e) {}
  return 1;
}
/* 拖拽中更新贴线候选高亮：只有真正的单点原生拖拽、且约束允许时才高亮；
 * 会形成依赖环的曲线不高亮（松手也不会加约束） */
function updateSnapCandidate(pt) {
  var cv = (pt && pt._snapCurve) || null;
  if (!singleDrag || !singleDrag.point || singleDrag.point !== pt) cv = null;
  else if (cv && !canConstrainOn(pt, cv)) cv = null;
  if (cv) candHighlightOn(cv); else candHighlightOff();
}
/* 给新建的可自由拖动的普通点挂上拖拽吸附 */
function attachSnap(el) {
  if (!el || el.elType !== 'point' || el._defKind === 'glider') return;
  if (el._defKind === 'parend') return;   // 平行端点：等长的固定、自由的沿线滑动，都不做网格吸附
  if (!el.isDraggable || el._snapOn || typeof el.on !== 'function') return;
  el._snapOn = true;
  el.on('drag', function () { snapPointToGrid(el); updateSnapCandidate(el); });
}

/* ---------- 滚轮缩放（以鼠标位置为中心，直接滚轮即可） ---------- */
document.getElementById('jxgbox').addEventListener('wheel', function (e) {
  e.preventDefault();
  var cPos = board.getCoordsTopLeftCorner(e);
  var absPos = JXG.getPosition(e);
  var mc = new JXG.Coords(JXG.COORDS_BY_SCREEN, [absPos[0] - cPos[0], absPos[1] - cPos[1]], board);
  var mx = mc.usrCoords[1], my = mc.usrCoords[2];
  var z = e.deltaY > 0 ? 1.2 : 1 / 1.2;
  var bb = board.getBoundingBox();
  board.setBoundingBox([mx + (bb[0] - mx) * z, my + (bb[1] - my) * z,
                        mx + (bb[2] - mx) * z, my + (bb[3] - my) * z], true, 'update');
  enforceSquareGrid([mx, my]);
}, { passive: false });

/* 格线必须为正方形（unitX==unitY）。JSXGraph 的 keepaspectratio 缩放只保持
 * "当前" 比例：一旦 unitX!=unitY，滚轮缩放会把矩形比例永远保留下去。
 * 这里以锚点（用户坐标，通常为鼠标位置）的屏幕位置不变为前提，
 * 扩展较短的一边，使单位像素相等。 */
function enforceSquareGrid(anchor) {
  try {
    var cw = board.canvasWidth, ch = board.canvasHeight;
    if (!cw || !ch) return;
    var bb = board.getBoundingBox();
    var x0 = bb[0], y1 = bb[1], x2 = bb[2], y3 = bb[3];
    var w = x2 - x0, h = y1 - y3;
    if (!(w > 0) || !(h > 0)) return;
    var target = cw / ch;                 // 期望的 w/h（单位相等时）
    if (Math.abs(w / h - target) < 0.001) return;
    var ax = anchor ? anchor[0] : (x0 + x2) / 2;
    var ay = anchor ? anchor[1] : (y1 + y3) / 2;
    var hNeed = w / target, wNeed = h * target;
    if (hNeed >= h) {
      var fy = (ay - y3) / h;
      var ny3 = ay - fy * hNeed, ny1 = ny3 + hNeed;
      board.setBoundingBox([x0, ny1, x2, ny3], false, 'update');
    } else {
      var fx = (ax - x0) / w;
      var nx0 = ax - fx * wNeed, nx2 = nx0 + wNeed;
      board.setBoundingBox([nx0, y1, nx2, y3], false, 'update');
    }
    /* 精确分支会把 keepaspectratio 置 false，恢复之，后续缩放行为不变 */
    board.keepaspectratio = true;
  } catch (e) {}
}
/* 兜底保证：拦包 board.setBoundingBox，任何路径（滚轮/平移/容器缩放/
 * 触摸捏合/内部 zoomIn 等）改完边界盒后都强制校正方形格线。
 * 不逐处打点，新增缩放入口也自动覆盖。 */
(function () {
  var origSetBB = board.setBoundingBox.bind(board);
  var enforcing = false;
  board.setBoundingBox = function (bbox, keepaspect, update) {
    var r = origSetBB(bbox, keepaspect, update);
    if (!enforcing) {
      enforcing = true;
      try { enforceSquareGrid(); } catch (e) {}
      enforcing = false;
    }
    return r;
  };
})();
/* 统一两轴格线主间隔：JSXGraph 的自动间隔按"各轴边界盒跨度/6"取整，
 * X/Y 跨度不同时会取成不同的整齐数（如 X 每 2 单位、Y 每 1 单位），
 * 即使单位像素相等，格线也是矩形。这里按统一像素目标（120px）换算
 * 一个两轴共用的 1/2/5×10^n 间隔，格线恒为正方形。 */
(function unifyGridTicks() {
  try {
    var proto = JXG.Ticks && JXG.Ticks.prototype;
    if (!proto || proto.__squareGridPatched) return;
    proto.getDistanceMajorTicks = function () {
      var b = this.board;
      var u = Math.min(b.unitX, b.unitY);
      if (!(u > 0)) return 1;
      var raw = 120 / u;                 // 期望主间隔（用户单位）
      var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
      var n = raw / mag;
      return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * mag;
    };
    proto.__squareGridPatched = true;
  } catch (e) {}
})();

/* ---------- 画板窗口可拖动调整大小 ---------- */
(function () {
  var wrap = document.getElementById('boardwrap');
  if (!wrap || !window.ResizeObserver) return;
  new ResizeObserver(function () {
    var w = wrap.clientWidth, h = wrap.clientHeight;
    /* dontset=false：重设边界盒。keepaspectratio=true 会保持 unitX==unitY，
     * 格线始终是正方形（dontset=true 只改像素尺寸，x/y 单位会不等） */
    if (w > 50 && h > 50) { try { board.resizeContainer(w, h, false); } catch (e) {} }
    /* 对象列表面板高度与绘图区一致，超出部分在列表内部滚动 */
    try {
      var op = document.getElementById('objpanel');
      if (op && h > 50) op.style.height = h + 'px';
    } catch (eH) {}
  }).observe(wrap);
})();

/* ---------- 选择模式：拖动空白背景平移视图；对象列表节流刷新 ---------- */
board.on('move', function (e) {
  var now = Date.now();
  if (now - lastListRefresh > 400) {
    lastListRefresh = now;
    try { refreshObjectList(); } catch (err) {}
  }
  /* 对称工具框选中：更新矩形 */
  if (symMarquee) {
    var cPosM = board.getCoordsTopLeftCorner(e);
    var absPosM = JXG.getPosition(e);
    symMarquee.x1 = absPosM[0] - cPosM[0];
    symMarquee.y1 = absPosM[1] - cPosM[1];
    updateSymMarqueeDiv();
    return;
  }
  /* 框选工具：更新虚线框 */
  if (marqueeState) {
    var cPosM = board.getCoordsTopLeftCorner(e);
    var absPosM = JXG.getPosition(e);
    marqueeState.x1 = absPosM[0] - cPosM[0];
    marqueeState.y1 = absPosM[1] - cPosM[1];
    updateMarqueeDiv();
    return;
  }
  /* 垂线段第二步：悬停在线段/多边形边上时高亮其两端点 */
  if (mode === 'perpseg' && pendingPts.length >= 1) {
    var cPosH = board.getCoordsTopLeftCorner(e);
    var absPosH = JXG.getPosition(e);
    perpSegHover(absPosH[0] - cPosH[0], absPosH[1] - cPosH[1]);
  }
  /* 中点工具：悬停在线段/多边形边上时高亮其两端点（点击即取该边中点） */
  if (mode === 'midpoint') {
    var cPosM2 = board.getCoordsTopLeftCorner(e);
    var absPosM2 = JXG.getPosition(e);
    midpointHover(absPosM2[0] - cPosM2[0], absPosM2[1] - cPosM2[1]);
  }
  /* 多边形工具：橡皮筋（末顶点到光标）跟手；拾取/删除顶点后由 app2 重建预览 */
  if (mode === 'polygon' && typeof polyPts !== 'undefined' && polyPts.length &&
      typeof updatePolyPreview === 'function') {
    updatePolyPreview(e);
  }
    if (mode !== 'select' && !(typeof READ_ONLY !== 'undefined' && READ_ONLY)) return;
  var cPos = board.getCoordsTopLeftCorner(e);
  var absPos = JXG.getPosition(e);
  var cx = absPos[0] - cPos[0], cy = absPos[1] - cPos[1];
  /* 手动整体平移（按中非点对象或选区内空白时）：按鼠标位移搬运所有可移动点 */
  if (moveSel) {
    var dxS = cx - moveSel.sx, dyS = cy - moveSel.sy;
    if (dxS !== 0 || dyS !== 0) {
      if (!moveSel.pushed) {
        /* 从按下点起 3px 内视为普通点击，不启动整体移动，避免点选时的手抖误触 */
        if (Math.hypot(cx - moveSel.ox, cy - moveSel.oy) < 3) return;
        moveSel.pushed = true;
        pushPreDragHistory(moveSel.pre);
      }
      /* 整体移动不做网格吸附：严格跟随鼠标刚性平移（单点原生拖拽仍保留吸附） */
      var mdx = dxS / board.unitX, mdy = -dyS / board.unitY;
      if (mdx !== 0 || mdy !== 0) {
        moveSel.movers.forEach(function (p) {
          try { p.moveTo([p.X() + mdx, p.Y() + mdy]); } catch (err2) {}
        });
      }
      moveSel.sx = cx; moveSel.sy = cy;
    }
    return;
  }
  var ps = panState || rightPan;
  if (!ps) return;
  var dx = cx - ps.sx, dy = cy - ps.sy;
  if (dx === 0 && dy === 0) return;
  ps.moved = true;   // 真平移过：松手时不再视为"点击空白"
  var bb = board.getBoundingBox();
  board.setBoundingBox([bb[0] - dx / board.unitX, bb[1] + dy / board.unitY,
                        bb[2] - dx / board.unitX, bb[3] + dy / board.unitY], true, 'update');
  ps.sx = cx; ps.sy = cy;
  if (ps === rightPan && !rightPan.moved &&
      Math.hypot(cx - rightPan.ox, cy - rightPan.oy) > 4) {
    /* 累计位移超过阈值：判定为平移而非右击，松手时抑制 contextmenu */
    rightPan.moved = true;
    suppressCtxOnce = true;
  }
});
/* 多选拖拽：主点被原生拖拽时，其他选中点镜像跟随同样的位移 */
board.on('update', function () {
  if (!multiDrag || multiDrag.mirroring) return;
  var dx = multiDrag.primary.X() - multiDrag.lx;
  var dy = multiDrag.primary.Y() - multiDrag.ly;
  if (dx === 0 && dy === 0) return;
  if (!multiDrag.pushed) {
    /* 首次真正移动时，把按下瞬间预存的快照入栈（精确回到拖拽前，支持撤销） */
    multiDrag.pushed = true;
    pushPreDragHistory(multiDrag.pre);
  }
  multiDrag.mirroring = true;
  try {
    multiDrag.others.forEach(function (p) {
      try { p.moveTo([p.X() + dx, p.Y() + dy]); } catch (e) {}
    });
  } finally {
    multiDrag.mirroring = false;
  }
  multiDrag.lx = multiDrag.primary.X();
  multiDrag.ly = multiDrag.primary.Y();
});
/* 单点拖拽松手时：若正贴在某条允许的曲线上，原地转为 glider 约束点；
 * 用 point.makeGlider 原地转换（保留 id/名称/下游依赖/样式/列表身份），
 * 拖动 + 约束合并为一步撤销（用按下时的快照）。返回是否执行了约束。 */
function maybeConstrainOnRelease(pt, pre) {
  candHighlightOff();   // 无论成败，松手都清除候选高亮
  var cv = pt && pt._snapCurve;
  if (pt) { try { pt._snapCurve = null; } catch (e) {} }
  if (!pt || !cv) return false;
  if (definesPoint(cv, pt) || curveDependsOn(cv, pt)) {
    try { setStatus('不能约束：这条' + curveLabel(cv) + '依赖于该点，约束会形成循环。', false); } catch (e) {}
    return false;
  }
  if (!canConstrainOn(pt, cv)) return false;
  try { pt.makeGlider(cv); } catch (e) { return false; }
  pt._defKind = 'glider';
  pt._onId = cv.id;
  if (cv._polyBorderOf) pt._polyEdge = cv._polyBorderOf;   // 约束在多边形边上：序列化/级联删除用
  try { applyGliderColor(pt); } catch (e) {}
  try { board.update(); } catch (e) {}
  /* 拖动 + 约束合并为一步撤销：用按下时的快照 */
  try { pushPreDragHistory(pre); } catch (e) {}
  try { refreshObjectList(); } catch (e) {}
  try { setStatus('已将点 ' + (pt.name || '') + ' 约束到' + curveLabel(cv) + '上，可沿线滑动；撤销可恢复为自由点。', true); } catch (e) {}
  return true;
}
board.on('up', function () {
  if (symMarquee) finishSymMarquee();
  if (marqueeState) finishMarquee();
  /* 选择模式空白处纯点击（按下松手无位移）：取消选择；Shift/Ctrl 按住则保留 */
  var blankClick = (mode === 'select' && panState && !panState.moved && !blankDownAddKey);
  panState = null;
  rightPan = null;
  /* JSXGraph 原生悬停高亮（浅蓝）清除：按中非点对象时我们关闭了原生拖拽，
   * mouseup 后它不会被清除，一直盖在选中色上；每次 mouseup 统一清掉。
   * 悬停时的浅蓝由 mouseover 重新给出，不受影响 */
  try {
    selectedObjs.forEach(function (o) { if (o && o.noHighlight) o.noHighlight(); });
    depSelected.forEach(function (o) { if (o && o.noHighlight) o.noHighlight(); });
  } catch (e) {}
  if (blankClick) {
    clearSelection();
    updateSelectHint();
    /* 属性面板激活时：从对象点到背景空白 → 面板同步切为背景属性 */
    var pp0 = document.getElementById('proppanel');
    if (pp0 && pp0.style.display === 'block' && !propBoardMode) openBoardPropPanel();
  }
  var moved = (multiDrag && multiDrag.pushed) || (moveSel && moveSel.pushed);
  /* 表达式文本拖动：真移动了把"按下时"快照入栈（与单点拖拽同一套撤销语义） */
  var textMoved = false;
  if (textDragPre) {
    try {
      var td = textDragPre.el;
      textMoved = !!td && board.objects[td.id] === td &&
        (td.X() !== textDragPre.x0 || td.Y() !== textDragPre.y0);
      if (textMoved) pushPreDragHistory(textDragPre.pre);
    } catch (e) { textMoved = false; }
    textDragPre = null;
  }
  /* 单点原生拖拽：真移动了才把"按下时"的快照入栈（multiDrag/moveSel 已记的不重复记） */
  var singleMoved = false;
  if (!moved && singleDrag) {
    try {
      var sp = singleDrag.point;
      singleMoved = !!sp && board.objects[sp.id] === sp &&
        (sp.X() !== singleDrag.x0 || sp.Y() !== singleDrag.y0);
    } catch (e) { singleMoved = false; }
    /* 拖点到线松手加约束：真移动过、且松手时正贴在允许的曲线上 → 原地转 glider；
     * 拖动+约束合并为一步撤销；未约束才按原逻辑记拖拽历史 */
    var constrained = false;
    if (singleMoved) {
      try { constrained = maybeConstrainOnRelease(singleDrag.point, singleDrag.pre); } catch (e) { constrained = false; }
    } else {
      candHighlightOff();
    }
    if (singleMoved && !constrained) pushPreDragHistory(singleDrag.pre);
  } else {
    candHighlightOff();
  }
  singleDrag = null;
  /* 有实质位移 → 刷一次对象列表，保证列表坐标与画板一致 */
  if (moved || singleMoved || textMoved) { try { refreshObjectList(); } catch (e) {} }
  /* 在已选对象上纯单击（无拖拽）→ 收拢为单选 */
  if (pendingSingleSel && !moved) selectSingle(pendingSingleSel);
  pendingSingleSel = null;
  multiDrag = null; moveSel = null;
});

var HINTS = {
  select:  '当前工具：选择 — 点击图形选中（Shift+点击多选）；空白处按住左键拖动平移视图；选中后在选区内按住拖动可整体移动；右键拖动也可平移视图；点击选区外空白取消选择。',
  marquee: '当前工具：框选 — 按住左键拖拽拉出虚线框，只有完全被框住的图形才会被选中（只框住一部分不算）；Shift/Ctrl+框选可追加到已有选择；按在已选中的对象上可直接整体移动。',
  point:   '当前工具：点 — 点击空白处新建点；点击已有点附近自动复用；点击两线交叉处自动生成联动交点；点击线/圆/圆弧上自动生成落在上面的约束点。',
  segment: '当前工具：线段 — 依次点击两个位置；点击已有点附近自动复用，点击两线交叉处自动生成联动交点。',
  vector:  '当前工具：向量 — 依次点击起点和终点（可复用已有点/交点），生成带箭头的向量；向量可用于点定义（属性面板写 P = A + k×v）与 Length(v) 表达式。',
  line:    '当前工具：直线 — 依次点击两个位置；点击已有点附近自动复用，点击两线交叉处自动生成联动交点。',
  ray:     '当前工具：射线 — 先点击起点、再点击方向点；点击已有点附近自动复用。',
  circle:  '当前工具：圆 — 先点圆心、再点圆上一点；点击已有点附近自动复用，点击两线交叉处自动生成联动交点。',
  circle3: '当前工具：三点圆 — 依次点击三个不共线的点（可复用已有点/交点），生成三点确定的圆。',
  arc:     '当前工具：圆弧 — 先点圆心，再依次点弧的起点和终点（可复用已有点/交点）。',
  arc3:    '当前工具：三点圆弧 — 依次点击三个不共线的点（可复用已有点/交点），生成三点外接圆上依次经过这三点的圆弧。',
  ellipse: '当前工具：椭圆 — 依次点击两个焦点，再点击椭圆上一点（可复用已有点/交点），生成以这两点为焦点的椭圆。',
  hyperbola: '当前工具：双曲线 — 依次点击两个焦点，再点击双曲线上一点（可复用已有点/交点），生成以这两点为焦点的双曲线。',
  parabola: '当前工具：抛物线 — 先点击焦点（可复用已有点/交点），再点击一条直线或线段作准线，生成抛物线。',
  conic:    '当前工具：五点二次曲线 — 依次点击五个点（可复用已有点/交点；任三点不共线），自动生成椭圆/双曲线/抛物线（类型自动判断）。',
  intersect: '当前工具：交点 — 依次点击两条直线/线段/圆，自动生成联动的交点（图形移动时交点跟着动）。',
  midpoint: '当前工具：中点 — 进入前若已选中一条线段则直接取其中点，已选中一个点则再选一个已有点即可；或点击一条线段/多边形边直接取其中点（悬停会高亮其两端点）；或依次点击两个已有点，生成联动中点（端点移动时跟着动；不新建点）。',
  incenter: '当前工具：内心 — 依次点击三个点，生成三角形内心（顶点移动时联动，缺省名 O）。',
  circumcenter: '当前工具：外心 — 依次点击三个点，生成三角形外心（顶点移动时联动，缺省名 O）。',
  orthocenter: '当前工具：垂心 — 依次点击三个点，生成三角形垂心（顶点移动时联动，缺省名 H）。',
  perpseg:  '当前工具：垂线段 — 先点击起点，再点击一条线段/多边形边（悬停会高亮其两端点，点击直接取两端为对边，不新建点；或依次点击对边两个点），生成该点到对边的垂线段；垂足若落在对边线段范围外，会自动连接垂足与对边两端点（拖动时联动）。',
  bisector: '当前工具：角平分线 — 依次点击三个点（第 2 点为角顶点），生成 ∠ABC 小于 180° 内角的角平分线射线（从顶点出发，顶点移动时联动）。',
  pline:   '当前工具：过点平行直线 — 先点击一点，再点击一条线段/直线/射线作参照。',
  pray:    '当前工具：过点平行射线 — 先点击一点（作起点），再点击一条线段/直线/射线作参照，沿参照点1→点2方向作射线。',
  pseg:    '当前工具：过点等长平行线段 — 先点击一点（作起点），再点击一条线段/直线/射线作参照，作与参照等长的平行线段。',
  psegfree:'当前工具：过点不等长平行线段 — 先点击一点，再点击参照线；生成后拖动远端端点可沿方向调整长度。',
  axsym:   '当前工具：轴对称 — 先点击一条直线/线段/射线作为对称轴。',
  axsym_pick: '已选对称轴 — 点选要对称的图形（可多选，再点取消）；按住拖拽可框选；双击空白处生成镜像；Esc 退出。',
  ctsym:   '当前工具：中心对称 — 先点击一个点作为对称中心。',
  ctsym_pick: '已选对称中心 — 点选要对称的图形（可多选，再点取消）；按住拖拽可框选；双击空白处生成镜像；Esc 退出。',
  rotate:  '当前工具：旋转 — 先点击一个点作为旋转中心（角度在工具栏右侧输入，逆时针为正）。',
  rotate_pick: '已选旋转中心 — 点选要旋转的图形（可多选，再点取消）；按住拖拽可框选；双击空白处生成；Esc 退出。',
  ngon:    '当前工具：正N边形 — 依次点击两个位置（可复用已有点/交点）；方式选"两点"时先点后一个相邻顶点（逆时针方向），选"中心+顶点"时先点中心、再点一个顶点；边数 N 在工具栏右侧输入。',
  polygon: '当前工具：多边形 — 逐个点击顶点（可复用已有点和交点）；点起点或双击结束。',
  mlen:    '当前工具：长度度量 — 点击一条线段、圆、圆弧或多边形，生成长度变量（L1、L2…，可在表达式文本中引用）。',
  mang:    '当前工具：角度度量 — 依次点击三个点（第 2 点为角顶点，可复用已有点/交点），生成角度变量（a1、a2…，单位度）；方向（≤180/逆时针/顺时针）在工具栏右侧选择。',
  mtext:   '当前工具：表达式文本 — 在工具栏右侧输入表达式（如 2*L1+a1/2），再点击空白处放置；表达式随度量/图形变化实时更新。',
  ptext:   '当前工具：文本框 — 点击空白处放置，弹出对话框输入文本；单击文本框选中（显示边框，可拖边框移动），双击直接编辑文字。',
  checkbox: '当前工具：复选框 — 点击空白处放置，弹出对话框输入标题；点击复选框切换勾选并执行脚本（脚本在属性面板中设置，api.value 为新状态）。',
  button:  '当前工具：按钮 — 点击空白处放置，弹出对话框输入标题；点击按钮执行脚本（脚本在属性面板中设置）。',
  adrive:  '当前工具：从动角 — 倍数 k 在工具栏右侧输入；依次点击：基准角三点（第 2 点为顶点）→ 目标顶点 → 目标角一条边上的点，生成从动点 D：∠边点·顶点·D = k × 基准角（单向从动）。'
};

/* ---------- 选择 / 吸附已有'点的支持 ---------- */
var flashed = [];         // 本次作图操作中被复用、临时高亮的已有点

function saveVis(o) {
  var b = {};
  ['strokeColor', 'fillColor', 'strokeWidth', 'size'].forEach(function (k) {
    try { b[k] = o.getAttribute(k); } catch (e) {}
  });
  return b;
}
/* 临时高亮一个对象（复用点用橙色；useSelectedColor 时用"选中"的红色，如多边形被相交的边） */
function flashOn(o, useSelectedColor) {
  if (o._flashBackup) return;
  o._flashBackup = saveVis(o);
  try {
    var c = useSelectedColor ? '#ff3b30' : '#ff9500';
    o.setAttribute({ strokeColor: c, fillColor: c });
    if (o.elementClass === JXG.OBJECT_CLASS_POINT) o.setAttribute({ size: 7 });
    else o.setAttribute({ strokeWidth: useSelectedColor ? 5 : 4 });
  } catch (e) {}
  flashed.push(o);
}
function clearFlashes() {
  flashed.forEach(function (o) {
    try { if (o._flashBackup) o.setAttribute(o._flashBackup); } catch (e) {}
    delete o._flashBackup;
  });
  flashed = [];
}
var selectedObjs = [];   // 选择工具当前选中的对象（可多选）
var depSelected = [];    // 依赖联动选中（紫色）：依赖选中对象的对象，跟随高亮但不进 selectedObjs
var pendingSingleSel = null;  // 在已选对象上按下（未加 Shift）：松开且无拖拽时收拢为单选
var multiDrag = null;  // 多选拖拽会话
var singleDrag = null;  // 单点原生拖拽：按下命中点时存"拖拽前"快照，up 时真移动了才入栈
var textDragPre = null;  // 表达式文本原生拖拽：同样按下时存快照，up 时真移动了入栈
function highlightOn(o) {
  o._selBackup = saveVis(o);
  /* 清掉 JSXGraph 原生悬停高亮（浅蓝）：按中非点对象时我们关闭了原生拖拽，
   * mouseup/mouseout 不会清除它，会一直盖在选中色上面；选中即用自有红色 */
  try { if (o.noHighlight) o.noHighlight(); } catch (e) {}
  try {
    /* 封闭复合对象（圆/圆弧/二次曲线/多边形等）选中只把边缘标红：
     * 不改填充色（否则整片覆盖区域标红）、不加粗描边（否则外圈像黑框）；
     * 线/点维持原来的加粗标红 */
    var closed = isClosedComposite(o);
    var attrs = { strokeColor: '#ff3b30' };
    if (!closed) attrs.fillColor = '#ff3b30';
    o.setAttribute(attrs);
    if (o.elementClass === JXG.OBJECT_CLASS_POINT) o.setAttribute({ size: 7 });
    else if (!closed) o.setAttribute({ strokeWidth: 5 });
  } catch (e) {}
}
/* 封闭复合对象：圆/圆弧/椭圆/双曲线/抛物线/二次曲线/扇形/多边形等
 * （elementClass 为 CURVE/CIRCLE/AREA）。这类对象高亮只标边缘，
 * 改填充色会糊满整片内部，加粗描边会像外框 */
function isClosedComposite(o) {
  return o && (o.elementClass === JXG.OBJECT_CLASS_CURVE ||
               o.elementClass === JXG.OBJECT_CLASS_CIRCLE ||
               o.elementClass === JXG.OBJECT_CLASS_AREA);
}
function highlightOff(o) {
  try { if (o._selBackup) o.setAttribute(o._selBackup); } catch (e) {}
  delete o._selBackup;
}
/* ---------- 依赖联动选中（紫色） ----------
 * 选中某对象时，把依赖它的对象一并联动选中，与主动选中（红）区分；
 * 紫色对象不属于 selectedObjs：不参与移动/属性面板，但删除主动选中会级联删掉它们。 */
var DEP_SEL_COLOR = '#af52de';
function isDepSelected(o) {
  for (var i = 0; i < depSelected.length; i++) if (depSelected[i].id === o.id) return true;
  return false;
}
function highlightDepOn(o) {
  o._depSelBackup = saveVis(o);
  try { if (o.noHighlight) o.noHighlight(); } catch (e) {}
  try {
    /* 与主动选中一致：封闭复合对象只标边缘，不改填充 */
    var closed = isClosedComposite(o);
    var attrs = { strokeColor: DEP_SEL_COLOR };
    if (!closed) attrs.fillColor = DEP_SEL_COLOR;
    o.setAttribute(attrs);
  } catch (e) {}
}
function highlightDepOff(o) {
  try { if (o._depSelBackup) o.setAttribute(o._depSelBackup); } catch (e) {}
  delete o._depSelBackup;
}
/* 双击约束点（蓝色 glider）：取消约束，原地还原为自由点。
 * 保留 id/名称/列表身份；序列化自动从 glider 步骤变回 point 步骤，可撤销。 */
function freeGliderPoint(pt) {
  if (!pt || pt._defKind !== 'glider') return false;
  pushHistory();
  try { pt.free(); } catch (e) { return false; }
  delete pt._defKind;
  delete pt._onId;
  delete pt._polyEdge;
  /* 颜色从约束蓝还原为自由点默认色 */
  try { pt.setAttribute({ strokeColor: STYLE_DEFAULTS.pointColor, fillColor: STYLE_DEFAULTS.pointColor }); } catch (e) {}
  try { board.update(); } catch (e) {}
  try { refreshObjectList(); } catch (e) {}
  try { recomputeDepSelection(); } catch (e) {}
  setStatus('已取消点 ' + (pt.name || '') + ' 的约束，现在是自由点（可撤销）。', true);
  return true;
}
/* 依据当前 selectedObjs 重算联动选中集（选中集变化的统一出口） */
function recomputeDepSelection() {
  depSelected.forEach(highlightDepOff);
  depSelected = [];
  if (selectedObjs.length) {
    var prim = {}, depMap = {};
    selectedObjs.forEach(function (o) { if (o) prim[o.id] = true; });
    selectedObjs.forEach(function (o) {
      if (!o || !board.objects[o.id]) return;
      var dd = collectDependents(o.id);
      Object.keys(dd).forEach(function (id) {
        if (!prim[id] && !depMap[id] && board.objects[id]) depMap[id] = true;
      });
    });
    Object.keys(depMap).forEach(function (id) {
      var o = board.objects[id];
      depSelected.push(o);
      highlightDepOn(o);
    });
  }
  syncListSelection();
}
/* ---------- 拖点贴线的候选高亮（橙色） ----------
 * 与选中红色互不干扰：曲线已处于选中态时保持红色、不改色；
 * 松手/拖离/切模式时恢复。 */
var dragCandCurve = null;   // 当前拖拽中贴住的候选曲线（松手即转为约束）
function candHighlightOn(o) {
  if (!o || dragCandCurve === o) return;
  candHighlightOff();
  dragCandCurve = o;
  if (o._selBackup || o._depSelBackup) return;   // 已处于选中（红/紫）：保持，不改色
  o._candBackup = saveVis(o);
  try {
    /* 与选中高亮一致：封闭复合对象只把边缘标橙，不改填充、不加粗 */
    var closed = isClosedComposite(o);
    var attrs2 = { strokeColor: '#ff9500' };
    if (!closed) attrs2.fillColor = '#ff9500';
    o.setAttribute(attrs2);
    if (o.elementClass !== JXG.OBJECT_CLASS_POINT && !closed) o.setAttribute({ strokeWidth: 5 });
  } catch (e) {}
}
function candHighlightOff() {
  var o = dragCandCurve; dragCandCurve = null;
  if (!o) return;
  try { if (o._candBackup) o.setAttribute(o._candBackup); } catch (e) {}
  try { delete o._candBackup; } catch (e) {}
}
/* ---------- 从动点颜色 ---------- */
/* 从动点（交点 / 中点 / 垂足 / 三角形中心 / 曲线约束点 / 对称点 / 平行线段远端）
   统一显示为灰色，自由点保持默认色；高亮/闪烁走 saveVis 备份恢复，不受影响 */
var DRIVEN_GRAY = '#8e8e93';
/* 约束在曲线上的点（glider）统一显示为蓝色，与自由点（橙）、完全从动点（灰）区分 */
var GLIDER_BLUE = '#0072B2';
function applyGliderColor(o) {
  try { o.setAttribute({ strokeColor: GLIDER_BLUE, fillColor: GLIDER_BLUE }); } catch (e) {}
}
function isDrivenPoint(o) {
  if (!o || o.elementClass !== JXG.OBJECT_CLASS_POINT) return false;
  if (o.elType === 'intersection') return true;
  var dk = o._defKind;
  /* 还有灵活度、未被完全确定的点不置灰：glider 可沿曲线滑动，
   * 不等长平行线段的远端（_free）可沿方向拉动 */
  if (dk === 'glider') return false;
  if (dk === 'parend' && o._free) return false;
  return dk === 'midpoint' || dk === 'footpoint' || dk === 'tricenter' ||
         dk === 'mirrorpt' || dk === 'parend' || dk === 'pfoot' ||
         dk === 'dilate' || dk === 'rotate' || dk === 'exprpoint' || dk === 'sidepick' || dk === 'vpoint' ||
         dk === 'ngonpt' || dk === 'angdrive';
}
function applyDrivenGray(o) {
  if (!isDrivenPoint(o)) return;
  /* 计算出来的点（完全确定的从动点）一律锁定：不可拖拽（parend 自由端/glider 不在此列） */
  try { o.setAttribute({ fixed: true, strokeColor: DRIVEN_GRAY, fillColor: DRIVEN_GRAY }); } catch (e) {}
}
function clearSelection() {
  selectedObjs.forEach(highlightOff);
  selectedObjs = [];
  recomputeDepSelection();
  syncListSelection();
}
function isSelected(o) {
  for (var i = 0; i < selectedObjs.length; i++) if (selectedObjs[i].id === o.id) return true;
  return false;
}
function selectSingle(o) {
  clearSelection();
  selectedObjs = [o];
  highlightOn(o);
  recomputeDepSelection();
  updateSelectHint();
  syncListSelection();
  syncPropPanelToSelection();
}
function toggleSelect(o) {
  var idx = -1;
  for (var i = 0; i < selectedObjs.length; i++) if (selectedObjs[i].id === o.id) { idx = i; break; }
  if (idx >= 0) { highlightOff(selectedObjs[idx]); selectedObjs.splice(idx, 1); }
  else { selectedObjs.push(o); highlightOn(o); }
  recomputeDepSelection();
  updateSelectHint();
  syncListSelection();
  syncPropPanelToSelection();
}
/* 属性面板跟随选择集：面板打开期间画板/列表里切换选中对象时，
 * 面板同步改显新对象（单选→单对象，多选→共同样式）；
 * 选择清空时保持当前目标（与 GeoGebra 一致）。 */
function syncPropPanelToSelection() {
  var p = document.getElementById('proppanel');
  if (!p || p.style.display !== 'block') return;
  var alive = selectedObjs.filter(function (o) { return o && board.objects[o.id]; });
  if (!alive.length) return;
  var cur = Array.isArray(propTarget) ? propTarget : (propTarget ? [propTarget] : []);
  var same = cur.length === alive.length && cur.every(function (o) {
    return alive.some(function (s) { return s.id === o.id; });
  });
  if (same) return;
  openPropPanel(alive.length === 1 ? alive[0] : alive);
}
/* 对象列表行选中态同步：画板上选中/取消时，仅切换行 class，不重排列表 */
function syncListSelection() {
  try {
    var box = document.getElementById('objlist');
    if (!box) return;
    var rows = box.querySelectorAll('.objrow');
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i].getAttribute('data-id');
      var o = id && board.objects[id];
      rows[i].classList.toggle('is-selected', !!(o && isSelected(o)));
      rows[i].classList.toggle('is-dep-selected', !!(o && !isSelected(o) && isDepSelected(o)));
    }
  } catch (e) {}
}
function updateSelectHint() {
  var el = document.getElementById('hint');
  var depTxt = depSelected.length ? '（含 ' + depSelected.length + ' 个依赖对象联动选中，紫色）' : '';
  if (selectedObjs.length === 0) el.textContent = HINTS.select;
  else if (selectedObjs.length === 1)
    el.textContent = '已选中：' + describeObj(selectedObjs[0]) + depTxt + '（Shift+点击可多选；点击空白处取消选择）';
  else
    el.textContent = '已选中 ' + selectedObjs.length + ' 个对象' + depTxt + '：拖动其中任意点可一起移动；Shift+点击增减选择；点击空白处取消选择。';
}
/* 兼容旧名单选入口 */
function selectObject(o) { selectSingle(o); }

/* 对象 o 是否以点 p 为定义点（含三点圆弧的 through 点） */
function definesPoint(o, p) {
  if (!o || !p) return false;
  if (o.id === p.id) return true;
  if (o._defKind === 'arc3' && o._arc3pts) return o._arc3pts.indexOf(p.id) >= 0;
  if (o.elType === 'polygon' && o.vertices) {
    for (var vi = 0; vi < o.vertices.length; vi++) if (o.vertices[vi].id === p.id) return true;
  }
  /* 三角形中心 / 角平分线：定义点只记在 _tcIds/_bisIds 里 */
  if (o._defKind === 'tricenter' && o._tcIds) return o._tcIds.indexOf(p.id) >= 0;
  if (o._defKind === 'bisector' && o._bisIds) return o._bisIds.indexOf(p.id) >= 0;
  if (o.parents) {
    for (var i = 0; i < o.parents.length; i++) {
      var par = o.parents[i];
      var pid = (par && par.id) ? par.id : par;
      if (pid === p.id) return true;
    }
  }
  return false;
}
/* 对象的直接依赖 id 列表：parents/顶点 + 各构造类型的显式依赖表 +
 * 函数点（dilate/rotate/exprpoint）的闭包依赖（_depIds） */
function directDepIds(o) {
  if (!o) return [];
  var ids = [], seen = {}, i, par;
  function push(id) { if (id && typeof id === 'string' && !seen[id]) { seen[id] = 1; ids.push(id); } }
  if (o.parents) for (i = 0; i < o.parents.length; i++) { par = o.parents[i]; push((par && par.id) ? par.id : par); }
  if (o.vertices) for (i = 0; i < o.vertices.length; i++) push(o.vertices[i].id);
  ['_arc3pts', '_tcIds', '_bisIds', '_psegIds', '_mirrorIds', '_parIds', '_perpIds', '_sideIds', '_depIds'].forEach(function (k) {
    if (o[k]) for (i = 0; i < o[k].length; i++) push(o[k][i]);
  });
  if (o._onId) push(o._onId);
  if (o._polyEdge) push(o._polyEdge.polyId);
  return ids;
}
/* o 是否（直接或间接）依赖 rootId 对应的对象。
 * 注意不能只看 ancestors：函数点（dilate/rotate/exprpoint/sidepick）靠闭包引用，
 * 没有 ancestors，必须走显式依赖表，否则拖点松手加约束会造出循环依赖。 */
function dependsOnId(o, rootId, visited) {
  if (!o || !rootId) return false;
  visited = visited || {};
  if (visited[o.id]) return false;
  visited[o.id] = true;
  var ids = directDepIds(o);
  for (var i = 0; i < ids.length; i++) {
    if (ids[i] === rootId) return true;
    if (dependsOnId(board.objects[ids[i]], rootId, visited)) return true;
  }
  return false;
}
function curveDependsOn(cv, pt) {
  return dependsOnId(cv, pt && pt.id);
}
/* 派生点类型：不参与"拖点松手加约束" */
var DERIVED_POINT_KINDS = { glider: 1, midpoint: 1, footpoint: 1, tricenter: 1, mirrorpt: 1, parend: 1, pfoot: 1 };
/* 该点此刻是否允许被约束到该曲线上（拖点松手加约束的前置检查） */
function canConstrainOn(pt, cv) {
  if (!pt || !cv) return false;
  if (!board.objects[pt.id] || !board.objects[cv.id]) return false;
  if (pt.elType !== 'point') return false;
  if (pt.elType === 'intersection') return false;
  if (pt._defKind && DERIVED_POINT_KINDS[pt._defKind]) return false;  // 含已是 glider：不重复转
  if (!pt.isDraggable) return false;   // 固定点 / 派生点不动
  if (definesPoint(cv, pt)) return false;        // 直接依赖：拒绝
  if (curveDependsOn(cv, pt)) return false;      // 间接依赖：拒绝（防依赖环）
  return true;
}

/* 多选集合中可整体平移的点：自由点；派生点（交点/中点/垂足）与约束点（glider）会自动跟随，不直接搬 */
function collectDragPoints() {
  var seen = {}, out = [];
  function add(p) {
    if (!p || p.elementClass !== JXG.OBJECT_CLASS_POINT || seen[p.id]) return;
    var dk = p._defKind;
    if (dk === 'intersection' || dk === 'midpoint' || dk === 'footpoint' || dk === 'tricenter') return;
    if (dk === 'glider' || dk === 'arc3center' || dk === 'perpline' || dk === 'parhelp' || dk === 'parend' || dk === 'bishelp' || dk === 'pfoot') return;
    try { if (p.getAttribute('fixed')) return; } catch (e) {}
    seen[p.id] = true; out.push(p);
  }
  selectedObjs.forEach(function (o) {
    if (o.elementClass === JXG.OBJECT_CLASS_POINT) { add(o); return; }
    /* 多边形的 parents 为空，顶点在 o.vertices 里（首顶点在末尾重复出现，去重由 add 处理） */
    var ids = (o._defKind === 'arc3' && o._arc3pts) ? o._arc3pts :
              (o.elType === 'polygon' && o.vertices) ? o.vertices : (o.parents || []);
    for (var i = 0; i < ids.length; i++) {
      var par = ids[i];
      var pid = (par && par.id) ? par.id : par;
      if (typeof pid === 'string') add(board.objects[pid]);
    }
  });
  return out;
}
var moveSel = null;  // 手动整体平移会话（按中非点对象或选区内空白时）
/* 选中对象在用户坐标系下的包围盒（圆把圆周也纳入），用于判断“选区内” */
function selectionExtent() {
  var xs = [], ys = [];
  function addPt(p) {
    if (p && p.elementClass === JXG.OBJECT_CLASS_POINT) {
      var px = p.X(), py = p.Y();
      if (isFinite(px) && isFinite(py)) { xs.push(px); ys.push(py); }
    }
  }
  function addIds(ids) {
    for (var i = 0; i < ids.length; i++) {
      var par = ids[i];
      var pid = (par && par.id) ? par.id : par;
      if (typeof pid === 'string') addPt(board.objects[pid]);
    }
  }
  selectedObjs.forEach(function (o) {
    if (!o) return;
    if (o.elementClass === JXG.OBJECT_CLASS_POINT) { addPt(o); return; }
    if (o._defKind === 'arc3' && o._arc3pts) addIds(o._arc3pts);
    else if (o.elType === 'polygon' && o.vertices) addIds(o.vertices);
    else if (o.parents) addIds(o.parents);
    if (o.elType === 'circle' || o.elType === 'circumcircle') {
      try {
        var cp0 = o.parents && o.parents[0];
        var cp = board.objects[(cp0 && cp0.id) || cp0];
        var r = (typeof o.Radius === 'function') ? o.Radius() : NaN;
        if (cp && isFinite(r)) { xs.push(cp.X() - r, cp.X() + r); ys.push(cp.Y() - r, cp.Y() + r); }
      } catch (e) {}
    }
  });
  if (!xs.length) return null;
  return { xmin: Math.min.apply(null, xs), ymin: Math.min.apply(null, ys),
           xmax: Math.max.apply(null, xs), ymax: Math.max.apply(null, ys) };
}
function inSelectionArea(x, y) {
  var ext = selectionExtent();
  if (!ext) return false;
  var pad = 16 / board.unitX;
  return x >= ext.xmin - pad && x <= ext.xmax + pad &&
         y >= ext.ymin - pad && y <= ext.ymax + pad;
}
/* 在选择模式下按下时，准备移动当前选择集：
 * - 按中可移动点 → 主点走原生拖拽，其他点在 board 'update' 里镜像跟随；
 * - 按中非点对象或选区内空白 → 手动模式，在 board 'move' 里按鼠标位移整体平移。 */
function startMoveSelection(sx, sy, ptHit) {
  multiDrag = null; moveSel = null;
  if (selectedObjs.length === 0) return;
  /* 不等长平行线段的自由端点：按住它直接拖就是沿方向调长度，走原生 glider 滑动，不进整体移动 */
  if (ptHit && ptHit._defKind === 'parend' && ptHit._free) return;
  var movers = collectDragPoints();
  if (movers.length === 0) return;
  var primary = null;
  if (ptHit) {
    for (var i = 0; i < movers.length; i++) {
      if (movers[i].id === ptHit.id) { primary = movers[i]; break; }
    }
  }
  if (primary) {
    if (movers.length < 2) return;  // 单个点走原生拖拽即可
    multiDrag = { primary: primary, lx: primary.X(), ly: primary.Y(),
                  others: movers.filter(function (p) { return p.id !== primary.id; }),
                  pushed: false, mirroring: false, pre: snapshotState() };
  } else {
    moveSel = { sx: sx, sy: sy, ox: sx, oy: sy,
                movers: movers, pushed: false, pre: snapshotState() };
  }
}
/* 把一次“按下瞬间”的快照作为历史入栈（供撤销回到拖拽前） */
function pushPreDragHistory(pre) {
  undoStack.push(pre);
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  _lastHistKey = JSON.stringify(pre.steps);
  updateUndoButtons();
}
function describeObj(o) {
  var name = o.name || o.id || '';
  if (o._measure) {
    return o._measure.kind === 'length'
      ? '长度 ' + name + ' = ' + ppNum(measureLenOf(board.objects[o._measure.of]))
      : '角度 ' + name + (o._measure.dir === 'ccw' ? '（逆时针）' : o._measure.dir === 'cw' ? '（顺时针）' : '') +
        ' = ' + ppNum(measureCarrierValue(o)) + '°';
  }
  if (o._isExprText) {
    var tv = NaN;
    try { tv = evalMsrExpr(o._exprText); } catch (e) {}
    return '文本 ' + name + '：' + o._exprText + ' = ' + (isFinite(tv) ? ppNum(tv) : '?');
  }
  if (o._defKind === 'angdrive')
    return '从动点 ' + name + '：∠' + (board.objects[o._adSide] || {}).name + (board.objects[o._adVertex] || {}).name +
           name + ' = ' + ppNum(o._adK) + ' × ∠' + (o._adSrcName || '?');
  if (o.elementClass === JXG.OBJECT_CLASS_POINT) {
    var extra = '';
    if (o._defKind === 'glider') {
      if (o._polyEdge) {
        var pePoly0 = board.objects[o._polyEdge.polyId];
        extra = '，在多边形 ' + (pePoly0 ? pePoly0.name : '?') + ' 的边' + (o._polyEdge.edgeIdx + 1) + '上';
      } else if (o._onId && board.objects[o._onId]) {
        extra = '，在' + curveLabel(board.objects[o._onId]) + ' ' + board.objects[o._onId].name + '上';
      }
    }
    return '点 ' + name + '（' + o.X().toFixed(2) + ', ' + o.Y().toFixed(2) + extra + '）';
  }
  var label = { segment: '线段', line: '直线', circle: '圆', circumcircle: '三点圆', polygon: '多边形', intersection: '交点', arc: '圆弧' }[o.elType] || o.elType || '图形';
  if (o._defKind === 'ray') label = '射线';
  if (o._defKind === 'bisector') label = '角平分线';
  if (o._defKind === 'arc') label = '圆弧';
  if (o._defKind === 'arc3') label = '三点圆弧';
  if (o._defKind === 'conic') label = '二次曲线';
  return label + ' ' + name;
}
/* 在屏幕坐标 (sx, sy) 附近找已有点，tol 为像素容差 */
function findPointNear(sx, sy, tol) {
  tol = tol || 14;
  for (var i = 0; i < createdIds.length; i++) {
    var o = board.objects[createdIds[i]];
    if (o && o.elementClass === JXG.OBJECT_CLASS_POINT && !o._measure && o.coords && o.coords.scrCoords) {
      var dx = o.coords.scrCoords[1] - sx, dy = o.coords.scrCoords[2] - sy;
      if (dx * dx + dy * dy <= tol * tol) return o;
    }
  }
  return null;
}
/* 在屏幕坐标 (sx, sy) 处找任意用户图形（从顶层向下；点优先命中，小目标优先） */
/* 射线法判断用户坐标点 (x, y) 是否落在多边形内部 */
function pointInPolygon(poly, x, y) {
  var vs = poly.vertices || [], n = vs.length;
  if (n < 3) return false;
  var inside = false;
  for (var i = 0, j = n - 1; i < n; j = i++) {
    var xi = vs[i].X(), yi = vs[i].Y(), xj = vs[j].X(), yj = vs[j].Y();
    if (!isFinite(xi) || !isFinite(yi) || !isFinite(xj) || !isFinite(yj)) return false;
    if ((yi > y) !== (yj > y)) {
      var xinters = (xj - xi) * (y - yi) / (yj - yi) + xi;
      if (x < xinters) inside = !inside;
    }
  }
  return inside;
}
/* 在用户坐标 (x, y) 处找内部包含该点的多边形（顶层优先）。
 * JSXGraph 多边形的 hasPoint 只认边不认内部，这里补上内部命中，供点选/删除用。 */
function findPolygonInteriorAt(x, y) {
  for (var i = createdIds.length - 1; i >= 0; i--) {
    var o = board.objects[createdIds[i]];
    if (!o || o.elType !== 'polygon') continue;
    try { if (o.visProp && o.visProp.visible === false) continue; } catch (e) {}
    if (pointInPolygon(o, x, y)) return o;
  }
  return null;
}
function findObjectAt(sx, sy, x, y) {
  var i, o;
  for (i = createdIds.length - 1; i >= 0; i--) {
    o = board.objects[createdIds[i]];
    if (o && o._defKind !== 'perpline' && !o._measure && o.elementClass === JXG.OBJECT_CLASS_POINT && o.hasPoint && o.hasPoint(sx, sy)) return o;
  }
  for (i = createdIds.length - 1; i >= 0; i--) {
    o = board.objects[createdIds[i]];
    if (o && o._defKind !== 'perpline' && o.elementClass !== JXG.OBJECT_CLASS_POINT && o.hasPoint && o.hasPoint(sx, sy)) return o;
  }
  /* 多边形内部：点和边都没命中时再看是否落在某个多边形内部 */
  if (x !== undefined && y !== undefined) return findPolygonInteriorAt(x, y);
  return null;
}
/* 取点：优先复用附近已有点（橙色高亮），其次在两线交叉处生成联动交点，否则新建 */
function pickOrCreatePoint(x, y, sx, sy) {
  var p = findPointNear(sx, sy);
  if (p) { flashOn(p); return { point: p, reused: true }; }
  var hit = findIntersectionNear(sx, sy);
  if (hit) {
    var live = adoptIntersection(hit);
    return { point: live, reused: true, isIntersection: true };
  }
  /* 点落在某条曲线/圆/圆弧上 → 生成约束在该对象上的点（拖动时沿对象滑动）。
   * 用与拖点贴线一致的 SNAP_CURVE_PX，避免稍微靠近就意外变成约束点 */
  var cv = findCurveAt(sx, sy, SNAP_CURVE_PX);
  if (cv) {
    var g = null;
    try { g = board.create('glider', [x, y, cv], { name: nextId('P') }); } catch (e) { g = null; }
    if (g) {
      g._defKind = 'glider';
      g._onId = cv.id;
      if (cv._polyBorderOf) g._polyEdge = cv._polyBorderOf;   // 落在多边形边上的约束点
      applyGliderColor(g);
      trackId(g.id);
      return { point: g, reused: false, isGlider: true, gliderOn: cv };
    }
  }
  var np = board.create('point', [x, y], { name: nextId('P') });
  trackId(np.id);
  return { point: np, reused: false };
}
/* 收集依赖 rootId 的所有对象（含间接依赖），用于级联删除 */
function collectDependents(rootId) {
  var doomed = {};
  doomed[rootId] = true;
  var changed = true;
  while (changed) {
    changed = false;
    createdIds.forEach(function (id) {
      if (doomed[id]) return;
      var o = board.objects[id];
      if (!o) return;
      if (o.ancestors) {
        for (var aid in o.ancestors) {
          if (doomed[aid]) { doomed[id] = true; changed = true; break; }
        }
        if (doomed[id]) return;
      }
      /* 三点圆弧：中间点 B 只在闭包和 _arc3pts 里引用，ancestors 覆盖不到，需显式检查 */
      if (o._defKind === 'arc3' && o._arc3pts) {
        for (var i = 0; i < o._arc3pts.length; i++) {
          if (doomed[o._arc3pts[i]]) { doomed[id] = true; changed = true; break; }
        }
      }
      /* 椭圆/双曲线：焦点/曲线上点记在 _conicIds 里，显式检查 */
      if (o._conicIds) {
        for (var ci = 0; ci < o._conicIds.length; ci++) {
          if (doomed[o._conicIds[ci]]) { doomed[id] = true; changed = true; break; }
        }
      }
      /* 多边形边上的交点：边不是独立登记对象，ancestors 覆盖不到多边形，需显式检查 */
      if (o._polyEdge && doomed[o._polyEdge.polyId]) { doomed[id] = true; changed = true; }
      /* 过点平行线：隐藏方向点未登记，ancestors 覆盖不到过点/参照线，需显式检查 */
      if (o._parIds) {
        for (var pi = 0; pi < o._parIds.length; pi++) {
          if (doomed[o._parIds[pi]]) { doomed[id] = true; changed = true; break; }
        }
      }
      /* 对称镜像点：显式依赖原点与对称轴/对称中心（闭包里的引用 ancestors 覆盖不到） */
      if (o._mirrorIds) {
        for (var mi = 0; mi < o._mirrorIds.length; mi++) {
          if (doomed[o._mirrorIds[mi]]) { doomed[id] = true; changed = true; break; }
        }
      }
      /* side 约束交点：候选交点未登记、函数坐标无 ancestors，显式依赖 e1/e2/参照线端点/参照点 */
      if (o._defKind === 'sidepick' && o._sideIds) {
        for (var sp = 0; sp < o._sideIds.length; sp++) {
          if (doomed[o._sideIds[sp]]) { doomed[id] = true; changed = true; break; }
        }
      }
      /* 函数点（rotate/dilate/exprpoint/正N边形派生顶点/隐藏中心等）：
       * 闭包里的引用 ancestors 覆盖不到，按显式 _depIds 级联 */
      if (o._depIds) {
        for (var fi = 0; fi < o._depIds.length; fi++) {
          if (doomed[o._depIds[fi]]) { doomed[id] = true; changed = true; break; }
        }
      }
      /* 三角形中心 / 角平分线：定义点只在闭包和 _tcIds/_bisIds 里引用，ancestors 覆盖不到，需显式检查 */
      var depIds = (o._defKind === 'tricenter') ? o._tcIds : ((o._defKind === 'bisector') ? o._bisIds : ((o._defKind === 'perpseg') ? o._psegIds : null));
      if (depIds) {
        for (var di = 0; di < depIds.length; di++) {
          if (doomed[depIds[di]]) { doomed[id] = true; changed = true; break; }
        }
      }
    });
  }
  return doomed;
}

/* ---------- 交点：线线 / 线圆 / 圆圆 ---------- */
function isCurve(o) {
  return o && (o.elType === 'segment' || o.elType === 'line' ||
               o.elType === 'circle' || o.elType === 'circumcircle' ||
               o.elType === 'arc' || isConicEl(o));
}
function curveLabel(o) {
  if (o._polyBorderOf) return '多边形边';
  if (o._defKind === 'ray') return '射线';
  if (o._defKind === 'bisector') return '角平分线';
  if (o._defKind === 'arc3') return '三点圆弧';
  if (o._defKind === 'arc' || o.elType === 'arc') return '圆弧';
  if (o._defKind === 'conic') return '二次曲线';
  if (o._defKind === 'ellipse') return '椭圆';
  if (o._defKind === 'hyperbola') return '双曲线';
  if (o._defKind === 'parabola') return '抛物线';
  return { segment: '线段', line: '直线', circle: '圆', circumcircle: '圆' }[o.elType] || '线';
}
/* 用户坐标 → 屏幕像素 */
function toScreenPx(x, y) {
  return [board.origin.scrCoords[1] + x * board.unitX,
          board.origin.scrCoords[2] - y * board.unitY];
}
/* 屏幕像素距离：点 (sx,sy) 到线段 AB（A/B 为屏幕坐标 [x,y]） */
function segDistPx(A, B, sx, sy) {
  var vx = B[0] - A[0], vy = B[1] - A[1];
  var L2 = vx * vx + vy * vy;
  if (L2 < 1e-9) return Math.hypot(sx - A[0], sy - A[1]);
  var t = ((sx - A[0]) * vx + (sy - A[1]) * vy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(sx - (A[0] + t * vx), sy - (A[1] + t * vy));
}
/* 多边形某条边（有限线段）到屏幕点的距离，用于交点粗筛 */
function edgeDistPx(bd, sx, sy) {
  if (!bd || !bd.point1 || !bd.point2) return Infinity;
  var A = toScreenPx(bd.point1.X(), bd.point1.Y()),
      B = toScreenPx(bd.point2.X(), bd.point2.Y());
  return segDistPx(A, B, sx, sy);
}
/* 圆/圆弧的圆心（点对象） */
function symCircleCenter(o) {
  if (o.center && typeof o.center.X === 'function') return o.center;
  if (o.parents && o.parents[0]) {
    var p0 = o.parents[0];
    var c = (p0 && p0.id) ? board.objects[p0.id] : p0;
    if (c && typeof c.X === 'function') return c;
  }
  return null;
}
/* 屏幕像素距离：点 (sx, sy) 到曲线 o 的距离。描点（glider）/交点工具找曲线用。
 * 不用原生 hasPoint：它的容差太小（约4px），触屏/鼠标很难点中；
 * 这里用与找点一致的 14px，保证点中线（直线/线段/射线）或圆/圆弧时能生成落在对象上的约束点。 */
function distToCurvePx(o, sx, sy) {
  var et = o.elType;
  if (isConicEl(o)) {
    /* 与 projectPointToCurve 一致：JSXGraph 数值投影，失败回退采样 */
    try {
      var uc3 = new JXG.Coords(JXG.COORDS_BY_SCREEN, [sx, sy], board).usrCoords;
      var pr3 = JXG.Math.Geometry.projectCoordsToCurve(uc3[1], uc3[2], 0, o, board);
      if (pr3 && pr3[0] && isFinite(pr3[0].usrCoords[1]) && isFinite(pr3[0].usrCoords[2])) {
        var ps3 = toScreenPx(pr3[0].usrCoords[1], pr3[0].usrCoords[2]);
        return Math.hypot(ps3[0] - sx, ps3[1] - sy);
      }
    } catch (e3) {}
    var smp3 = conicSamplePoints(o), bd3 = Infinity;
    for (var si3 = 0; si3 < smp3.length; si3++) {
      var sp3 = toScreenPx(smp3[si3][0], smp3[si3][1]);
      var dd3 = Math.hypot(sp3[0] - sx, sp3[1] - sy);
      if (dd3 < bd3) bd3 = dd3;
    }
    return bd3;
  }
  if (et === 'segment' || et === 'line') {
    if (!o.point1 || !o.point2) return Infinity;
    var A = toScreenPx(o.point1.X(), o.point1.Y()), B = toScreenPx(o.point2.X(), o.point2.Y());
    if (et === 'segment') return segDistPx(A, B, sx, sy);
    /* 直线/射线：按无限直线算 */
    var vx = B[0] - A[0], vy = B[1] - A[1];
    var L2 = vx * vx + vy * vy;
    if (L2 < 1e-9) return Math.hypot(sx - A[0], sy - A[1]);
    return Math.abs((sx - A[0]) * vy - (sy - A[1]) * vx) / Math.sqrt(L2);
  }
  if (et === 'circle' || et === 'circumcircle' || et === 'arc') {
    var c = symCircleCenter(o);
    var r = NaN;
    try { r = (typeof o.Radius === 'function') ? o.Radius() : NaN; } catch (e) {}
    if (!c || !isFinite(r)) return Infinity;
    var C = toScreenPx(c.X(), c.Y());
    var rp = Math.abs(r) * (board.unitX + board.unitY) / 2;
    return Math.abs(Math.hypot(sx - C[0], sy - C[1]) - rp);
  }
  return Infinity;
}
/* 在屏幕坐标 (sx, sy) 处找一条曲线（直线/线段/圆/圆弧）：取 tol（默认 12）屏幕像素内最近的一条；
 * 描点建约束点/拖点贴线用更严格的 SNAP_CURVE_PX，点选已有曲线工具用默认容差 */
function findCurveAt(sx, sy, tol) {
  tol = tol || 12;
  var best = null, bestD = Infinity;
  forEachSnapCurve(function (o) {
    var d = distToCurvePx(o, sx, sy);
    if (d <= tol && d < bestD) { best = o; bestD = d; }
  });
  return best;
}
/* 遍历可作为贴线/约束目标的曲线：登记的曲线 + 多边形的各条边（边未登记进 createdIds）。
 * 多边形的边带 _polyBorderOf = {polyId, edgeIdx}，供约束序列化与级联删除定位。 */
function forEachSnapCurve(fn) {
  for (var i = createdIds.length - 1; i >= 0; i--) {
    var o = board.objects[createdIds[i]];
    if (!o) continue;
    if (o._defKind !== 'perpline' && isCurve(o)) { fn(o); continue; }
    if (o.elType === 'polygon' && o.borders) {
      for (var bi = 0; bi < o.borders.length; bi++) {
        var bd = o.borders[bi];
        if (!bd) continue;
        if (!bd._polyBorderOf) bd._polyBorderOf = { polyId: o.id, edgeIdx: bi };
        fn(bd);
      }
    }
  }
}
/*
 * 计算两条曲线的交点。
 * 用临时不可见元素试算 idx=0/1，保留坐标有效的（交点落在线段外时 JSXGraph 会给出 NaN，自动舍去）。
 * 返回有实交点的元素数组（调用者负责命名/显示或删除）。
 */
function computeIntersections(o1, o2) {
  var res = [];
  for (var idx = 0; idx < 2; idx++) {
    var ip = null;
    try {
      ip = board.create('intersection', [o1, o2, idx], { visible: false });
    } catch (e) { ip = null; }
    if (ip && ip.coords && isFinite(ip.coords.usrCoords[1]) && isFinite(ip.coords.usrCoords[2])) {
      var dup = res.some(function (q) {
        return Math.abs(q.coords.usrCoords[1] - ip.coords.usrCoords[1]) < 1e-9 &&
               Math.abs(q.coords.usrCoords[2] - ip.coords.usrCoords[2]) < 1e-9;
      });
      if (!dup) { ip._interIdx = idx; res.push(ip); }
      else { try { board.removeObject(ip); } catch (e) {} }
    } else if (ip) {
      try { board.removeObject(ip); } catch (e) {}
    }
  }
  return res;
}
function dropTemps(list) {
  list.forEach(function (ip) { try { board.removeObject(ip); } catch (e) {} });
}
/* 作图过程中复用/新建点的提示后缀 */
function reuseLabel(r) {
  if (r.isIntersection) return '（生成联动交点）';
  if (r.isGlider) return '（约束在' + curveLabel(r.gliderOn) + '上）';
  if (r.reused) return '（复用已有点）';
  return '（新建）';
}
/* 把一个临时交点转正：命名、显示、登记 */
function adoptIntersection(ip) {
  try { ip.setName(nextId('X')); } catch (e) {}
  try { ip.setAttribute({ visible: true }); } catch (e) {}
  ip._interIndex = (ip._interIdx !== undefined) ? ip._interIdx : 0;  // 序列化用
  applyDrivenGray(ip);
  /* 交点若落在多边形的某条边上，记下归属（多边形 id + 边序号），供序列化/级联删除用 */
  var pa = ip.parents || [];
  for (var i = 0; i < pa.length; i++) {
    var cand = (pa[i] && pa[i].id) ? pa[i] : board.objects[pa[i]];
    if (cand && cand._polyId !== undefined && cand._edgeIdx !== undefined) {
      ip._polyEdge = { polyId: cand._polyId, edgeIdx: cand._edgeIdx };
      break;
    }
  }
  trackId(ip.id);
  flashOn(ip);
  /* 把参与相交的那条边高亮成"选中"的颜色，其余边不变 */
  if (ip._polyEdge) {
    var poly = board.objects[ip._polyEdge.polyId];
    var bd = poly && poly.borders && poly.borders[ip._polyEdge.edgeIdx];
    if (bd) flashOn(bd, true);
  }
  return ip;
}
/* ---------- 过点平行线工具组（平行直线 / 平行射线 / 等长/不等长平行线段） ---------- */
function resetParallel() {
  pendingParPoint = null;
  pendingParRef = null;
  clearFlashes();
}
/* 对称工具的状态重置（Esc / 切换工具时调用） */
function resetSym() {
  symAxis = null;
  symPending = [];
  cancelSymMarquee();
  clearFlashes();
  updateSymHint();
}

/* ============================================================
 * 对称工具：轴对称 / 中心对称（多选）
 * 流程：先选对称轴（直线/线段/射线）或对称中心（点）→ 点选/框选多个图形 → 双击空白处生成镜像。
 * 镜像点是联动的（原点/轴移动时跟着动）；镜像曲线/多边形由镜像点构造，一次生成只记一条撤销。
 * ============================================================ */

/* 取消单个对象的高亮（多选时逐个移出用） */
function unflashOne(o) {
  var i = flashed.indexOf(o);
  if (i >= 0) flashed.splice(i, 1);
  try { if (o._flashBackup) o.setAttribute(o._flashBackup); } catch (e) {}
  delete o._flashBackup;
}

/* 取消进行中的框选 */
function cancelSymMarquee() {
  if (symMarquee && symMarquee.div && symMarquee.div.parentNode)
    symMarquee.div.parentNode.removeChild(symMarquee.div);
  symMarquee = null;
}

/* 对称工具的提示行 */
function updateSymHint() {
  var el = document.getElementById('hint');
  if (!el || (mode !== 'axsym' && mode !== 'ctsym' && mode !== 'rotate')) return;
  if (!symAxis) { el.textContent = HINTS[mode]; return; }
  el.textContent = HINTS[mode + '_pick'] + '（已选 ' + symPending.length + ' 个）';
}

/* 用户坐标点是否在多边形内（射线法，用户坐标系） */
function pointInPolyUser(px, py, verts) {
  var inside = false, n = verts.length;
  for (var i = 0, j = n - 1; i < n; j = i++) {
    var xi = verts[i].X(), yi = verts[i].Y(), xj = verts[j].X(), yj = verts[j].Y();
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* 对象 o 的"定义点"：镜像构造与框选命中都用它。
 * 点→自身；三点圆弧→三个定义点；多边形→顶点；其余→parents（含圆心/端点/弧的起终点） */
function symBasePoints(o) {
  var pts = [];
  function addP(p) {
    var po = (p && p.id) ? (board.objects[p.id] || p) : p;
    if (po && po.elementClass === JXG.OBJECT_CLASS_POINT && pts.indexOf(po) < 0) pts.push(po);
  }
  if (!o) return pts;
  if (o.elementClass === JXG.OBJECT_CLASS_POINT) { addP(o); return pts; }
  if (o._defKind === 'arc3' && o._arc3pts) {
    o._arc3pts.forEach(function (pid) { addP(board.objects[pid]); });
    return pts;
  }
  if (o.elType === 'polygon') {
    var vs = o.vertices || [];
    for (var vi = 0; vi < vs.length; vi++) addP(vs[vi]);
    if (pts.length) return pts;
  }
  if (o.parents && o.parents.length) {
    for (var i = 0; i < o.parents.length; i++) addP(o.parents[i]);
    if (pts.length) return pts;
  }
  if (o.point1) addP(o.point1);
  if (o.point2) addP(o.point2);
  if (o.point3) addP(o.point3);
  return pts;
}

/* 对称拾取：在 (sx, sy) 处找可对称的目标对象（点优先，其次最近曲线/多边形），14px 容差 */
function findSymTarget(sx, sy) {
  var tol = 14;
  var p = findPointNear(sx, sy, tol);
  if (p) return p;
  var best = null, bestD = Infinity;
  for (var i = createdIds.length - 1; i >= 0; i--) {
    var o = board.objects[createdIds[i]];
    if (!o || o._defKind === 'perpline') continue;
    if (o.elementClass === JXG.OBJECT_CLASS_POINT) continue;  // 点已由 findPointNear 处理
    var d = Infinity;
    if (o.elType === 'polygon' && o.vertices && o.vertices.length) {
      var vs = o.vertices, n = vs.length;
      var ux = (sx - board.origin.scrCoords[1]) / board.unitX;
      var uy = (board.origin.scrCoords[2] - sy) / board.unitY;
      if (pointInPolyUser(ux, uy, vs)) d = 0;
      else {
        for (var k = 0; k < n; k++) {
          var A = toScreenPx(vs[k].X(), vs[k].Y()), B = toScreenPx(vs[(k + 1) % n].X(), vs[(k + 1) % n].Y());
          d = Math.min(d, segDistPx(A, B, sx, sy));
        }
      }
    } else {
      d = distToCurvePx(o, sx, sy);
    }
    if (d <= tol && d < bestD) { best = o; bestD = d; }
  }
  return best;
}

/* 矩形（用户坐标）是否命中对象 o：定义点在框内 / 直线穿过框 / 圆与框相交 / 框心在多边形内 */
/* 对称/框选命中规则：只有被选框完全包含的图形才算命中（只框住一部分不算）。
 * 与独立框选工具共用 rectContainsObject。 */
function symHitsRect(o, ux0, uy0, ux1, uy1) {
  if (!o || o._defKind === 'perpline' || (symAxis && o.id === symAxis.id)) return false;
  return rectContainsObject(o, ux0, uy0, ux1, uy1);
}

/* 切换待对称对象的选中状态 */
function toggleSymPending(o) {
  if (!o) return;
  if (symAxis && o.id === symAxis.id) { setStatus('不能对对称轴/对称中心自身作对称。', false); return; }
  var idx = symPending.indexOf(o.id);
  if (idx >= 0) {
    symPending.splice(idx, 1);
    unflashOne(o);
    setStatus('已移出 ' + describeObj(o) + '（还剩 ' + symPending.length + ' 个）。', true);
  } else {
    symPending.push(o.id);
    flashOn(o);
    setStatus('已选 ' + describeObj(o) + '（共 ' + symPending.length + ' 个），双击空白处生成镜像。', true);
  }
  updateSymHint();
}

/* 开始框选 */
function startSymMarquee(sx, sy) {
  var box = document.getElementById('jxgbox');
  var div = document.createElement('div');
  div.id = 'symmarquee';
  box.appendChild(div);
  symMarquee = { x0: sx, y0: sy, x1: sx, y1: sy, div: div };
  updateSymMarqueeDiv();
}

/* 更新框选矩形的位置 */
function updateSymMarqueeDiv() {
  if (!symMarquee || !symMarquee.div) return;
  var d = symMarquee.div;
  var l = Math.min(symMarquee.x0, symMarquee.x1), t = Math.min(symMarquee.y0, symMarquee.y1);
  var w = Math.abs(symMarquee.x1 - symMarquee.x0), h = Math.abs(symMarquee.y1 - symMarquee.y0);
  d.style.left = l + 'px'; d.style.top = t + 'px';
  d.style.width = w + 'px'; d.style.height = h + 'px';
}

/* 结束框选：把框住的对象加入待对称集合 */
function finishSymMarquee() {
  var mq = symMarquee;
  symMarquee = null;
  if (mq && mq.div && mq.div.parentNode) mq.div.parentNode.removeChild(mq.div);
  if (!mq || !symAxis) return;
  var dx = Math.abs(mq.x1 - mq.x0), dy = Math.abs(mq.y1 - mq.y0);
  if (dx < 4 && dy < 4) return;  // 纯点击，不算框选
  var ux0 = (Math.min(mq.x0, mq.x1) - board.origin.scrCoords[1]) / board.unitX;
  var ux1 = (Math.max(mq.x0, mq.x1) - board.origin.scrCoords[1]) / board.unitX;
  var uy1 = (board.origin.scrCoords[2] - Math.min(mq.y0, mq.y1)) / board.unitY;
  var uy0 = (board.origin.scrCoords[2] - Math.max(mq.y0, mq.y1)) / board.unitY;
  var added = 0;
  for (var i = 0; i < createdIds.length; i++) {
    var o = board.objects[createdIds[i]];
    if (!o || symPending.indexOf(o.id) >= 0) continue;
    if (symHitsRect(o, ux0, uy0, ux1, uy1)) {
      symPending.push(o.id);
      flashOn(o);
      added++;
    }
  }
  if (added > 0) setStatus('框选加入 ' + added + ' 个对象（共 ' + symPending.length + ' 个），双击空白处生成镜像。', true);
  updateSymHint();
}

/* ---------- 选择模式：空白左键拉框多选（视图平移移到右键拖动） ---------- */
/* 框选命中规则：只有被选框完全包含的图形才算选中（只框住一部分不算）。
 * 点：点在框内；圆/外接圆：整圆的外接方框在框内；
 * 线段/多边形/圆弧等：全部定义点都在框内。 */
function rectContainsObject(o, ux0, uy0, ux1, uy1) {
  if (!o) return false;
  var inside = function (x, y) { return x >= ux0 && x <= ux1 && y >= uy0 && y <= uy1; };
  var pts = (typeof symBasePoints === 'function') ? symBasePoints(o) : [];
  var i, p;
  if (o.elementClass === JXG.OBJECT_CLASS_POINT) {
    return pts.length > 0 && inside(pts[0].X(), pts[0].Y());
  }
  if (o.elType === 'circle' || o.elType === 'circumcircle') {
    var cc = (typeof symCircleCenter === 'function') ? symCircleCenter(o) : (pts[0] || null);
    var r = NaN;
    try { r = (typeof o.Radius === 'function') ? o.Radius() : NaN; } catch (e) {}
    if (cc && isFinite(r) && r >= 0) {
      return (cc.X() - r) >= ux0 && (cc.X() + r) <= ux1 &&
             (cc.Y() - r) >= uy0 && (cc.Y() + r) <= uy1;
    }
    /* 取不到圆心/半径时退化为定义点全包含 */
  }
  /* 圆弧：沿实际绘制的弧段采样（约 5° 一段），整段都在框内才算选中；
   * 圆心只是定义点，不要求入框（劣弧的圆心常落在弧的包围框之外）。 */
  if (o.elType === 'arc') {
    var ac = (typeof symCircleCenter === 'function') ? symCircleCenter(o) : null;
    var par = o.parents || [];
    var ast = null, aen = null;
    for (i = 0; i < par.length; i++) {
      var pp = (par[i] && par[i].id) ? board.objects[par[i].id] : par[i];
      if (!pp || pp === ac || typeof pp.X !== 'function') continue;
      if (!ast) ast = pp; else if (!aen) aen = pp;
    }
    var ar = NaN;
    try { ar = (typeof o.Radius === 'function') ? o.Radius() : NaN; } catch (e) {}
    if (ac && ast && aen && isFinite(ar)) {
      var t1 = Math.atan2(ast.Y() - ac.Y(), ast.X() - ac.X());
      var t2 = Math.atan2(aen.Y() - ac.Y(), aen.X() - ac.X());
      var span = t2 - t1;
      while (span <= 1e-9) span += Math.PI * 2;   /* JSXGraph 圆弧从起点逆时针扫到终点 */
      span = Math.min(span, Math.PI * 2);
      var segN = Math.max(8, Math.ceil(span / (Math.PI / 36)));
      for (i = 0; i <= segN; i++) {
        var ang = t1 + span * (i / segN);
        if (!inside(ac.X() + ar * Math.cos(ang), ac.Y() + ar * Math.sin(ang))) return false;
      }
      return true;
    }
    /* 取不到圆心/端点时退化为定义点全包含 */
  }
  if (!pts.length) return false;
  for (i = 0; i < pts.length; i++) {
    p = pts[i];
    if (!inside(p.X(), p.Y())) return false;
  }
  return true;
}
function startMarquee(sx, sy, addKey) {
  var box = document.getElementById('jxgbox');
  var div = document.createElement('div');
  div.id = 'selmarquee';
  box.appendChild(div);
  marqueeState = { x0: sx, y0: sy, x1: sx, y1: sy, div: div, addKey: !!addKey };
  updateMarqueeDiv();
}
function updateMarqueeDiv() {
  if (!marqueeState || !marqueeState.div) return;
  var d = marqueeState.div;
  var l = Math.min(marqueeState.x0, marqueeState.x1), t = Math.min(marqueeState.y0, marqueeState.y1);
  d.style.left = l + 'px'; d.style.top = t + 'px';
  d.style.width = Math.abs(marqueeState.x1 - marqueeState.x0) + 'px';
  d.style.height = Math.abs(marqueeState.y1 - marqueeState.y0) + 'px';
}
function cancelMarquee() {
  if (!marqueeState) return;
  try { if (marqueeState.div && marqueeState.div.parentNode) marqueeState.div.parentNode.removeChild(marqueeState.div); } catch (e) {}
  marqueeState = null;
}
function finishMarquee() {
  var mq = marqueeState;
  marqueeState = null;
  if (mq && mq.div && mq.div.parentNode) mq.div.parentNode.removeChild(mq.div);
  if (!mq) return;
  var dx = Math.abs(mq.x1 - mq.x0), dy = Math.abs(mq.y1 - mq.y0);
  if (dx < 4 && dy < 4) {
    /* 纯点击（按下松手无位移）：空白处点击 = 取消选择，与选择模式一致；
     * Shift/Ctrl 按住则保留（追加语义） */
    if (!mq.addKey) {
      clearSelection();
      updateSelectHint();
    }
    return;
  }
  var ux0 = (Math.min(mq.x0, mq.x1) - board.origin.scrCoords[1]) / board.unitX;
  var ux1 = (Math.max(mq.x0, mq.x1) - board.origin.scrCoords[1]) / board.unitX;
  var uy1 = (board.origin.scrCoords[2] - Math.min(mq.y0, mq.y1)) / board.unitY;
  var uy0 = (board.origin.scrCoords[2] - Math.max(mq.y0, mq.y1)) / board.unitY;
  if (!mq.addKey) clearSelection();
  var added = 0;
  for (var i = 0; i < createdIds.length; i++) {
    var o = board.objects[createdIds[i]];
    if (!o || !board.objects[o.id]) continue;
    /* 隐藏辅助元素（垂线/平行辅助线/同侧候选点）不参与框选 */
    if (o._defKind === 'perpline' || o._defKind === 'parline' || o._defKind === 'sidecand') continue;
    if (o._measure) continue;   // 长度度量的隐藏载体不可框选（角度度量载体可见可框）
    if (isSelected(o)) continue;
    if (rectContainsObject(o, ux0, uy0, ux1, uy1)) {
      selectedObjs.push(o);
      highlightOn(o);
      added++;
    }
  }
  recomputeDepSelection();
  updateSelectHint();
  syncListSelection();
  if (added > 0) setStatus('框选选中 ' + selectedObjs.length + ' 个对象（Shift+框选可追加）。', true);
}

/* 生成点 p 关于对称轴/对称中心的联动镜像点（固定约束点，原点或轴移动时自动跟随） */
function makeMirrorPoint(orig, ax, mtype, name) {
  var el;
  if (mtype === 'central') {
    el = board.create('point', [
      function () { return 2 * ax.X() - orig.X(); },
      function () { return 2 * ax.Y() - orig.Y(); }
    ], { name: name, fixed: true });
  } else {
    var A = ax.point1, B = ax.point2;
    el = board.create('point', [
      function () {
        var vx = B.X() - A.X(), vy = B.Y() - A.Y();
        var l2 = vx * vx + vy * vy || 1e-12;
        var t = ((orig.X() - A.X()) * vx + (orig.Y() - A.Y()) * vy) / l2;
        return 2 * (A.X() + t * vx) - orig.X();
      },
      function () {
        var vx = B.X() - A.X(), vy = B.Y() - A.Y();
        var l2 = vx * vx + vy * vy || 1e-12;
        var t = ((orig.X() - A.X()) * vx + (orig.Y() - A.Y()) * vy) / l2;
        return 2 * (A.Y() + t * vy) - orig.Y();
      }
    ], { name: name, fixed: true });
  }
  el._defKind = 'mirrorpt';
  el._mirrorIds = [orig.id, ax.id];
  applyDrivenGray(el);
  el._mtype = mtype;
  return el;
}

/* 旋转工具当前角度（工具栏输入框）：纯数字直接用，否则按数表达式求值
 *（度量变量 + Distance/Length 等函数）；非法值回落 90° */
function currentRotAngle() {
  try {
    var raw = String(document.getElementById('rotAngle').value).trim();
    if (!raw) return 90;
    var v = /^\d*\.?\d+$/.test(raw) ? parseFloat(raw) : evalMsrExpr(raw);
    if (isFinite(v)) return v;
  } catch (e) {}
  return 90;
}

/* 生成点 p 绕旋转中心联动旋转的点（固定约束点，中心或原点移动时自动跟随） */
function makeRotatePoint(orig, center, angleDeg, name) {
  var rad = (Number(angleDeg) || 0) * Math.PI / 180;
  var cosA = Math.cos(rad), sinA = Math.sin(rad);
  var el = board.create('point', [
    function () {
      var dx = orig.X() - center.X(), dy = orig.Y() - center.Y();
      return center.X() + dx * cosA - dy * sinA;
    },
    function () {
      var dx = orig.X() - center.X(), dy = orig.Y() - center.Y();
      return center.Y() + dx * sinA + dy * cosA;
    }
  ], { name: name, fixed: true });
  el._defKind = 'rotate';
  applyDrivenGray(el);
  el._depIds = [orig.id, center.id];
  el._rotOf = orig.id; el._rotCenter = center.id; el._rotAngle = Number(angleDeg) || 0;
  return el;
}

/* 把单个对象 o 做镜像/旋转。mpt 为"取某点的像点（含去重）"的函数；
 * mtype: 'axial' | 'central' | 'rotate'。返回是否成功。 */
function mirrorOneObject(o, mpt, mtype, axis, angle) {
  if (!o || !board.objects[o.id]) return false;
  if (o.elementClass === JXG.OBJECT_CLASS_POINT) { mpt(o); return true; }
  var el = null, pts = symBasePoints(o);
  var dk = o._defKind, et = o.elType;
  if (dk === 'bisector' && o._bisIds && et === 'line') {
    /* 角平分线的镜像仍是角平分线：对三个定义点分别取镜像后重建 */
    el = createBisector(mpt(board.objects[o._bisIds[0]]),
                        mpt(board.objects[o._bisIds[1]]),
                        mpt(board.objects[o._bisIds[2]]), nextId('bl'), true);
  } else if (dk === 'perpseg' && o._psegIds && et === 'segment') {
    /* 垂线段的镜像仍是垂线段：对起点与对边两端点分别取镜像后重建 */
    el = createPerpSeg(mpt(board.objects[o._psegIds[0]]),
                       mpt(board.objects[o._psegIds[1]]),
                       mpt(board.objects[o._psegIds[2]]), nextId('ps'), true);
  } else if (et === 'segment' || et === 'line') {
    if (pts.length < 2) return false;
    var q1 = mpt(pts[0]), q2 = mpt(pts[1]);
    if (dk === 'ray') {
      el = board.create('line', [q1, q2], { name: nextId('r'), straightFirst: false, straightLast: true });
      el._defKind = 'ray';
    } else if (et === 'segment') {
      el = board.create('segment', [q1, q2], { name: nextId('s') });
    } else {
      /* 平行线/过点平行线等：镜像为普通直线，不保留平行构造 */
      el = board.create('line', [q1, q2], { name: nextId('l') });
    }
  } else if (et === 'circle' || et === 'circumcircle') {
    if (dk === 'circleRadius') {
      el = board.create('circle', [mpt(pts[0]), o._radius], { name: nextId('c') });
      el._defKind = 'circleRadius';
      el._radius = o._radius;
    } else if (pts.length === 3) {
      el = board.create('circle', [mpt(pts[0]), mpt(pts[1]), mpt(pts[2])], { name: nextId('c') });
    } else if (pts.length >= 2) {
      el = board.create('circle', [mpt(pts[0]), mpt(pts[1])], { name: nextId('c') });
    } else return false;
  } else if (et === 'arc') {
    if (dk === 'arc3') {
      var a3 = o._arc3pts.map(function (pid) { return mpt(board.objects[pid]); });
      el = createArc3(a3[0], a3[1], a3[2], nextId('a'));
    } else {
      if (pts.length < 3) return false;
      /* 二点圆弧：轴/中心对称会反转方向，交换起终点保证弧段集合正确；旋转保持方向 */
      if (mtype === 'rotate')
        el = board.create('arc', [mpt(pts[0]), mpt(pts[1]), mpt(pts[2])], { name: nextId('a') });
      else
        el = board.create('arc', [mpt(pts[0]), mpt(pts[2]), mpt(pts[1])], { name: nextId('a') });
      el._defKind = 'arc';
    }
  } else if (et === 'polygon') {
    var verts = (o.vertices || []).filter(function (v) { return v && v.elementClass === JXG.OBJECT_CLASS_POINT; });
    if (verts.length < 3) return false;
    el = board.create('polygon', verts.map(mpt), { name: nextId('poly') });
    tagPolygonBorders(el);
  } else {
    return false;
  }
  if (!el) return false;
  el._mirrorOf = o.id;
  el._axisId = axis.id;
  el._mtype = mtype;
  if (mtype === 'rotate') el._rotProdAngle = Number(angle) || 0;
  trackId(el.id);
  return true;
}

/* 双击空白处：把待对称/旋转对象一次全部生成（只记一条撤销） */
function doSymmetry() {
  if (!symAxis || symPending.length === 0) {
    setStatus(symPending.length === 0 ? '还没有选中要对称/旋转的图形。' : '请先选择对称轴/对称中心/旋转中心。', false);
    return;
  }
  var axis = symAxis;
  var isRot = (mode === 'rotate');
  var mtype = isRot ? 'rotate' : ((mode === 'ctsym') ? 'central' : 'axial');
  var angle = isRot ? currentRotAngle() : 0;
  var count = 0, ptMap = {};
  function mpt(p) {
    if (ptMap[p.id]) return ptMap[p.id];
    /* 旋转中心 / 对称中心自身（含复合对象里以它为端点/圆心的定义点）：
     * 它的像就是它本身，直接复用原对象，不重复生成新点 */
    if (p.id === axis.id) { ptMap[p.id] = axis; return axis; }
    var mp = isRot ? makeRotatePoint(p, axis, angle, nextId('P'))
                   : makeMirrorPoint(p, axis, mtype, nextId('P'));
    trackId(mp.id);
    ptMap[p.id] = mp;
    return mp;
  }
  pushHistory();  // 先记"生成之前"的快照
  suppressHistory = true;
  try {
    symPending.slice().forEach(function (id) {
      var o = board.objects[id];
      if (!o || o.id === axis.id) return;
      if (mirrorOneObject(o, mpt, mtype, axis, angle)) count++;
    });
  } finally {
    suppressHistory = false;
  }
  symPending = [];
  clearFlashes();
  if (board.objects[axis.id] === axis) flashOn(axis);
  refreshObjectList();
  updateSymHint();
  setStatus('已生成 ' + count + ' 个' + (isRot ? '旋转' : '对称') + '图形，可继续选择下一批；按 Esc 退出工具。', true);
}

/* 对称工具的按下处理：先选轴/中心 → 点选多选（再点取消）/ 框选 → 双击空白处生成 */
function handleSymDown(x, y, sx, sy) {
  var nowMs = Date.now();
  var isDbl = (nowMs - lastSymDownTime < 450) &&
              Math.hypot(sx - lastSymDownX, sy - lastSymDownY) < 12;
  lastSymDownTime = nowMs; lastSymDownX = sx; lastSymDownY = sy;

  if (!symAxis) {
    if (mode === 'axsym') {
      var ax = findLinearAt(sx, sy);
      if (!ax) { setStatus('请点击一条直线、线段或射线作为对称轴。', false); return; }
      symAxis = ax;
      flashOn(ax);
      setStatus('已选对称轴 ' + ax.name + '，点选/框选要对称的图形，双击空白处生成镜像。', true);
    } else {
      var cp = findPointNear(sx, sy);
      if (!cp) { setStatus(mode === 'rotate' ? '请点击一个点作为旋转中心。' : '请点击一个点作为对称中心。', false); return; }
      symAxis = cp;
      flashOn(cp);
      setStatus(mode === 'rotate'
        ? '已选旋转中心 ' + cp.name + '，点选/框选要旋转的图形，双击空白处生成。'
        : '已选对称中心 ' + cp.name + '，点选/框选要对称的图形，双击空白处生成镜像。', true);
    }
    updateSymHint();
    return;
  }
  var hit = findSymTarget(sx, sy);
  if (isDbl && !hit) { doSymmetry(); return; }  // 双击空白处 → 生成
  if (hit) { toggleSymPending(hit); return; }
  startSymMarquee(sx, sy);  // 空白处按下 → 框选
}

/* 在屏幕坐标 (sx, sy) 处找一条线性的参照物（线段/直线/射线；排除垂足的附属线） */
function findLinearAt(sx, sy) {
  var best = null, bestD = 14;  // 与找点一致的 14px 命中容差
  for (var i = createdIds.length - 1; i >= 0; i--) {
    var o = board.objects[createdIds[i]];
    if (!o || (o.elType !== 'segment' && o.elType !== 'line') || o._defKind === 'perpline') continue;
    var d = distToCurvePx(o, sx, sy);
    if (d <= bestD) { best = o; bestD = d; }
  }
  return best;
}
/* 过点平行线的隐藏方向点：Q = P + (B - A)，随过点 P 与参照线 AB 联动；
 * 不进对象列表、不序列化，随平行对象重建 */
function makeParHelper(P, A, B) {
  var Q = board.create('point', [
    function () { return P.X() + (B.X() - A.X()); },
    function () { return P.Y() + (B.Y() - A.Y()); }
  ], { name: '', visible: false, fixed: true, withLabel: false });
  Q._defKind = 'parhelp';
  return Q;
}
function handleParallelDown(x, y, sx, sy) {
  if (!pendingParPoint) {
    var r = pickOrCreatePoint(x, y, sx, sy);
    pendingParPoint = r.point;
    flashOn(r.point);
    document.getElementById('hint').textContent =
      '已选过点' + r.point.name + '，再点击一条线段/直线/射线作参照。';
    return;
  }
  var ref = findLinearAt(sx, sy);
  if (!ref) { setStatus('请点击一条线段、直线或射线作为参照。', false); return; }
  pendingParRef = ref;
  flashOn(ref);
  finishParallelCreate();
}
/* 平行线段当前的有向长度：端点 E 相对过点 P，沿参照方向的投影（可为负） */
function parSignedLen(seg) {
  var P0 = board.objects[seg._parIds[0]], R = board.objects[seg._parIds[1]], E0 = board.objects[seg._endId];
  if (!P0 || !R || !E0 || !R.point1 || !R.point2) return 0;
  var vx = R.point2.X() - R.point1.X(), vy = R.point2.Y() - R.point1.Y();
  var l = Math.hypot(vx, vy) || 1;
  return ((E0.X() - P0.X()) * vx + (E0.Y() - P0.Y()) * vy) / l;
}
function finishParallelCreate() {
  var P = pendingParPoint, ref = pendingParRef;
  var Q = null, L = null, E = null, el = null;
  try {
    var A = ref.point1, B = ref.point2;
    if (!A || !B) throw new Error('参照线无效。');
    if (Math.hypot(B.X() - A.X(), B.Y() - A.Y()) < 1e-9) throw new Error('参照线两点重合。');
    if (mode === 'pline') {
      Q = makeParHelper(P, A, B);
      el = board.create('line', [P, Q], { name: nextId('pl') });
      el._defKind = 'pline';
      el._parIds = [P.id, ref.id];
      el._helpId = Q.id;
      trackId(el.id);   // 自动记下"新增之前"快照，用于撤销
    } else if (mode === 'pray') {
      Q = makeParHelper(P, A, B);
      el = board.create('line', [P, Q], { name: nextId('pr'), straightFirst: false, straightLast: true });
      el._defKind = 'pray';
      el._parIds = [P.id, ref.id];
      el._helpId = Q.id;
      trackId(el.id);   // 自动记下"新增之前"快照，用于撤销
    } else if (mode === 'pseg' || mode === 'psegfree') {
      /* 两种平行线段都有可见的远端端点 E（先按等长做出） */
      var ename = nextId('P');
      if (mode === 'pseg') {
        /* 等长：端点为固定的派生点，不可拖动 */
        E = board.create('point', [
          function () { return P.X() + (B.X() - A.X()); },
          function () { return P.Y() + (B.Y() - A.Y()); }
        ], { name: ename, fixed: true });
      } else {
        /* 不等长：端点是约束在隐藏平行线 L 上的动点，可沿方向拖动调长度 */
        Q = makeParHelper(P, A, B);
        L = board.create('line', [P, Q], { name: '', visible: false, withLabel: false });
        L._defKind = 'parline';
        E = board.create('glider', [P.X() + (B.X() - A.X()), P.Y() + (B.Y() - A.Y()), L], { name: ename });
      }
      E._defKind = 'parend';
      E._parIds = [P.id, ref.id];
      E._free = (mode === 'psegfree');
      applyDrivenGray(E);
      /* 自由端是有约束的可动点（glider）：蓝色区别于完全从动点 */
      if (E._free) applyGliderColor(E);
      if (L) E._onId = L.id;
      trackId(E.id);
      el = board.create('segment', [P, E], { name: nextId('ps') });
      el._defKind = mode;
      el._parIds = [P.id, ref.id];
      el._endId = E.id;
      if (L) el._lineId = L.id;
      if (Q) el._helpId = Q.id;
      E._segId = el.id;
      trackId(el.id);   // 自动记下"新增之前"快照，用于撤销
    } else throw new Error('未知平行模式。');
    setStatus('已创建' + describeObj(el) + '。', true);
    document.getElementById('hint').textContent =
      (mode === 'psegfree') ? '已创建不等长平行线段，拖动远端端点可沿方向调整长度。' : HINTS[mode];
  } catch (err) {
    try { if (el) board.removeObject(el); } catch (e) {}
    try { if (E) board.removeObject(E); } catch (e2) {}
    try { if (L) board.removeObject(L); } catch (e3) {}
    try { if (Q) board.removeObject(Q); } catch (e4) {}
    setStatus(err.message || '创建失败。', false);
  }
  resetParallel();
}

/* 在点击位置附近找两条曲线的交点；返回交点元素或 null */
function findIntersectionNear(sx, sy, tol) {
  tol = tol || 14;
  var curves = [], edges = [];
  /* 粗筛：交点若在点击容差内，参与相交的两条曲线都必须经过点击点附近。
   * 先用廉价的距离计算过滤，只对附近的曲线两两试算交点；
   * 否则每次点击都要对全部曲线两两创建/删除临时交点元素，非常慢。 */
  var preTol = tol + 2;
  createdIds.forEach(function (id) {
    var o = board.objects[id];
    if (!o) return;
    if (isCurve(o)) {
      if (distToCurvePx(o, sx, sy) <= preTol) curves.push(o);
    } else if (o.elType === 'polygon' && o.borders) {
      for (var bi = 0; bi < o.borders.length; bi++) {
        if (edgeDistPx(o.borders[bi], sx, sy) <= preTol) edges.push(o.borders[bi]);
      }
    }
  });
  /* 先试普通曲线两两，再试曲线×多边形边；
   * 边×边跳过：相邻边交于顶点（描点时 findPointNear 已优先复用顶点） */
  var pairs = [];
  for (var i = 0; i < curves.length; i++)
    for (var j = i + 1; j < curves.length; j++) pairs.push([curves[i], curves[j]]);
  for (var a = 0; a < curves.length; a++)
    for (var b = 0; b < edges.length; b++) pairs.push([curves[a], edges[b]]);
  for (var p = 0; p < pairs.length; p++) {
    var ips = computeIntersections(pairs[p][0], pairs[p][1]);
    var hit = null;
    for (var k = 0; k < ips.length; k++) {
      var ip = ips[k];
      var dx = ip.coords.scrCoords[1] - sx, dy = ip.coords.scrCoords[2] - sy;
      if (dx * dx + dy * dy <= tol * tol) { hit = ip; break; }
    }
    if (hit) {
      ips.forEach(function (q) { if (q !== hit) { try { board.removeObject(q); } catch (e) {} } });
      return hit;
    }
    dropTemps(ips);
  }
  return null;
}

