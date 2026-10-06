/* ============================================================
 * jxg-app1.js —— 画板初始化、样式、轨迹动画、右键菜单、属性面板、度量/表达式引擎、图形工厂、控件（文本框/复选框/按钮）
 * 与其它 jxg-app*.js 以普通 <script> 顺序加载，共享全局作用域。
 * ============================================================ */
/* ============================================================
 * 几何作图原型：工具栏 + 画板 + AI JSON 驱动
 * 渲染库：JSXGraph（MIT 许可，可商用）
 * 本文件代码为原型演示用，可自由修改商用。
 * ============================================================ */

var board = JXG.JSXGraph.initBoard('jxgbox', {
  boundingbox: [-8, 8, 8, -8],
  axis: true,
  grid: true,
  showNavigation: true,
  showCopyright: false,
  keepaspectratio: true,
  zoom: { wheel: false }   // 关闭 JSXGraph 原生滚轮缩放，改用下面的自定义滚轮缩放（无修饰键直接缩放）
});

/* ============================================================
 * 样式系统：全局“当前样式” + 单对象属性覆盖
 * 新建对象自动套用 globalStyle；属性面板可逐个覆盖并记入 JSON/撤销。
 * ============================================================ */
var STYLE_DEFAULTS = {
  pointColor: '#D55E00',   // 点的颜色（JSXGraph 默认）
  strokeColor: '#0072B2',  // 线/边框颜色（JSXGraph 默认）
  strokeWidth: 2,
  dash: 0,                 // 0实线 1点线 2虚线 3长虚线 4超长虚线 5点划线 6双点划线
  fillColor: '#F0E442',    // 多边形/圆填充色（JSXGraph 默认）
  fillOpacity: 0.3,
  fontSize: 12,            // 标签字号
  fontFamily: ''           // 标签字体（空=默认）
};
var globalStyle = {
  pointColor: STYLE_DEFAULTS.pointColor,
  strokeColor: STYLE_DEFAULTS.strokeColor,
  strokeWidth: STYLE_DEFAULTS.strokeWidth,
  dash: STYLE_DEFAULTS.dash,
  fillColor: STYLE_DEFAULTS.fillColor,
  fillOpacity: STYLE_DEFAULTS.fillOpacity,
  fontSize: STYLE_DEFAULTS.fontSize,
  fontFamily: STYLE_DEFAULTS.fontFamily
};
/* 某类元素从全局样式里取哪些属性 */
function globalAttrsFor(type) {
  var g = globalStyle, a = {};
  if (type === 'point' || type === 'glider' || type === 'intersection' ||
      type === 'midpoint' || type === 'perpendicular') {
    a.strokeColor = g.pointColor; a.fillColor = g.pointColor;
  } else {
    a.strokeColor = g.strokeColor;
    a.strokeWidth = g.strokeWidth;
    a.dash = g.dash;
  }
  if (type === 'circle' || type === 'polygon' || type === 'circumcircle') {
    a.fillColor = g.fillColor; a.fillOpacity = g.fillOpacity;
  }
  return a;
}
/* JSXGraph 的文本渲染只认 cssdefaultstyle / cssstyle 两个 CSS 字符串
 * （默认字体 Arial 写在 cssdefaultstyle 里），fontSize 有单独的属性通道，
 * 但不存在 fontFamily 属性——字体必须写进 cssStyle 才能覆盖默认值 */
function cssWithFontFamily(css, ff) {
  css = String(css || '').replace(/font-family\s*:[^;]+;?/gi, '');
  if (ff) {
    css = css.trim();
    if (css && !/;\s*$/.test(css)) css += ';';
    css += (css ? ' ' : '') + 'font-family: ' + ff + ';';
  }
  return css.trim();
}
function setLabelFont(label, ff) {
  if (!label) return;
  try {
    var cur = '';
    try { cur = label.getAttribute('cssStyle') || label.getAttribute('cssstyle') || ''; } catch (e0) {}
    label.setAttribute({ cssStyle: cssWithFontFamily(cur, ff) });
  } catch (e) {}
}
/* 拦截 board.create：新建对象自动套用全局样式（调用方显式传的属性优先） */
(function installStyleHook() {
  var origCreate = board.create.bind(board);
  board.create = function (type, parents, attrs) {
    attrs = attrs || {};
    var g = globalAttrsFor(type);
    Object.keys(g).forEach(function (k) {
      if (!(k in attrs)) attrs[k] = g[k];
    });
    var el = origCreate(type, parents, attrs);
    try {
      /* 标签字号/字体 */
      if (el && el.label && (globalStyle.fontSize !== STYLE_DEFAULTS.fontSize || globalStyle.fontFamily)) {
        try { el.label.setAttribute({ fontSize: globalStyle.fontSize }); } catch (e0) {}
        setLabelFont(el.label, globalStyle.fontFamily);
      }
      /* 多边形边框跟随边框样式 */
      if (el && el.elType === 'polygon' && el.borders) {
        el.borders.forEach(function (bd) {
          bd.setAttribute({ strokeColor: globalStyle.strokeColor, strokeWidth: globalStyle.strokeWidth, dash: globalStyle.dash });
        });
      }
    } catch (e) {}
    return el;
  };
})();
/* 把样式快照对象应用到元素（含多边形边框、点的填充、标签字体） */
function applyStyle(el, st) {
  if (!el || !st) return;
  try {
    var a = {};
    if (st.c !== undefined) a.strokeColor = st.c;
    if (st.w !== undefined) a.strokeWidth = st.w;
    if (st.d !== undefined) a.dash = st.d;
    if (st.fc !== undefined) a.fillColor = st.fc;
    if (st.fo !== undefined) a.fillOpacity = st.fo;
    if (Object.keys(a).length) el.setAttribute(a);
    if (st.c !== undefined && el.elementClass === JXG.OBJECT_CLASS_POINT) {
      try { el.setAttribute({ fillColor: st.c }); } catch (e2) {}
    }
    if (el.elType === 'polygon' && el.borders && (st.c !== undefined || st.w !== undefined || st.d !== undefined)) {
      var ba = {};
      if (st.c !== undefined) ba.strokeColor = st.c;
      if (st.w !== undefined) ba.strokeWidth = st.w;
      if (st.d !== undefined) ba.dash = st.d;
      el.borders.forEach(function (bd) { try { bd.setAttribute(ba); } catch (e3) {} });
    }
    if (el.label && (st.fs !== undefined || st.ff !== undefined)) {
      var la = {};
      if (st.fs !== undefined) la.fontSize = st.fs;
      try { el.label.setAttribute(la); } catch (e4) {}
      if (st.ff !== undefined) setLabelFont(el.label, st.ff);
    }
  } catch (e) {}
}
function normColor(c) {
  if (!c) return '';
  c = String(c).toLowerCase();
  if (c === 'none') return 'none';
  return c;
}
/* 收集元素上与“默认/全局”不同的样式，用于 JSON/快照（无差异不记，保持 JSON 简洁） */
/* 记录对象的完整实际样式（不与全局/默认做差分）：重建时按原样恢复，
 * 不受之后全局样式修改的影响 */
function collectStyle(el) {
  if (!el || !el.visProp) return null;
  /* 高亮态（选中红 _selBackup / 依赖紫 _depSelBackup / 吸附候选橙 _candBackup /
   * 复用闪烁 _flashBackup）下 visProp 是临时覆盖色：快照必须读高亮前备份，
   * 否则撤销/保存会把红/紫色固化成对象真实样式 */
  var hb = el._selBackup || el._depSelBackup || el._candBackup || el._flashBackup || null;
  var st = {}, v = el.visProp;
  var isPt = el.elementClass === JXG.OBJECT_CLASS_POINT;
  var scRaw = (hb && hb.strokeColor !== undefined) ? hb.strokeColor : v.strokecolor;
  var sc = normColor(scRaw);
  if (sc && sc !== 'none') st.c = scRaw;
  if (!isPt) {
    st.w = (hb && hb.strokeWidth !== undefined && hb.strokeWidth !== null) ? hb.strokeWidth : v.strokewidth;
    st.d = (v.dash === undefined || v.dash === null) ? 0 : v.dash;
  }
  var isClosed = (el.elType === 'circle' || el.elType === 'polygon' || el.elType === 'circumcircle');
  if (isClosed) {
    var fcRaw = (hb && hb.fillColor !== undefined) ? hb.fillColor : v.fillcolor;
    var fc = normColor(fcRaw);
    st.fc = (fc && fc !== 'none') ? fcRaw : 'none';
    var fo = Number(v.fillopacity);
    st.fo = isFinite(fo) ? fo : 0;
  }
  try {
    if (el.label && el.label.rendNode && el.label.rendNode.style) {
      var fs = parseInt(el.label.rendNode.style.fontSize || '', 10);
      st.fs = isFinite(fs) ? fs : 12;
      st.ff = el.label.rendNode.style.fontFamily || '';
    }
  } catch (e) {}
  return Object.keys(st).length ? st : null;
}

/* ============================================================
 * 轨迹运动：线上的主动点（glider）按各自活动周期运动，
 * 开启“生成轨迹”的从动点留下轨迹（停止后保留）。
 * ============================================================ */
var TRACE_DEFAULT_PERIOD = 5;   // 主动点默认活动周期（秒/往返）
var traceAnim = { running: false, raf: 0, t0: 0, movers: [] };
var traceCurves = {};           // pointId -> 轨迹 curve（运行时对象，不记入 JSON/撤销/列表）

function getTrailCurve(p) {
  var c = traceCurves[p.id];
  if (c && board.objects[c.id]) return c;
  var xs = [], ys = [];
  c = board.create('curve', [xs, ys], { strokeWidth: 2.5 });
  try { c.setAttribute({ strokeColor: p.visProp.strokecolor || '#7c3aed', dash: 0 }); } catch (e) {}
  c._defKind = 'trace';
  c._traceOf = p.id;
  c._xs = xs; c._ys = ys;
  traceCurves[p.id] = c;
  return c;
}
function removeTrail(pid) {
  var c = traceCurves[pid];
  if (c) {
    try { board.removeObject(c); } catch (e) {}
    delete traceCurves[pid];
  }
}
function clearAllTrails() {
  Object.keys(traceCurves).forEach(removeTrail);
}
/* 收集可运动的主动点：可见且有所属曲线的 glider */
function collectMovers() {
  var ms = [];
  createdIds.forEach(function (id) {
    var o = board.objects[id];
    if (o && o._defKind === 'glider' && o.getAttribute('visible') !== false &&
        o._onId && board.objects[o._onId]) {
      var per = (typeof o._period === 'number' && o._period > 0) ? o._period : TRACE_DEFAULT_PERIOD;
      var cv = board.objects[o._onId];
      /* 圆/三点圆：连续绕行（一周期 = 一圈）；线段/圆弧/直线/射线：往返 */
      /* 圆锥曲线（椭圆/双曲线/抛物线/五点二次曲线）：与圆一样连续绕行 */
      var loop = cv && (cv.elType === 'circle' || cv.elType === 'circumcircle' || isConicEl(cv));
      ms.push({ el: o, period: per, phase0: (typeof o.position === 'number') ? o.position : 0, loop: !!loop });
    }
  });
  return ms;
}
/* 圆锥曲线判定：JSXGraph 中 ellipse/hyperbola/parabola/conic（五点二次曲线）元素
 * 的 elType 都是 'curve'，不能按 elType 区分，统一按创建时打的 _defKind 标记识别 */
function isConicEl(o) {
  return o && (o._defKind === 'ellipse' || o._defKind === 'hyperbola' ||
               o._defKind === 'parabola' || o._defKind === 'conic');
}
/* glider 在其曲线上参数 t（0..1）处的目标坐标 */
function gliderTargetAt(gl, t) {
  var cv = gl._onId && board.objects[gl._onId];
  if (!cv) return null;
  try {
    if (cv.elType === 'circle' || cv.elType === 'circumcircle') {
      var ctr = cv.center || (cv.elType === 'circle' && board.objects[cv.parents[0]]);
      var r = radiusOf(cv);
      if (!ctr || !isFinite(r)) return null;
      var a = t * 2 * Math.PI;
      return [ctr.X() + r * Math.cos(a), ctr.Y() + r * Math.sin(a)];
    }
    if (cv.elType === 'arc') {
      var cc = cv.center || board.objects[cv.parents[0]];
      var p1 = cv.parents[1] && board.objects[cv.parents[1]];
      var p2 = cv.parents[2] && board.objects[cv.parents[2]];
      var rr = radiusOf(cv);
      if (!cc || !p1 || !p2 || !isFinite(rr)) return null;
      var a1 = Math.atan2(p1.Y() - cc.Y(), p1.X() - cc.X());
      var a2 = Math.atan2(p2.Y() - cc.Y(), p2.X() - cc.X());
      while (a2 <= a1) a2 += 2 * Math.PI;   // 与建弧一致：统一按逆时针走
      var aa = a1 + t * (a2 - a1);
      return [cc.X() + rr * Math.cos(aa), cc.Y() + rr * Math.sin(aa)];
    }
    /* 圆锥曲线（椭圆/双曲线/抛物线/五点二次曲线）：视口范围截断采样折线，
     * 按弧长匀速推进；双曲线跨渐近线段为 0 长瞬移，不会横穿画面 */
    if (isConicEl(cv)) {
      var path = conicAnimPath(cv);
      if (!path) return null;
      return conicPathPointAt(path, t * path.total);
    }
    var A = cv.point1, B = cv.point2;
    if (!A || !B) return null;
    var ux = B.X() - A.X(), uy = B.Y() - A.Y();
    if (cv._defKind === 'ray' || cv._defKind === 'bisector') return [A.X() + ux * t * 3, A.Y() + uy * t * 3];
    return [A.X() + ux * t, A.Y() + uy * t];
  } catch (e) { return null; }
}
function traceAnimFrame(now) {
  if (!traceAnim.running) return;
  var elapsed = (now - traceAnim.t0) / 1000;
  var i, m, ph, pos, tgt;
  for (i = 0; i < traceAnim.movers.length; i++) {
    m = traceAnim.movers[i];
    if (!board.objects[m.el.id]) continue;
    var pos;
    if (m.loop) {
      pos = (m.phase0 + elapsed / m.period) % 1;   // 圆：连续绕行，一周期一圈
    } else {
      ph = (m.phase0 + elapsed / m.period) % 2;    // 其余：三角波往返，无跳变
      pos = ph < 1 ? ph : 2 - ph;
    }
    tgt = gliderTargetAt(m.el, pos);
    if (tgt) { try { m.el.moveTo(tgt); } catch (e) {} }
  }
  board.update();
  /* 记录开启轨迹的从动点 */
  for (i = 0; i < createdIds.length; i++) {
    var p = board.objects[createdIds[i]];
    if (!p || !p._traceOn || p.elementClass !== JXG.OBJECT_CLASS_POINT) continue;
    if (p.getAttribute('visible') === false || !board.objects[p.id]) continue;
    var c = getTrailCurve(p);
    var n = c._xs.length, x = p.X(), y = p.Y();
    if (!isFinite(x) || !isFinite(y)) continue;
    if (n === 0 || Math.hypot(x - c._xs[n - 1], y - c._ys[n - 1]) > 1e-9) {
      if (n < 3000) {
        c._xs.push(x); c._ys.push(y);
        try { c.updateCurve(); } catch (e) {}
      }
    }
  }
  traceAnim.raf = requestAnimationFrame(traceAnimFrame);
}
function startTraceAnimation() {
  if (traceAnim.running) return;
  var movers = collectMovers();
  if (!movers.length) {
    setStatus('没有可运动的主动点：先用“点”工具在线/圆/圆弧上点一下，生成线上的约束点。', false);
    return;
  }
  traceAnim.running = true;
  traceAnim.movers = movers;
  traceAnim.t0 = performance.now();
  var btn = document.querySelector('#toolbar button[data-action="traceanim"]');
  if (btn) { btn.classList.add('running'); btn.title = '停止轨迹运动（轨迹保留）'; }
  setStatus('轨迹运动中：' + movers.length + ' 个主动点按各自周期运动；仍可平移视图、选择与拖动对象（运动中的主动点仅可点选）；再次点击按钮停止（轨迹保留）。', true);
  traceAnim.raf = requestAnimationFrame(traceAnimFrame);
}
function stopTraceAnimation() {
  if (!traceAnim.running) return;
  traceAnim.running = false;
  try { cancelAnimationFrame(traceAnim.raf); } catch (e) {}
  var btn = document.querySelector('#toolbar button[data-action="traceanim"]');
  if (btn) {
    btn.classList.remove('running');
    btn.title = '轨迹运动：所有线上的主动点按各自的活动周期运动，开启“生成轨迹”的从动点留下轨迹；再次点击停止（轨迹保留）';
  }
  setStatus('轨迹运动已停止，轨迹已保留（右键点对象可清除轨迹）。', true);
}
/* 该点当前是否正被轨迹动画驱动（是则用户拖拽会被每帧写回的位置覆盖，只允许点选） */
function isAnimMover(pt) {
  if (!traceAnim.running || !pt) return false;
  for (var i = 0; i < traceAnim.movers.length; i++) {
    if (traceAnim.movers[i].el === pt) return true;
  }
  return false;
}

/* ============================================================
 * 右键菜单：轨迹开关 / 清除轨迹 / 活动周期 / 属性入口
 * ============================================================ */
function hideCtxMenu() {
  var m = document.getElementById('ctxmenu');
  if (m) m.style.display = 'none';
}
/* 属性面板开关（激活/非激活态按钮）：对已选对象（单个或多个）开/关属性面板 */
function syncPropsBtn() {
  var b = document.getElementById('btnProps');
  if (!b) return;
  var p = document.getElementById('proppanel');
  b.classList.toggle('active', !!(p && p.style.display === 'block'));
}
function togglePropPanel() {
  var p = document.getElementById('proppanel');
  if (p && p.style.display === 'block') { closePropPanel(); return; }
  hideCtxMenu();
  var alive = selectedObjs.filter(function (o) { return board.objects[o.id]; });
  /* 任何时候都可以开属性：无选中时显示背景（坐标轴/网格）属性 */
  if (!alive.length) { openBoardPropPanel(); return; }
  openPropPanel(alive.length === 1 ? alive[0] : alive);
}
function showCtxMenu(cx, cy, o) {
  var m = document.getElementById('ctxmenu');
  var isPt = o.elementClass === JXG.OBJECT_CLASS_POINT;
  /* 只有完全被确定的从动点（中点/交点/垂足/中心/对称点等，isDrivenPoint）
   * 才有"生成轨迹"选项；自由点/约束点（可自己动）不显示 */
  var canTrace = isPt && isDrivenPoint(o);
  var isGlider = isPt && o._defKind === 'glider';
  var h = '';
  if (canTrace) {
    h += '<button data-act="trace"><span>生成轨迹</span><span class="ck">' + (o._traceOn ? '✓' : '') + '</span></button>';
    h += '<button data-act="cleartrace"' + (traceCurves[o.id] ? '' : ' disabled') +
         '><span>清除轨迹</span><span></span></button>';
  }
  if (isGlider) {
    var per = (typeof o._period === 'number' && o._period > 0) ? o._period : TRACE_DEFAULT_PERIOD;
    h += '<div class="periodrow"><span>活动周期</span>' +
         '<input id="ctxPeriod" type="number" min="0.5" max="120" step="0.5" value="' + per + '">' +
         '<span>秒</span><button data-act="periodok" style="width:auto;padding:4px 10px;">确定</button></div>';
  }
  if (canTrace || isGlider) {
    h += '<hr>';
  }
  h += '<button data-act="props"><span>属性…</span><span></span></button>';
  m.innerHTML = h;
  m.style.display = 'block';
  m.style.left = '0px'; m.style.top = '0px';
  var r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(cx, window.innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(4, Math.min(cy, window.innerHeight - r.height - 8)) + 'px';
  m.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      var act = b.getAttribute('data-act');
      if (act === 'trace') {
        pushHistory();
        o._traceOn = !o._traceOn;
        if (!o._traceOn) removeTrail(o.id);
        board.update();
        setStatus(o._traceOn ? '已为点 ' + o.name + ' 开启轨迹。' : '已关闭点 ' + o.name + ' 的轨迹。', true);
        hideCtxMenu();
      } else if (act === 'cleartrace') {
        removeTrail(o.id);
        board.update();
        setStatus('已清除点 ' + o.name + ' 的轨迹。', true);
        hideCtxMenu();
      } else if (act === 'periodok') {
        var inp = document.getElementById('ctxPeriod');
        var v = inp ? parseFloat(inp.value) : NaN;
        if (!isFinite(v) || v < 0.5 || v > 120) { setStatus('活动周期请输入 0.5～120 秒。', false); return; }
        pushHistory();
        o._period = v;
        setStatus('点 ' + o.name + ' 的活动周期设为 ' + v + ' 秒。', true);
        hideCtxMenu();
      } else if (act === 'props') {
        hideCtxMenu();
        /* 右键的对象在多选集合内：显示共同样式属性 */
        var sel = selectedObjs.filter(function (a) { return board.objects[a.id]; });
        openPropPanel(sel.length > 1 && isSelected(o) ? sel : o, cx, cy);
      }
    });
  });
}

/* ============================================================
 * 对象属性面板（支持多选：仅显示共同样式属性）
 * ============================================================ */
var propTarget = null;        // 单对象或对象数组（多选：不显示名称/定义等不可一致的内容）
var propBoardMode = false;    // 背景模式：无选中对象时显示坐标轴/网格设置
var propHistPushed = false;
var touchedFields = {};       // 本次打开中用户实际改过的字段；多选时未触碰的字段不应用，保持各对象原值
function propTargetList() {
  if (!propTarget) return [];
  var arr = Array.isArray(propTarget) ? propTarget : [propTarget];
  return arr.filter(function (o) { return o && board.objects[o.id]; });
}
var DASH_NAMES = ['实线', '点线 ·····', '虚线 - - -', '长虚线 ——', '超长虚线', '点划线 -·-·', '双点划线 -··-··'];
var FONT_NAMES = [['', '默认'], ['sans-serif', '非衬线'], ['serif', '衬线'], ['monospace', '等宽']];
function closePropPanel() {
  var p = document.getElementById('proppanel');
  if (p) p.style.display = 'none';
  propTarget = null;
  propWidget = null;
  propBoardMode = false;
  syncPropsBtn();
}
function openPropPanel(target, cx, cy) {
  propBoardMode = false;
  propWidget = null;
  var list = Array.isArray(target) ? target.slice() : (target ? [target] : []);
  list = list.filter(function (o) { return o && board.objects[o.id]; });
  if (!list.length) return;
  propTarget = list.length === 1 ? list[0] : list;
  propHistPushed = false;
  touchedFields = {};
  renderPropPanel();
  var p = document.getElementById('proppanel');
  p.style.display = 'block';
  syncPropsBtn();
}
/* ============================================================
 * 背景（画板）属性：坐标轴 / 网格
 * ============================================================ */
function boardAxisEls() {
  var xs = [];
  for (var id in board.objects) {
    var o = board.objects[id];
    if (o && o.elType === 'axis') xs.push(o);
  }
  return xs;
}
/* 主网格元素（JSXGraph 网格是主从一对：xxx 与 xxx_minor，从属随主显隐） */
function boardGridEl() {
  for (var id in board.objects) {
    var o = board.objects[id];
    if (o && o.elType === 'grid' && o.id.slice(-6) !== '_minor') return o;
  }
  return null;
}
function boardAxesOn() {
  var xs = boardAxisEls();
  return xs.length > 0 && xs.every(function (a) { return a.visProp.visible !== false; });
}
function boardGridOn() {
  var g = boardGridEl();
  return !!(g && g.visProp.visible !== false);
}
function setBoardGridVisible(v) {
  var g = boardGridEl();
  if (g) {
    g.setAttribute({ visible: v });
    /* JSXGraph 1.13 的 Grid 渲染器不检查可见性：只设 visProp 格线仍淡显在画面上，
     * 必须同步隐藏渲染节点；缩放/平移重绘路径不会重置该 display（已实测） */
    try { g.rendNode.style.display = v ? '' : 'none'; } catch (e) {}
  }
  /* JSXGraph 的 grid:true 是"双层"实现：grid 元素 + 两轴刻度 majorheight=-1 的全长线，
   * 只关一层会残留淡线；刻度层随网格开关切回普通小刻度（6px），恢复时再变全长 */
  for (var id in board.objects) {
    var o = board.objects[id];
    if (!o) continue;
    if (o.elType === 'grid' && o !== g) {
      try { o.rendNode.style.display = v ? '' : 'none'; } catch (e) {}
    } else if (o.elType === 'ticks') {
      o.setAttribute({ majorheight: v ? -1 : 6 });
    }
  }
  board.update();
}
function setBoardAxesVisible(v) {
  boardAxisEls().forEach(function (a) { a.setAttribute({ visible: v }); });
  if (!v) setBoardGridVisible(false);   // 无坐标轴时网格无意义，一并关闭
  board.update();
}
function openBoardPropPanel() {
  propTarget = null;
  propWidget = null;
  propBoardMode = true;
  renderPropPanel();
  document.getElementById('proppanel').style.display = 'block';
  syncPropsBtn();
}
function renderBoardPropPanel() {
  document.getElementById('ppTitle').textContent = '属性：背景';
  var axesOn = boardAxesOn(), gridOn = boardGridOn();
  var h = '';
  h += '<div class="prow"><span>坐标轴</span><span class="ctl">' +
       '<input type="checkbox" id="ppAxes"' + (axesOn ? ' checked' : '') + '></span></div>';
  h += '<div class="prow"' + (axesOn ? '' : ' style="opacity:.45;"') + '><span>网格</span><span class="ctl">' +
       '<input type="checkbox" id="ppGrid"' + (gridOn ? ' checked' : '') + (axesOn ? '' : ' disabled') +
       '></span></div>';
  document.getElementById('ppBody').innerHTML = h;
  var foot = document.querySelector('#proppanel .pfoot');
  if (foot) foot.style.display = 'none';   // 背景属性无“恢复为当前样式”
  var ax = document.getElementById('ppAxes');
  if (ax) ax.addEventListener('change', function () {
    setBoardAxesVisible(ax.checked);
    renderBoardPropPanel();   // 关轴后网格联动关闭并置灰，重显刷新勾选/禁用态
  });
  var gr = document.getElementById('ppGrid');
  if (gr) gr.addEventListener('change', function () { setBoardGridVisible(gr.checked); });
}
/* 数字格式化：保留两位小数去尾零 */
function ppNum(x) {
  var v = Number(x);
  if (!isFinite(v)) return String(x);
  v = Math.round(v * 100) / 100;
  return String(v);
}
/* ---------- 度量变量（长度/角度）与表达式文本 ----------
 * 度量以"载体"挂进 createdIds：长度度量的载体是隐藏固定点（不可点选、不参与吸附/框选）；
 * 角度度量的载体是 JSXGraph angle 元素（带弧线与名称标签，可视化）。
 * 载体带 _measure 定义与 _depIds 显式依赖（级联删除/依赖序/联动选中）。 */
function angleDeg3(p1, v, p2) {
  var a1 = Math.atan2(p1.Y() - v.Y(), p1.X() - v.X());
  var a2 = Math.atan2(p2.Y() - v.Y(), p2.X() - v.X());
  var d = (a2 - a1) * 180 / Math.PI;
  return ((d % 360) + 360) % 360;   // 逆时针 0～360，与旋转工具"逆时针为正"一致
}
/* 长度度量目标的当前数值：线段=两端距离；圆/三点圆=周长；圆弧=弧长；多边形=周长；其余 NaN */
function measureLenOf(t) {
  if (!t) return NaN;
  try {
    if (t.elType === 'arrow') {
      var apr = t.parents || [];
      var ap1 = board.objects[apr[0]], ap2 = board.objects[apr[1]];
      return (ap1 && ap2) ? Math.hypot(ap2.X() - ap1.X(), ap2.Y() - ap1.Y()) : NaN;
    }
    if (t.elType === 'segment') {
      var pr = t.parents || [];
      var a = board.objects[pr[0]], b = board.objects[pr[1]];
      return (a && b) ? Math.hypot(b.X() - a.X(), b.Y() - a.Y()) : NaN;
    }
    if (t.elType === 'circle' || t.elType === 'circumcircle') {
      var r = radiusOf(t);
      return isFinite(r) ? 2 * Math.PI * r : NaN;
    }
    if (t.elType === 'arc') {
      var r2 = radiusOf(t);
      var av = (typeof t.Value === 'function') ? t.Value() : NaN;
      return (isFinite(r2) && isFinite(av)) ? r2 * Math.abs(av) : NaN;
    }
    if (t.elType === 'polygon') {
      var vs = t.vertices || [], sum = 0;
      for (var i = 0; i < vs.length; i++) {
        var p = vs[i], q = vs[(i + 1) % vs.length];
        sum += Math.hypot(q.X() - p.X(), q.Y() - p.Y());
      }
      return sum;
    }
  } catch (e) {}
  return NaN;
}
/* 度量载体当前值：角度为度（0～360 逆时针），长度为单位长 */
function measureCarrierValue(o) {
  if (!o || !o._measure) return NaN;
  try {
    if (o._measure.kind === 'angle') {
      var t = o._measure.pts;
      var p1 = board.objects[t[0]], v = board.objects[t[1]], p2 = board.objects[t[2]];
      if (!(p1 && v && p2)) return NaN;
      var d = angleDeg3(p1, v, p2);   // p1→p2 逆时针 0～360
      var dir = o._measure.dir || 'minor';
      if (dir === 'cw') return (360 - d) % 360;
      if (dir === 'minor') return Math.min(d, 360 - d);
      return d;
    }
    return measureLenOf(board.objects[o._measure.of]);
  } catch (e) { return NaN; }
}
/* 收集全部度量变量 名称→数值（表达式文本求值用） */
function collectMeasureVars() {
  var vars = {};
  for (var i = 0; i < createdIds.length; i++) {
    var o = board.objects[createdIds[i]];
    if (o && o._measure && o.name) vars[o.name] = measureCarrierValue(o);
  }
  return vars;
}
/* 按名称找对象（点在前后端都按名称引用；名称全局唯一） */
function findObjByName(nm) {
  for (var i = 0; i < createdIds.length; i++) {
    var o = board.objects[createdIds[i]];
    if (o && o.name === nm) return o;
  }
  return null;
}
/* 表达式文本函数表（与 lib/jxg-steps.js 的 TEXT_FUNCS 白名单保持一致；函数名大小写不敏感）。
 * 值类型：{k:'n',v} 数字 | {k:'p',el} 画板点元素 | {k:'xy',x,y} 坐标对 | {k:'o',el} 其他图形对象。
 * 三角函数为度数制（与角度度量/旋转工具一致） */
var MSRTEXT_FUNCS = {
  x: function (a) { var q = ptXY(a); return num(q[0]); },
  y: function (a) { var q = ptXY(a); return num(q[1]); },
  distance: function (a, b) { var q1 = ptXY(a), q2 = ptXY(b); return num(Math.hypot(q2[0] - q1[0], q2[1] - q1[1])); },
  midpoint: function (a, b) {
    var q1 = ptXY(a), q2 = ptXY(b);
    return { k: 'xy', x: (q1[0] + q2[0]) / 2, y: (q1[1] + q2[1]) / 2 };
  },
  center: function (o) {
    var el = objEl(o, 'Center');
    var c = (el.elType === 'circle' || el.elType === 'circumcircle' || el.elType === 'arc' ||
             el.elType === 'ellipse' || el.elType === 'hyperbola') ? el.center : null;
    if (!c) throw new Error('Center 只支持圆/圆弧/椭圆/双曲线');
    return { k: 'p', el: c };
  },
  point: function (o, t) {
    var el = objEl(o, 'Point'), tv = numV(t);
    if (el.elType === 'segment') {
      var pr = el.parents || [], a1 = board.objects[pr[0]], b1 = board.objects[pr[1]];
      if (!a1 || !b1) throw new Error('Point 的线段无效');
      return { k: 'xy', x: a1.X() + tv * (b1.X() - a1.X()), y: a1.Y() + tv * (b1.Y() - a1.Y()) };
    }
    if (el.elType === 'line') {
      var p1 = el.point1, p2 = el.point2;
      if (!p1 || !p2) throw new Error('Point 的直线无效');
      return { k: 'xy', x: p1.X() + tv * (p2.X() - p1.X()), y: p1.Y() + tv * (p2.Y() - p1.Y()) };
    }
    if (el.elType === 'circle' || el.elType === 'circumcircle' || el.elType === 'arc') {
      var r = radiusOf(el);
      if (!isFinite(r)) throw new Error('Point 的圆/圆弧无效');
      var rad = tv * Math.PI / 180, cen = el.center;
      if (el.elType === 'arc' && el.radiuspoint) {
        var base = Math.atan2(el.radiuspoint.Y() - cen.Y(), el.radiuspoint.X() - cen.X());
        rad = base + tv * Math.PI / 180;
      }
      return { k: 'xy', x: cen.X() + r * Math.cos(rad), y: cen.Y() + r * Math.sin(rad) };
    }
    throw new Error('Point 只支持线段/直线/圆/圆弧');
  },
  length: function (o) { var v = measureLenOf(objEl(o, 'Length')); return num(v); },
  area: function (o) {
    var el = objEl(o, 'Area');
    if (el.elType === 'circle' || el.elType === 'circumcircle') {
      var r = radiusOf(el);
      return num(isFinite(r) ? Math.PI * r * r : NaN);
    }
    if (el.elType === 'polygon') {
      var vs = el.vertices || [], sum = 0;
      for (var j = 0; j < vs.length; j++) {
        var p = vs[j], q = vs[(j + 1) % vs.length];
        if (!p || !q) return num(NaN);
        sum += p.X() * q.Y() - q.X() * p.Y();
      }
      return num(Math.abs(sum) / 2);
    }
    throw new Error('Area 只支持多边形/圆');
  },
  radius: function (o) { return num(radiusOf(objEl(o, 'Radius'))); },
  slope: function (o) {
    var el = objEl(o, 'Slope');
    if (el.elType === 'line' && el.stdform) {
      var sf = el.stdform;
      if (Math.abs(sf[2]) < 1e-12) throw new Error('竖直直线无斜率');
      return num(-sf[1] / sf[2]);
    }
    if (el.elType === 'segment') {
      var pr2 = el.parents || [], a2 = board.objects[pr2[0]], b2 = board.objects[pr2[1]];
      if (!a2 || !b2 || Math.abs(b2.X() - a2.X()) < 1e-12) throw new Error('竖直线段无斜率');
      return num((b2.Y() - a2.Y()) / (b2.X() - a2.X()));
    }
    throw new Error('Slope 只支持直线/线段');
  },
  abs: function (a) { return num(Math.abs(numV(a))); },
  sqrt: function (a) { return num(Math.sqrt(numV(a))); },
  floor: function (a) { return num(Math.floor(numV(a))); },
  ceil: function (a) { return num(Math.ceil(numV(a))); },
  round: function (a) { return num(Math.round(numV(a))); },
  max: function () { return num(Math.max.apply(null, argsNum(arguments))); },
  min: function () { return num(Math.min.apply(null, argsNum(arguments))); },
  mod: function (a, b) { return num(numV(a) % numV(b)); },
  sin: function (a) { return num(Math.sin(numV(a) * Math.PI / 180)); },
  cos: function (a) { return num(Math.cos(numV(a) * Math.PI / 180)); },
  tan: function (a) { return num(Math.tan(numV(a) * Math.PI / 180)); },
  asin: function (a) { return num(Math.asin(numV(a)) * 180 / Math.PI); },
  acos: function (a) { return num(Math.acos(numV(a)) * 180 / Math.PI); },
  atan: function (a) { return num(Math.atan(numV(a)) * 180 / Math.PI); }
};
function num(v) { return { k: 'n', v: v }; }
function numV(a) { if (a.k !== 'n') throw new Error('该处必须是数字'); return a.v; }
function ptXY(a) {
  if (a.k === 'p') return [a.el.X(), a.el.Y()];
  if (a.k === 'xy') return [a.x, a.y];
  throw new Error('该处必须是点');
}
function objEl(a, fn) {
  if (a.k === 'o') return a.el;
  if (a.k === 'p') return a.el;
  throw new Error(fn + ' 的参数必须是图形对象');
}
function argsNum(args) {
  var out = [];
  for (var j = 0; j < args.length; j++) out.push(numV(args[j]));
  return out;
}
/* 表达式文本求值：数字、度量变量、点/对象函数、+ - * / 括号。
 * 裸标识符：度量变量→数，点→点值，其他对象→对象值；整体结果必须是数。 */
function evalMsrExpr(src, vars) {
  vars = vars || collectMeasureVars();
  /* 容忍全角/印刷乘号与负号（属性面板公式行会生成 × 和 −） */
  var s = String(src).replace(/×/g, '*').replace(/·/g, '*').replace(/−/g, '-'), i = 0;
  function skip() { while (i < s.length && /\s/.test(s[i])) i++; }
  function parseAdd() {
    var v = parseMul();
    for (;;) {
      skip();
      if (s[i] === '+') { i++; v = num(numV(v) + numV(parseMul())); }
      else if (s[i] === '-') { i++; v = num(numV(v) - numV(parseMul())); }
      else return v;
    }
  }
  function parseMul() {
    var v = parseFactor();
    for (;;) {
      skip();
      if (s[i] === '*') { i++; v = num(numV(v) * numV(parseFactor())); }
      else if (s[i] === '/') { i++; v = num(numV(v) / numV(parseFactor())); }
      else return v;
    }
  }
  function parseFactor() {
    skip();
    if (s[i] === '-') { i++; return num(-numV(parseFactor())); }
    if (s[i] === '(') {
      i++; var v = parseAdd();
      skip();
      if (s[i] !== ')') throw new Error('缺少右括号');
      i++; return v;
    }
    var m = s.slice(i).match(/^\d*\.?\d+(?:[eE][+-]?\d+)?/);
    if (m) { i += m[0].length; return num(parseFloat(m[0])); }
    m = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (m) {
      i += m[0].length;
      var nm = m[0];
      skip();
      /* 函数调用 */
      if (s[i] === '(') {
        i++; var args = [];
        skip();
        if (s[i] !== ')') {
          args.push(parseAdd());
          skip();
          while (s[i] === ',') { i++; args.push(parseAdd()); skip(); }
        }
        if (s[i] !== ')') throw new Error('缺少右括号');
        i++;
        var fn = MSRTEXT_FUNCS[nm.toLowerCase()];
        if (!fn) throw new Error('不支持的函数 "' + nm + '"');
        return fn.apply(null, args);
      }
      /* 裸标识符：度量变量 → 数；点 → 点值；其他对象 → 对象值 */
      if (nm in vars && isFinite(vars[nm])) return num(vars[nm]);
      var ob = findObjByName(nm);
      if (ob) {
        if (ob.elementClass === JXG.OBJECT_CLASS_POINT) return { k: 'p', el: ob };
        return { k: 'o', el: ob };
      }
      throw new Error('未知度量、点或对象 "' + nm + '"');
    }
    throw new Error('无法解析的表达式');
  }
  var r = parseAdd();
  skip();
  if (i < s.length) throw new Error('表达式末尾有多余内容');
  if (r.k !== 'n') throw new Error('表达式结果必须是一个数');
  return r.v;
}
/* 表达式文本的画板内容函数：画板每次更新重算（度量/图形变化时自动跟新） */
function makeMsrTextContent(el) {
  return function () {
    try {
      var v = evalMsrExpr(el._exprText);
      return isFinite(v) ? ppNum(v) : '?';
    } catch (e) { return '?'; }
  };
}
/* 重扫表达式文本引用的度量（改名/改表达式后刷新级联依赖） */
function rescanTextDeps(el) {
  var deps = [];
  try {
    String(el._exprText).replace(/[A-Za-z_][A-Za-z0-9_]*/g, function (m) {
      for (var i = 0; i < createdIds.length; i++) {
        var c = board.objects[createdIds[i]];
        if (c && c._measure && c.name === m && deps.indexOf(c.id) < 0) deps.push(c.id);
        else if (c && !c._measure && c.name === m && deps.indexOf(c.id) < 0) deps.push(c.id);
      }
      return m;
    });
  } catch (e) {}
  el._depIds = deps;
}
/* 创建长度度量（载体为隐藏固定点）；skipTrack=true 时由调用方统一登记 */
function makeLengthMeasure(target, name, skipTrack) {
  var el = board.create('point', [0, 0], { name: name, visible: false, fixed: true, withLabel: false });
  el._defKind = 'measure';
  el._measure = { kind: 'length', of: target.id };
  el._depIds = [target.id];
  if (!skipTrack) trackId(el.id);
  return el;
}
/* 创建角度度量（载体为 angle 元素：弧线 + 名称=数值° 标签）。
 * dir：'minor'（≤180，缺省）|'ccw'（p1→p2 逆时针 0～360）|'cw'（p1→p2 顺时针 0～360）。
 * 弧线可视化：minor 用 JSXGraph selection:minor；cw 把元素点对换成 [p2,v,p1]，
 * 其逆时针弧正好覆盖 p1→p2 的顺时针一侧；数值统一由 measureCarrierValue 按 dir 计算 */
function makeAngleMeasure(p1, v, p2, name, dir, skipTrack) {
  dir = (dir === 'ccw' || dir === 'cw') ? dir : 'minor';
  var attrs = { name: name, radius: 1 };
  var parents = [p1, v, p2];
  if (dir === 'minor') attrs.selection = 'minor';
  else if (dir === 'cw') parents = [p2, v, p1];
  var el = board.create('angle', parents, attrs);
  el._defKind = 'measure';
  el._measure = { kind: 'angle', pts: [p1.id, v.id, p2.id], dir: dir };
  el._depIds = [p1.id, v.id, p2.id];
  try {
    el.label.setText(function () {
      return name + ' = ' + ppNum(measureCarrierValue(el)) + '°';
    });
  } catch (e) {}
  if (!skipTrack) trackId(el.id);
  return el;
}
/* 创建表达式文本（可拖动，内容每次更新重算） */
function makeExprTextEl(expr, x, y, name, skipTrack) {
  var el = board.create('text', [x, y, ''], { name: name, fontSize: 14, draggable: true });
  el._defKind = 'text';
  el._isExprText = true;
  el._exprText = String(expr);
  try { el.setText(makeMsrTextContent(el)); } catch (e) {}
  rescanTextDeps(el);
  if (!skipTrack) trackId(el.id);
  return el;
}
/* ============================================================
 * 文本框 / 复选框 / 按钮（GeoGebra 风格控件）
 * 实现为画板容器内的 HTML 浮层：位置固定在屏幕像素上，不随画板缩放/平移。
 * 交互：任何工具模式下点击即触发（单击）；按住拖拽移动；配置/删除走对象列表。
 * 控件不进入 board.objects，独立注册表 widgets 参与快照/撤销/对象列表。
 * ============================================================ */
var widgets = [];      // 控件注册表（按创建顺序）
var widgetSeq = 0;     // 控件 id 序号
var widgetPress = null; // 控件按下跟踪 {w, cx0, cy0, ox, oy, moved, pre}
var propWidget = null;  // 属性面板当前指向的控件（非画板对象时）
var selWidget = null;   // 当前选中的控件（文本框单击选中，显示边框）
var widgetDlgPending = null; // 弹出对话框待确认的创建请求 {kind, sx, sy}，随对话框关闭清空
function widgetLayer() {
  var box = document.getElementById('jxgbox');
  /* 控件选中/编辑态样式（一次性注入） */
  if (box && !document.getElementById('jxgWidgetCss')) {
    var st = document.createElement('style');
    st.id = 'jxgWidgetCss';
    st.textContent =
      '.jxg-widget-selected{outline:2px solid #1a73e8 !important;outline-offset:3px;}' +
      '.jxg-widget-editing{outline:2px solid #1a73e8 !important;outline-offset:3px;cursor:text !important;}' +
      '.jxg-widget-editing span{cursor:text !important;user-select:text !important;-webkit-user-select:text !important;}';
    document.head.appendChild(st);
  }
  var layer = document.getElementById('widgetLayer');
  if (!layer && box) {
    layer = document.createElement('div');
    layer.id = 'widgetLayer';
    layer.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;' +
      'overflow:hidden;pointer-events:none;z-index:20;';
    box.appendChild(layer);
  }
  return layer;
}
function widgetById(id) {
  for (var i = 0; i < widgets.length; i++) if (widgets[i].id === id) return widgets[i];
  return null;
}
function describeWidget(w) {
  if (!w) return '';
  if (w.kind === 'ptext') return '文本框 ' + w.id + '：' + (w.content || '');
  if (w.kind === 'checkbox')
    return '复选框 ' + w.id + '：' + (w.caption || '') + (w.checked ? '（已勾选）' : '（未勾选）');
  if (w.kind === 'button') return '按钮 ' + w.id + '：' + (w.caption || '');
  return w.id || '';
}
function widgetToStep(w) {
  if (!w) return null;
  if (w.kind === 'ptext')
    return { type: 'ptext', id: w.id, at: [Math.round(w.sx), Math.round(w.sy)],
             content: w.content || '', w: w.ww || 220 };
  if (w.kind === 'checkbox')
    return { type: 'checkbox', id: w.id, at: [Math.round(w.sx), Math.round(w.sy)],
             caption: w.caption || '', checked: !!w.checked, script: w.script || '' };
  if (w.kind === 'button')
    return { type: 'button', id: w.id, at: [Math.round(w.sx), Math.round(w.sy)],
             caption: w.caption || '', script: w.script || '' };
  return null;
}
function renderWidgetEl(w) {
  var div = w.el;
  if (!div) return;
  if (w.kind === 'checkbox') {
    div.innerHTML = '<span style="font-size:17px;color:#24292f;">' +
      (w.checked ? '☑ ' : '☐ ') + escapeHtml(w.caption || '') + '</span>';
  } else if (w.kind === 'button') {
    div.innerHTML = '<span style="display:inline-block;background:#1a73e8;color:#fff;' +
      'border-radius:5px;padding:6px 16px;font-size:16px;white-space:nowrap;">' +
      escapeHtml(w.caption || '') + '</span>';
  } else {
    /* 文本框：固定宽度、高度自适应——文字换行时高度自动增长 */
    div.style.width = (w.ww || 220) + 'px';
    div.style.height = 'auto';
    div.innerHTML = '<span style="display:block;font-size:18px;color:#24292f;' +
      'white-space:pre-wrap;overflow-wrap:break-word;word-wrap:break-word;">' +
      escapeHtml(w.content || '').replace(/\n/g, '<br>') + '</span>';
    div.style.cursor = 'move';
  }
}
/* 新建控件并挂到浮层；opts: {id?, caption?, content?, checked?, script?, sx, sy} */
function addWidget(kind, opts, skipTrack) {
  var layer = widgetLayer();
  if (!layer) return null;
  opts = opts || {};
  var prefix = kind === 'checkbox' ? 'cb' : (kind === 'button' ? 'bt' : 'tx');
  var w = {
    id: opts.id || '',
    kind: kind,
    caption: opts.caption != null ? String(opts.caption) : (kind === 'button' ? '按钮' : '复选框'),
    content: opts.content != null ? String(opts.content) : '',
    checked: !!opts.checked,
    script: opts.script != null ? String(opts.script) : '',
    sx: Math.round(Number(opts.sx) || 0),
    sy: Math.round(Number(opts.sy) || 0),
    /* 文本框宽度（px）：固定宽度 + 高度自适应，换行时自动增高 */
    ww: kind === 'ptext' ? Math.min(1200, Math.max(80, Math.round(Number(opts.ww) || 220))) : 0,
    el: null
  };
  if (!w.id || widgetById(w.id) || nameTaken(w.id)) {
    do { widgetSeq++; w.id = prefix + widgetSeq; } while (widgetById(w.id) || nameTaken(w.id));
  } else {
    /* 恢复指定 id 时把序号推高，避免后续自动命名撞车 */
    var m = /^([a-z]+)(\d+)$/.exec(w.id);
    if (m && m[1] === prefix) widgetSeq = Math.max(widgetSeq, parseInt(m[2], 10));
  }
  var div = document.createElement('div');
  div.className = 'jxg-widget jxg-widget-' + kind;
  div.setAttribute('data-wid', w.id);
  div.style.cssText = 'position:absolute;left:' + w.sx + 'px;top:' + w.sy + 'px;' +
    'pointer-events:auto;cursor:pointer;user-select:none;-webkit-user-select:none;';
  w.el = div;
  renderWidgetEl(w);
  /* 按下：阻止冒泡到画板（不触发工具/平移）；拖拽移动，单击触发/选中
   * 注意：Chrome 真实鼠标输入先产生 pointerdown 再产生 mousedown，
   * 画板容器就是 #jxgbox 本身，两者都必须拦截，否则画板 down 处理会误触（如误开创建弹框） */
  ['pointerdown', 'touchstart'].forEach(function (tn) {
    div.addEventListener(tn, function (e) { e.stopPropagation(); }, { passive: true });
  });
  div.addEventListener('mousedown', function (e) {
    e.stopPropagation();
    if (w.editing) return;   // inline 编辑态：交还原生行为（文本选区/光标），不启动拖拽
    e.preventDefault();
    if (widgetPress) return;
    widgetPress = { w: w, cx0: e.clientX, cy0: e.clientY,
                    ox: w.sx, oy: w.sy, moved: false, pre: snapshotState() };
    function onMove(me) {
      var pr = widgetPress;
      if (!pr) return;
      var dx = me.clientX - pr.cx0, dy = me.clientY - pr.cy0;
      if (!pr.moved && Math.hypot(dx, dy) > 6) pr.moved = true;
      if (pr.moved) {
        w.sx = Math.round(pr.ox + dx); w.sy = Math.round(pr.oy + dy);
        div.style.left = w.sx + 'px'; div.style.top = w.sy + 'px';
      }
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      var pr = widgetPress; widgetPress = null;
      if (!pr) return;
      if (pr.moved) {
        pushPreDragHistory(pr.pre);   // 拖拽移动记一次撤销
        try { refreshObjectList(); } catch (e2) {}
      } else if (w.kind === 'ptext') {
        selectWidget(w);              // 文本框单击：进入选中态（显示边框）
      } else {
        deselectWidget();
        fireWidget(w);
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  div.addEventListener('dblclick', function (e) {
    e.stopPropagation();
    if (w.kind === 'ptext' && !w.editing) startWidgetEdit(w);  // 双击文本框：直接编辑
  });
  div.addEventListener('contextmenu', function (e) { e.stopPropagation(); });
  layer.appendChild(div);
  widgets.push(w);
  if (!skipTrack) {
    pushHistory();
    try { refreshObjectList(); } catch (e) {}
  }
  return w;
}
function makeTextBox(content, sx, sy, skipTrack, id, ww) {
  return addWidget('ptext', { id: id, content: content, sx: sx, sy: sy, ww: ww }, skipTrack);
}
function makeCheckbox(caption, sx, sy, checked, script, skipTrack, id) {
  return addWidget('checkbox', { id: id, caption: caption, sx: sx, sy: sy,
                                checked: checked, script: script }, skipTrack);
}
function makeButton(caption, sx, sy, script, skipTrack, id) {
  return addWidget('button', { id: id, caption: caption, sx: sx, sy: sy, script: script }, skipTrack);
}
function clearWidgets() {
  for (var i = 0; i < widgets.length; i++) {
    try { var el = widgets[i].el; if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
  }
  widgets = [];
  propWidget = null;
  selWidget = null;
}
function deleteWidget(w) {
  if (!w || !widgetById(w.id)) return;
  pushHistory();
  var i = widgets.indexOf(w);
  if (i >= 0) widgets.splice(i, 1);
  try { if (w.el && w.el.parentNode) w.el.parentNode.removeChild(w.el); } catch (e) {}
  if (propWidget === w) { propWidget = null; closePropPanel(); }
  try { refreshObjectList(); } catch (e) {}
  setStatus('已删除控件 ' + w.id + '。', true);
}
/* 静默移除控件（对话框取消等场景）：不记历史 */
function removeWidgetSilent(w) {
  if (!w) return;
  var i = widgets.indexOf(w);
  if (i >= 0) widgets.splice(i, 1);
  try { if (w.el && w.el.parentNode) w.el.parentNode.removeChild(w.el); } catch (e) {}
  if (selWidget === w) selWidget = null;
  if (propWidget === w) { propWidget = null; try { closePropPanel(); } catch (e2) {} }
  try { refreshObjectList(); } catch (e3) {}
}
/* 文本框选中态：单击选中显示边框；点画布空白/Esc/切工具取消选中 */
function selectWidget(w) {
  if (!w || !widgetById(w.id)) return;
  if (selWidget === w) return;
  deselectWidget();
  selWidget = w;
  if (w.el) w.el.classList.add('jxg-widget-selected');
  try { refreshObjectList(); } catch (e) {}
}
function deselectWidget() {
  var w = selWidget;
  selWidget = null;
  if (!w) return;
  if (w.editing) endWidgetEdit(w, false);   // 取消选中时若在编辑：按取消处理（还原）
  if (w.el) w.el.classList.remove('jxg-widget-selected');
  try { refreshObjectList(); } catch (e) {}
}
/* 文本框双击 inline 编辑：Enter 确认，Shift+Enter 换行，Esc 取消，失焦确认 */
function startWidgetEdit(w) {
  if (!w || w.kind !== 'ptext' || w.editing || !widgetById(w.id)) return;
  selectWidget(w);
  w.editing = true;
  w.editOrig = w.content || '';
  var div = w.el;
  div.classList.add('jxg-widget-editing');
  div.contentEditable = 'true';
  try { div.spellcheck = false; } catch (e) {}
  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); e.stopPropagation();
      endWidgetEdit(w, true);
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      endWidgetEdit(w, false);
    } else {
      e.stopPropagation();   // 编辑中的其它按键不冒泡（不触发画板快捷键）
    }
  }
  function onBlur() { endWidgetEdit(w, true); }
  w._editKey = onKey; w._editBlur = onBlur;
  div.addEventListener('keydown', onKey);
  div.addEventListener('blur', onBlur);
  try {
    div.focus();
    var r = document.createRange(); r.selectNodeContents(div);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  } catch (e2) {}
  setStatus('正在编辑文本框：Enter 确认，Shift+Enter 换行，Esc 取消。', true);
}
function endWidgetEdit(w, commit) {
  if (!w || !w.editing) return;
  w.editing = false;
  var div = w.el;
  if (w._editKey && div) div.removeEventListener('keydown', w._editKey);
  if (w._editBlur && div) div.removeEventListener('blur', w._editBlur);
  w._editKey = w._editBlur = null;
  if (div) {
    div.contentEditable = 'false';
    div.classList.remove('jxg-widget-editing');
    try { if (document.activeElement === div) div.blur(); } catch (e) {}
  }
  var txt = '';
  if (commit && div) {
    try { txt = (div.innerText || '').replace(/\s+$/, ''); } catch (e2) { txt = w.editOrig; }
  }
  if (commit && txt !== w.editOrig) {
    pushHistory();
    w.content = txt;
    setStatus('文本框已更新。', true);
  }
  w.editOrig = null;
  renderWidgetEl(w);
  if (div && selWidget === w) div.classList.add('jxg-widget-selected');
  try { refreshObjectList(); } catch (e3) {}
}
/* 控件创建弹框（仿 GeoGebra）：文本框用多行 textarea，复选框/按钮用单行 input。
 * kind: 'ptext' | 'checkbox' | 'button'；ok 回调 (ok:boolean, val:string)。
 * 对话框覆盖画板并阻止事件冒泡，打开期间画布点击不会误建控件。 */
function openWidgetDialog(kind, cb) {
  closeWidgetDialog();
  var box = document.getElementById('jxgbox');
  if (!box) { cb(false, ''); return; }
  widgetDlgPending = { kind: kind };
  var ov = document.createElement('div');
  ov.id = 'widgetDlgOverlay';
  ov.style.cssText = 'position:absolute;inset:0;background:rgba(31,35,40,.35);z-index:60;' +
    'display:flex;align-items:center;justify-content:center;';
  var isText = kind === 'ptext';
  var title = isText ? '文本框' : (kind === 'checkbox' ? '复选框' : '按钮');
  var field = isText
    ? '<textarea id="widgetDlgText" rows="3" style="width:100%;box-sizing:border-box;' +
      'font-size:14px;padding:6px 8px;border:1px solid #d0d7de;border-radius:6px;resize:vertical;" ' +
      'placeholder="输入文本内容（可多行，Shift+Enter 换行）"></textarea>'
    : '<input id="widgetDlgText" type="text" style="width:100%;box-sizing:border-box;' +
      'font-size:14px;padding:6px 8px;border:1px solid #d0d7de;border-radius:6px;" placeholder="输入标题">';
  ov.innerHTML = '<div style="background:#fff;border-radius:10px;padding:16px 18px;width:320px;' +
    'box-shadow:0 8px 28px rgba(0,0,0,.25);">' +
    '<div style="font-size:14px;font-weight:600;margin-bottom:10px;">' + title + '</div>' + field +
    '<div style="text-align:right;margin-top:12px;">' +
    '<button id="widgetDlgCancel" style="font-size:13px;padding:5px 14px;margin-right:8px;' +
    'border:1px solid #d0d7de;border-radius:6px;background:#fff;cursor:pointer;">取消</button>' +
    '<button id="widgetDlgOk" style="font-size:13px;padding:5px 14px;border:1px solid #1a73e8;' +
    'border-radius:6px;background:#1a73e8;color:#fff;cursor:pointer;">确定</button>' +
    '</div></div>';
  /* 阻断冒泡到画板：对话框内的点击/双击/指针按下不触发画板工具
   *（画板容器就是 #jxgbox 本身，pointerdown 也必须拦，否则会误开新的创建弹框） */
  ['pointerdown', 'touchstart'].forEach(function (tn) {
    ov.addEventListener(tn, function (e) { e.stopPropagation(); }, { passive: true });
  });
  ov.addEventListener('mousedown', function (e) { e.stopPropagation(); });
  ov.addEventListener('dblclick', function (e) { e.stopPropagation(); });
  ov.addEventListener('contextmenu', function (e) { e.stopPropagation(); });
  box.appendChild(ov);
  var input = ov.querySelector('#widgetDlgText');
  var done = false;
  function finish(ok) {
    if (done) return;
    done = true;
    var val = '';
    try { val = input.value; } catch (e) {}
    widgetDlgPending = null;
    closeWidgetDialog();
    cb(ok, val);
  }
  ov.querySelector('#widgetDlgOk').addEventListener('click', function () { finish(true); });
  ov.querySelector('#widgetDlgCancel').addEventListener('click', function () { finish(false); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (kind !== 'ptext' || !e.shiftKey)) { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
  });
  setTimeout(function () { try { input.focus(); } catch (e2) {} }, 0);
}
function closeWidgetDialog() {
  widgetDlgPending = null;
  var ov = document.getElementById('widgetDlgOverlay');
  if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
}
/* 控件脚本执行：JavaScript，形参 api
 *   api.show(name) / api.hide(name) / api.toggle(name) —— 按对象名显隐（如 "P1"）
 *   api.get(name)   —— 按对象名取 JSXGraph 对象（无则返回 null）
 *   api.value       —— 复选框切换后的新状态（true/false）；按钮点击时为 true
 *   api.self        —— 控件自身（widgets 注册表对象）；api.board —— 画板；api.status(msg) —— 状态栏提示
 * 可见性变更由调用方统一做一次历史快照（单步撤销）。
 */
function runWidgetScript(script, ctx) {
  var src = String(script || '').trim();
  if (!src) return;
  function byName(n) {
    for (var i = 0; i < createdIds.length; i++) {
      var o = board.objects[createdIds[i]];
      if (o && o.name === n) return o;
    }
    return null;
  }
  function applyVis(o, v) {
    if (!o || !board.objects[o.id]) return;
    try { o.setAttribute({ visible: v }); } catch (e) {}
  }
  var api = {
    board: board,
    self: (ctx && ctx.self) || null,
    value: !!(ctx && ctx.value),
    get: byName,
    show: function (n) { applyVis(byName(n), true); },
    hide: function (n) { applyVis(byName(n), false); },
    toggle: function (n) {
      var o = byName(n);
      if (!o) return;
      var vis = true;
      try { vis = o.getAttribute('visible') !== false; } catch (e) {}
      applyVis(o, !vis);
    },
    status: function (m) { setStatus(String(m), true); }
  };
  try {
    new Function('api', '"use strict";\n' + src)(api);
  } catch (e) {
    setStatus('脚本执行出错：' + e.message, false);
  }
  try { board.update(); } catch (e) {}
  try { refreshObjectList(); } catch (e) {}
}
function fireWidget(w) {
  if (!w || !widgetById(w.id)) return;
  if (w.kind === 'checkbox') {
    pushHistory();
    w.checked = !w.checked;
    renderWidgetEl(w);
    setStatus('复选框"' + w.caption + '"：' + (w.checked ? '已勾选' : '已取消勾选') + '。', true);
    runWidgetScript(w.script, { self: w, value: w.checked });
  } else if (w.kind === 'button') {
    if (!String(w.script || '').trim()) {
      setStatus('按钮"' + w.caption + '"没有设置点击脚本，请在属性面板中添加。', false);
      return;
    }
    pushHistory();
    runWidgetScript(w.script, { self: w, value: true });
  }
  try { refreshObjectList(); } catch (e) {}
}
/* 控件属性面板：标题/内容 + 事件脚本 + 删除（控件不进 board 对象体系，独立面板） */
function openWidgetPropPanel(w) {
  if (!w || !widgetById(w.id)) return;
  propWidget = w;
  propTarget = null;
  propBoardMode = false;
  var kindName = w.kind === 'checkbox' ? '复选框' : (w.kind === 'button' ? '按钮' : '文本框');
  document.getElementById('ppTitle').textContent = '属性：' + kindName + ' ' + w.id;
  var h = '';
  if (w.kind === 'ptext') {
    h += '<div class="prow"><span>文本内容</span><span class="ctl">' +
         '<input type="text" id="ppWText" value="' + escAttr(w.content || '') + '" style="width:150px;"></span></div>';
    h += '<div class="prow"><span>宽度(px)</span><span class="ctl">' +
         '<input type="number" id="ppWWidth" value="' + (w.ww || 220) + '" min="80" max="1200" step="10" ' +
         'title="文本框固定宽度；文字超出自动换行、高度自动增长" style="width:80px;"></span></div>';
  } else {
    h += '<div class="prow"><span>标题</span><span class="ctl">' +
         '<input type="text" id="ppWCaption" value="' + escAttr(w.caption || '') + '" style="width:150px;"></span></div>';
    if (w.kind === 'checkbox')
      h += '<div class="prow"><span>当前状态</span><span class="ctl">' + (w.checked ? '☑ 已勾选' : '☐ 未勾选') + '</span></div>';
    var wEvent = w.kind === 'checkbox' ? '切换时执行' : '点击时执行';
    h += '<div class="prow"><span>' + wEvent + '</span><span class="ctl">' +
         '<textarea id="ppWScript" rows="5" style="width:150px;font-family:Consolas,monospace;font-size:12px;" ' +
         'placeholder="JavaScript，如：api.toggle(&quot;P1&quot;);" ' +
         'title="脚本是 JavaScript，形参 api：show(name)/hide(name)/toggle(name) 按对象名显隐；get(name) 取对象；value 复选框新状态（按钮为 true）；self 控件自身，board 画板，status(msg) 状态栏提示">' +
         escAttr(w.script || '') + '</textarea></span></div>';
    h += '<div class="prow"><span></span><span class="ctl" style="font-size:11px;color:#777;">' +
         'api.show/hide/toggle(name) 显隐对象；<br>api.value 复选框新状态；api.status(msg) 提示</span></div>';
  }
  h += '<div class="prow"><span></span><span class="ctl">' +
       '<button id="ppWDelete" style="font-size:12px;padding:3px 10px;border:1px solid #d0d7de;' +
       'border-radius:4px;background:#fff;color:#cf222e;cursor:pointer;">删除控件</button></span></div>';
  h += '<div class="prow"><span></span><span class="ctl" style="font-size:11px;color:#777;">位置固定在屏幕上，不随缩放/平移</span></div>';
  document.getElementById('ppBody').innerHTML = h;
  var foot = document.querySelector('#proppanel .pfoot');
  if (foot) foot.style.display = 'none';
  var p = document.getElementById('proppanel');
  if (p) p.style.display = 'block';
  try { syncPropsBtn(); } catch (e) {}
  function applyW() {
    if (!widgetById(w.id)) return;
    pushHistory();
    var t = document.getElementById('ppWText');
    var c = document.getElementById('ppWCaption');
    var sc = document.getElementById('ppWScript');
    var wd = document.getElementById('ppWWidth');
    if (t && w.kind === 'ptext') w.content = t.value;
    if (wd && w.kind === 'ptext') {
      var nwv = Math.round(Number(wd.value) || 220);
      w.ww = Math.min(1200, Math.max(80, nwv));
      wd.value = w.ww;
    }
    if (c && w.kind !== 'ptext') w.caption = c.value;
    if (sc && w.kind !== 'ptext') w.script = sc.value;
    renderWidgetEl(w);
    try { refreshObjectList(); } catch (e) {}
  }
  ['ppWText', 'ppWCaption', 'ppWWidth'].forEach(function (id) {
    var elm = document.getElementById(id);
    if (elm) elm.addEventListener('change', applyW);
  });
  var scEl = document.getElementById('ppWScript');
  if (scEl) scEl.addEventListener('change', applyW);
  var del = document.getElementById('ppWDelete');
  if (del) del.addEventListener('click', function () { deleteWidget(w); });
}
/* 创建从动角点：D 在射线 V→A 上，且 ∠AVD = k × 基准角（逆时针；基准角为角度度量载体）。
 * 单向从动：改基准角/顶点/边点 → D 跟随；D 固定置灰，不可拖。 */
function makeAngleDrivenPoint(V, A, srcCarrier, k, name, skipTrack) {
  function thetaRad() {
    var base = measureCarrierValue(srcCarrier);
    return (isFinite(base) ? base : 0) * (Number(k) || 0) * Math.PI / 180;
  }
  var el = board.create('point', [
    function () {
      var th = thetaRad();
      var dx = A.X() - V.X(), dy = A.Y() - V.Y();
      return V.X() + dx * Math.cos(th) - dy * Math.sin(th);
    },
    function () {
      var th = thetaRad();
      var dx = A.X() - V.X(), dy = A.Y() - V.Y();
      return V.Y() + dx * Math.sin(th) + dy * Math.cos(th);
    }
  ], { name: name, fixed: true });
  el._defKind = 'angdrive';
  el._adVertex = V.id;
  el._adSide = A.id;
  el._adK = Number(k) || 0;
  el._adSrc = srcCarrier.id;
  el._adSrcName = srcCarrier.name || '';
  el._depIds = [V.id, A.id, srcCarrier.id];
  applyDrivenGray(el);
  if (!skipTrack) trackId(el.id);
  return el;
}
/* 步骤 → 可读的构造公式（GeoGebra 风格） */
function stepToFormulaText(s) {
  if (!s || !s.type) return '';
  var id = s.id || '';
  switch (s.type) {
    case 'point':
      if (s.polygon !== undefined) return id + ' = Point(' + s.polygon + '.边' + (Number(s.edge) + 1) + (s.pos !== undefined ? ', ' + ppNum(s.pos) : '') + ')';
      if (s.on) return id + ' = Point(' + s.on + (s.pos !== undefined ? ', ' + ppNum(s.pos) : '') + ')';
      return id + ' = (' + ppNum(s.coords[0]) + ', ' + ppNum(s.coords[1]) + ')';
    case 'midpoint': return id + ' = Midpoint(' + s.p1 + ', ' + s.p2 + ')';
    case 'tricenter':
      return id + ' = ' + ({ incenter: 'Incenter', circumcenter: 'Circumcenter', orthocenter: 'Orthocenter' }[s.kind] || '三角中心') +
             '(' + (s.points || []).join(', ') + ')';
    case 'perpendicular': return id + ' = 垂足(' + s.point + ', ' + s.line + ')';
    case 'mirrorpt': return id + ' = 镜像(' + s.of + ', ' + s.axis + ')';
    case 'rotate': return id + ' = 旋转(' + s.of + ', 中心' + s.center + ', ' + ppNum(s.angle) + '°)';
    case 'dilate': return id + ' = 位似(' + s.of + ', 中心' + s.center + ', 比' + ppNum(s.ratio) + ')';
    case 'exprpoint':
      /* 用户在定义行输入的原始表达式优先显示（如 Distance(P1,P2)*P1），不显示转换后的 x/y 计算式 */
      if (s.def) return id + ' = ' + s.def;
      return id + ' = (' + s.x + ', ' + s.y + ')';
    case 'vector': return id + ' = Vector(' + s.p1 + ', ' + s.p2 + ')';
    case 'vunit': return id + ' = UnitVector(' + s.of + ')';
    case 'vpoint': return id + ' = ' + s.of + ' + ' + ppNum(s.k) + '×' + s.by;
    case 'intersection':
      if (s.side)
        return id + ' = 交点(' + s.e1 + ', ' + s.e2 + ')〔' + s.side.point + ' 在 ' + s.side.line +
               ' 的' + (s.side.rel === 'opposite' ? '异' : '同') + '侧〕';
      return id + ' = 交点(' + s.e1 + ', ' + s.e2 + (s.index ? ', ' + (s.index + 1) : '') + ')';
    case 'segment': return id + ' = Segment(' + s.p1 + ', ' + s.p2 + ')';
    case 'perpseg': return id + ' = 垂线段(' + s.point + ', ' + s.p1 + ', ' + s.p2 + ')';
    case 'pseg': return id + ' = 平行线段(' + s.point + ', ' + s.ref + ')';
    case 'psegfree': return id + ' = 平行线段(' + s.point + ', ' + s.ref + ', 长' + s.len + ')';
    case 'line': return id + ' = Line(' + s.p1 + ', ' + s.p2 + ')';
    case 'ray': return id + ' = Ray(' + s.p1 + ', ' + s.p2 + ')';
    case 'pline': return id + ' = 平行线(' + s.point + ', ' + s.ref + ')';
    case 'pray': return id + ' = 平行射线(' + s.point + ', ' + s.ref + ')';
    case 'bisector': return id + ' = 角平分线(' + s.vertex + ', ' + s.p1 + ', ' + s.p2 + ')';
    case 'circle':
      if (s.through3) return id + ' = Circle(' + s.through3.join(', ') + ')';
      if (s.radius !== undefined) return id + ' = Circle(' + s.center + ', r = ' + ppNum(s.radius) + ')';
      return id + ' = Circle(' + s.center + ', ' + s.through + ')';
    case 'arc': return id + ' = Arc(' + s.center + ', ' + s.p1 + ', ' + s.p2 + ')';
    case 'arc3': return id + ' = 三点圆弧(' + s.through3.join(', ') + ')';
    case 'ellipse': return id + ' = Ellipse(' + s.f1 + ', ' + s.f2 + ', ' + s.p + ')';
    case 'hyperbola': return id + ' = Hyperbola(' + s.f1 + ', ' + s.f2 + ', ' + s.p + ')';
    case 'parabola': return id + ' = Parabola(' + s.focus + ', ' + s.directrix + ')';
    case 'conic': return id + ' = Conic(' + (s.through5 || []).join(', ') + ')';
    case 'polygon': return id + ' = Polygon(' + (s.points || []).join(', ') + ')';
    case 'regularpolygon':
      if (s.center !== undefined)
        return id + ' = 正' + s.n + '边形(中心' + s.center + ', ' + s.vertex + ')';
      return id + ' = 正' + s.n + '边形(' + s.p1 + ', ' + s.p2 + '〔逆时针〕)';
    case 'measure':
      if (s.kind === 'length') return id + ' = 长度(' + s.of + ')';
      return id + ' = ∠' + s.p1 + s.vertex + s.p2;
    case 'text': return id + ' = 文本(' + s.expr + ')';
    case 'angdrive': return id + ' = 从动角(顶点' + s.vertex + ', 边' + s.side + ', ' + ppNum(s.k) + '×' + s.src + ')';
  }
  return '';
}
/* 线/圆的解析方程（当前数值） */
function equationTextOf(o) {
  try {
    function ptOf(p) {
      var q = board.objects[(p && p.id) ? p.id : p];
      return (q && q.elType === 'point') ? q : null;
    }
    if (o.elType === 'line' || o.elType === 'segment') {
      var pr = o.parents || [];
      var p1 = ptOf(pr[0]), p2 = ptOf(pr[1]);
      if (!p1 || !p2) return '';
      var dx = p2.X() - p1.X(), dy = p2.Y() - p1.Y();
      if (Math.abs(dx) < 1e-9) return 'x = ' + ppNum(p1.X());
      var k = dy / dx, b = p1.Y() - k * p1.X();
      var kPart = (Number(ppNum(k)) === 1) ? '' : (Number(ppNum(k)) === -1 ? '-' : ppNum(k));
      var bN = Number(ppNum(b));
      if (bN === 0) return 'y = ' + kPart + 'x';
      return 'y = ' + kPart + 'x' + (bN > 0 ? ' + ' + ppNum(bN) : ' − ' + ppNum(Math.abs(bN)));
    }
    if (o.elType === 'circle' || o.elType === 'circumcircle') {
      var c = ptOf((o.parents || [])[0]);
      if (!c) return '';
      var r = (typeof o.Radius === 'function') ? o.Radius() : NaN;
      if (!isFinite(r)) return '';
      function mt(x) { var v = Number(ppNum(x)); return v < 0 ? ' + ' + ppNum(Math.abs(v)) : ' − ' + ppNum(v); }
      return '(x' + mt(c.X()) + ')² + (y' + mt(c.Y()) + ')² = ' + ppNum(r * r);
    }
  } catch (e) {}
  return '';
}
/* ============================================================
 * 点定义重定义（属性面板"定义"行回车应用）
 * 支持形式：(x, y) 自由点 / (表达式, 表达式) 表达式点 /
 *           Point(对象[, 比例]) / Point(多边形.边N[, 比例]) 约束点 / Midpoint(A, B)
 * 解析为步骤 patch（不含 id/style），由 applyPointRedefine 合并旧步骤保留样式。
 * ============================================================ */
/* 点算术中可用的函数返回类型表（与 MSRTEXT_FUNCS 一致）：n=数（可作标量因子）p=点 */
var PT_ARITH_FUNCS = {
  distance: 'n', x: 'n', y: 'n', length: 'n', area: 'n', radius: 'n', slope: 'n',
  abs: 'n', sqrt: 'n', floor: 'n', ceil: 'n', round: 'n', max: 'n', min: 'n', mod: 'n',
  sin: 'n', cos: 'n', tan: 'n', asin: 'n', acos: 'n', atan: 'n',
  midpoint: 'p', center: 'p', point: 'p'
};
/* 点算术表达式：P3+P17、P3-P17、2*P3、(A+B)/2、L1*A、Distance(P1,P2)*P1 等
 * 点视为位置向量，向量取其位移；结果为表达式点（从动）。 */
function parsePointArith(text) {
  var s0 = String(text).trim()
    .replace(/×/g, '*').replace(/·/g, '*').replace(/−/g, '-')
    .replace(/（/g, '(').replace(/）/g, ')');
  var toks = [];
  for (var ci = 0; ci < s0.length;) {
    var ch = s0[ci];
    if (/\s/.test(ch)) { ci++; continue; }
    if ('+-*/(),'.indexOf(ch) >= 0) { toks.push(ch); ci++; continue; }
    var mm = s0.slice(ci).match(/^(\d*\.?\d+|[A-Za-z_][A-Za-z0-9_]*)/);
    if (!mm) throw new Error('无法识别的字符 "' + ch + '"');
    toks.push(mm[1]); ci += mm[1].length;
  }
  var pos = 0;
  function peek() { return toks[pos]; }
  function next() { return toks[pos++]; }
  function node(kind, sx, sy) { return { k: kind, sx: sx, sy: sy }; }
  function atomName(nm) {
    if (/^\d*\.?\d+$/.test(nm)) return node('num', nm, null);
    var o = findObjByName(nm);
    if (o && o._measure) return node('num', nm, null);   /* 度量变量（L1、a1…）按标量 */
    if (o && o.elementClass === JXG.OBJECT_CLASS_POINT) return node('pt', 'x(' + nm + ')', 'y(' + nm + ')');
    if (o && o.elType === 'arrow') {
      var pr = o.parents || [];
      var a = board.objects[pr[0]], b = board.objects[pr[1]];
      if (!a || !b || !a.name || !b.name) throw new Error(nm + ' 的端点不可引用（用 A + k×' + nm + ' 形式）');
      return node('pt', '(x(' + b.name + ')-x(' + a.name + '))', '(y(' + b.name + ')-y(' + a.name + '))');
    }
    var mv = collectMeasureVars();
    if (nm in mv) return node('num', nm, null);
    throw new Error(nm + ' 未定义');
  }
  /* 函数调用参数：数字 / 度量变量 / 点 / 对象名 / 嵌套函数调用（各按原名序列化，动态重算） */
  function parseArgAtom() {
    var t = next();
    if (t === undefined) throw new Error('函数参数不完整');
    if (/^\d*\.?\d+$/.test(t)) return { k: 'num', src: t };
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) {
      if (peek() === '(') return parseCallNode(t);
      var o = findObjByName(t);
      if (o && o._measure) return { k: 'num', src: t };
      if (o && o.elementClass === JXG.OBJECT_CLASS_POINT) return { k: 'pt', src: t };
      if (o) return { k: 'o', src: t };
      var mv = collectMeasureVars();
      if (t in mv) return { k: 'num', src: t };
      throw new Error(t + ' 未定义');
    }
    throw new Error('函数参数 "' + t + '" 无法识别');
  }
  /* 函数调用：Fn(参数, …)；返回值按类型生成 num/pt 节点，原样序列化进表达式动态求值 */
  function parseCallNode(fnName) {
    var lc = String(fnName).toLowerCase();
    var ret = PT_ARITH_FUNCS[lc];
    if (!ret || !MSRTEXT_FUNCS[lc]) throw new Error('不支持的函数 "' + fnName + '"');
    next();   /* 吃掉 '(' */
    var args = [];
    if (peek() !== ')') {
      for (;;) {
        args.push(parseArgAtom());
        if (peek() === ',') { next(); continue; }
        break;
      }
    }
    if (next() !== ')') throw new Error('缺少右括号');
    var src = fnName + '(' + args.map(function (a) { return a.src; }).join(',') + ')';
    /* 试算校验：参数名/类型错误在这里给出明确提示 */
    try { evalMsrExpr(ret === 'n' ? src : 'x(' + src + ')'); }
    catch (e) { throw new Error(fnName + ' 调用无效：' + e.message); }
    var nd = ret === 'n' ? node('num', src, null) : node('pt', 'x(' + src + ')', 'y(' + src + ')');
    nd.src = src;   /* 作为嵌套函数参数时按原名序列化 */
    return nd;
  }
  function parseAtom() {
    var t = next();
    if (t === undefined) throw new Error('表达式不完整');
    if (t === '(') {
      var v = parseExpr();
      if (next() !== ')') throw new Error('缺少右括号');
      return v;
    }
    if (t === '-') { var u = parseAtom(); return node(u.k, '(-(' + u.sx + '))', u.sy ? '(-(' + u.sy + '))' : null); }
    if (t === '+') return parseAtom();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t) && peek() === '(') return parseCallNode(t);
    return atomName(t);
  }
  function join(a, op, b) { return '(' + a + op + b + ')'; }
  function parseTerm() {
    var v = parseAtom();
    for (;;) {
      var t = peek();
      if (t !== '*' && t !== '/') return v;
      next();
      var w = parseAtom();
      if (v.k === 'num' && w.k === 'num') v = node('num', join(v.sx, t, w.sx), null);
      else if (t === '*' && v.k === 'num' && w.k === 'pt') v = node('pt', join(v.sx, '*', w.sx), join(v.sx, '*', w.sy));
      else if (t === '*' && v.k === 'pt' && w.k === 'num') v = node('pt', join(v.sx, '*', w.sx), join(v.sy, '*', w.sx));
      else if (t === '/' && v.k === 'pt' && w.k === 'num') v = node('pt', join(v.sx, '/', w.sx), join(v.sy, '/', w.sx));
      else throw new Error('点/向量之间只能用 + - 连接，不能用 ' + t);
    }
  }
  function parseExpr() {
    var v = parseTerm();
    for (;;) {
      var t = peek();
      if (t !== '+' && t !== '-') return v;
      next();
      var w = parseTerm();
      if (v.k === 'pt' && w.k === 'pt') v = node('pt', join(v.sx, t, w.sx), join(v.sy, t, w.sy));
      else if (v.k === 'num' && w.k === 'num') v = node('num', join(v.sx, t, w.sx), null);
      else throw new Error('数字与点不能相加减');
    }
  }
  var root = parseExpr();
  if (pos !== toks.length) throw new Error('表达式末尾有多余内容');
  if (root.k !== 'pt') throw new Error('计算结果是数字，不是点');
  return { type: 'exprpoint', x: root.sx, y: root.sy };
}
function parsePointDefText(text, cur) {
  var t = String(text).trim();
  /* 允许带 "名称 = " 前缀（与定义行显示一致） */
  var meq = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/);
  if (meq) t = meq[2].trim();
  /* (a, b)：按括号深度做顶层逗号切分，避免误切 Distance(A,B) 这类函数参数 */
  /* 按顶层逗号拆成参数数组（忽略函数调用内的逗号） */
  function splitTopArgs(inner) {
    var out = [], depth = 0, last = 0;
    for (var i = 0; i < inner.length; i++) {
      var ch = inner[i];
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === ',' && depth === 0) { out.push(inner.slice(last, i)); last = i + 1; }
    }
    out.push(inner.slice(last));
    return out;
  }
  var m = t.match(/^\(([\s\S]+)\)$/);
  if (m) {
    var parts = splitTopArgs(m[1]);
    if (parts.length === 2) {
      var xs = parts[0].trim(), ys = parts[1].trim();
      var xn = Number(xs), yn = Number(ys);
      if (xs !== '' && ys !== '' && isFinite(xn) && isFinite(yn))
        return { type: 'point', coords: [xn, yn] };
      /* 非纯数字 → 表达式点；先做一次试算给出明确报错 */
      try { evalMsrExpr(xs); } catch (e) { throw new Error('x 表达式无效：' + e.message); }
      try { evalMsrExpr(ys); } catch (e) { throw new Error('y 表达式无效：' + e.message); }
      return { type: 'exprpoint', x: xs, y: ys };
    }
    /* 非两元组（如 (A+B)）→ 继续往下做点算术解析 */
  }
  /* Point(对象[, 比例]) / Point(多边形.边N[, 比例]) */
  m = t.match(/^Point\(([\s\S]+)\)$/i);
  if (m) {
    var args = splitTopArgs(m[1]);
    if (args.length > 2) throw new Error('Point 最多 2 个参数');
    var target = args[0].trim();
    var pos;
    if (args.length === 2) {
      var posTxt = args[1].trim();
      pos = Number(posTxt);
      if (!isFinite(pos)) {
        /* 非纯数字 → 按数表达式求值（度量变量/Distance/Length 等） */
        try { pos = evalMsrExpr(posTxt); }
        catch (e) { throw new Error('位置比例无效：' + e.message); }
      }
      if (!isFinite(pos)) throw new Error('位置比例必须是数字或数表达式');
      pos = Math.max(0, Math.min(1, pos));
    }
    var mp = target.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*[.．]\s*边\s*(\d+)$/);
    if (mp) {
      var poly = findObjByName(mp[1]);
      if (!poly || poly.elType !== 'polygon') throw new Error('多边形 ' + mp[1] + ' 不存在');
      var edge = parseInt(mp[2], 10) - 1;
      var bd = poly.borders && poly.borders[edge];
      if (!bd) throw new Error('多边形 ' + mp[1] + ' 没有第 ' + mp[2] + ' 条边');
      var stP = { type: 'point', polygon: mp[1], edge: edge, coords: [r4v(cur.X()), r4v(cur.Y())] };
      if (pos !== undefined) stP.pos = pos;
      return stP;
    }
    var ob = findObjByName(target);
    if (!ob) throw new Error('对象 ' + target + ' 不存在');
    var okTypes = ['line', 'segment', 'ray', 'circle', 'circumcircle', 'arc', 'ellipse', 'hyperbola', 'parabola'];
    if (okTypes.indexOf(ob.elType) < 0) throw new Error(target + ' 不是可作约束的曲线对象');
    var st = { type: 'point', on: target, coords: [r4v(cur.X()), r4v(cur.Y())] };
    if (pos !== undefined) st.pos = pos;
    return st;
  }
  /* Midpoint(A, B) */
  m = t.match(/^Midpoint\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/i);
  if (m) {
    var a = findObjByName(m[1]), b = findObjByName(m[2]);
    if (!a || a.elementClass !== JXG.OBJECT_CLASS_POINT) throw new Error(m[1] + ' 不是点');
    if (!b || b.elementClass !== JXG.OBJECT_CLASS_POINT) throw new Error(m[2] + ' 不是点');
    return { type: 'midpoint', p1: m[1], p2: m[2] };
  }
  /* B（单个点名字）：跟随该点的从动点（对齐 GeoGebra 的 B = A） */
  m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)$/);
  if (m) {
    var ali = findObjByName(m[1]);
    if (!ali || ali.elementClass !== JXG.OBJECT_CLASS_POINT) throw new Error(m[1] + ' 不是点');
    return { type: 'exprpoint', x: 'x(' + m[1] + ')', y: 'y(' + m[1] + ')' };
  }
  /* A + v / A + k*v：点沿向量平移（v 为 vector/vunit 向量对象，k 可为数表达式） */
  m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\+\s*([\s\S]+)$/);
  if (m) {
    var basePt = findObjByName(m[1]);
    if (!basePt || basePt.elementClass !== JXG.OBJECT_CLASS_POINT) throw new Error(m[1] + ' 不是点');
    /* 显示公式用 × 与 −（U+00D7/U+2212），解析前归一化为 ASCII 的 * 和 - */
    var rhs = m[2].trim().replace(/×/g, '*').replace(/·/g, '*').replace(/−/g, '-'), kTxt = '1', vecName = '';
    var star = rhs.lastIndexOf('*');
    if (star >= 0) { kTxt = rhs.slice(0, star).trim(); vecName = rhs.slice(star + 1).trim(); }
    else vecName = rhs;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(vecName)) throw new Error('向量名 "' + vecName + '" 无效（先定义向量，再写 A + k×向量）');
    var vecObj = findObjByName(vecName);
    if (!vecObj) throw new Error(vecName + ' 未定义');
    if (vecObj.elType !== 'arrow') {
      /* 右侧是点/数字等 → 按点算术解析（P3+P17、A+2.5*B、(A+B)/2 等） */
      return parsePointArith(t);
    }
    var kv = Number(kTxt);
    if (!isFinite(kv)) {
      try { kv = evalMsrExpr(kTxt); } catch (e) { throw new Error('倍数无效：' + e.message); }
    }
    if (!isFinite(kv)) throw new Error('倍数必须是数字或数表达式');
    return { type: 'vpoint', of: m[1], by: vecName, k: kv };
  }
  /* 其余含运算符的形式按点算术解析：P3-P17、2*P3、(A+B)/2 等 */
  if (/[-*/()]/.test(t)) return parsePointArith(t);
  throw new Error('无法识别的定义形式');
}
/* 向量定义重定义（属性面板"定义"行）：Vector(A, B) / UnitVector(向量/线段/直线) */
function parseVectorDefText(text) {
  var t = String(text).trim();
  var meq = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/);
  if (meq) t = meq[2].trim();
  var m = t.match(/^Vector\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/i);
  if (m) {
    var a = findObjByName(m[1]), b = findObjByName(m[2]);
    if (!a || a.elementClass !== JXG.OBJECT_CLASS_POINT) throw new Error(m[1] + ' 不是点');
    if (!b || b.elementClass !== JXG.OBJECT_CLASS_POINT) throw new Error(m[2] + ' 不是点');
    return { type: 'vector', p1: m[1], p2: m[2] };
  }
  m = t.match(/^UnitVector\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/i);
  if (m) {
    var o = findObjByName(m[1]);
    if (!o) throw new Error('对象 ' + m[1] + ' 不存在');
    if (o.elType !== 'arrow' && o.elType !== 'segment' && o.elType !== 'line')
      throw new Error(m[1] + ' 不是向量/线段/直线');
    return { type: 'vunit', of: m[1] };
  }
  throw new Error('无法识别的定义形式（向量支持 Vector(A, B) / UnitVector(向量/线段/直线)）');
}
/* 属性面板"定义"行回车：重定义当前点（全量重建，保留 id/样式，可撤销） */
function applyPointRedefine(text) {
  var o = propTarget;
  if (!o || Array.isArray(o) || !board.objects[o.id]) return;
  var name = o.name;
  var patch;
  try { patch = (o.elType === 'arrow') ? parseVectorDefText(text) : parsePointDefText(text, o); }
  catch (e) { setStatus('定义无效：' + e.message, false); return; }
  /* 表达式点禁止引用自身（坐标函数会自递归） */
  if (patch.type === 'exprpoint') {
    var selfRe = new RegExp('\\b' + name + '\\b');
    if (selfRe.test(patch.x) || selfRe.test(patch.y)) {
      setStatus('定义无效：表达式不能引用自身 ' + name + '。', false);
      return;
    }
  }
  var steps = snapshotState().steps;
  var idx = -1;
  for (var i = 0; i < steps.length; i++) if (steps[i].id === name) { idx = i; break; }
  if (idx < 0) { setStatus('未找到 ' + name + ' 的步骤。', false); return; }
  var old = steps[idx];
  var ns = { id: name };
  for (var k in old) if (k === 'style' || k === 'visible') ns[k] = old[k];
  for (var k2 in patch) ns[k2] = patch[k2];
  /* 自由点改成计算/约束定义后，旧自由色不再适用：去掉保留颜色，
   * 让渲染时的从动灰 / 约束蓝生效（其余样式如字号保留） */
  var DRIVEN_STEP_TYPES = { exprpoint: 1, midpoint: 1, rotate: 1, dilate: 1, mirrorpt: 1,
                            vpoint: 1, sidepick: 1, angdrive: 1, footpoint: 1, tricenter: 1, intersection: 1 };
  if (ns.style && (DRIVEN_STEP_TYPES[patch.type] || patch.type === 'point')) {
    delete ns.style.c;
    delete ns.style.fc;
  }
  /* 表达式点：记录用户在定义行输入的原始文本，属性面板/步骤列表按原文显示 */
  if (patch.type === 'exprpoint') {
    var rawDef = String(text).trim();
    var dmeq = rawDef.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/);
    if (dmeq) rawDef = dmeq[2].trim();
    if (rawDef) ns.def = rawDef;
  }
  steps[idx] = ns;
  pushHistory();
  try {
    renderSteps(steps);
  } catch (e) {
    steps[idx] = old;
    try { renderSteps(steps); } catch (e2) {}
    setStatus('重定义失败：' + e.message, false);
    return;
  }
  /* 重建后按名称找回新对象，保持选中与属性面板 */
  var nb = findObjByName(name);
  if (nb) {
    try { selectObject(nb); } catch (e) {}
    /* 重建期间 refreshPropDynamic 可能已因旧对象消失关掉面板，这里整体重开（含 display） */
    openPropPanel(nb);
  }
  setStatus('已重定义 ' + name + '。', true);
}
function r4v(v) { return Math.round(v * 10000) / 10000; }
function renderPropPanel() {
  if (propBoardMode) { renderBoardPropPanel(); return; }
  var foot = document.querySelector('#proppanel .pfoot');
  if (foot) foot.style.display = '';
  var list = propTargetList();
  if (!list.length) { closePropPanel(); return; }
  var multi = list.length > 1;
  var o = list[0];
  var v = o.visProp || {};
  var isPt = o.elementClass === JXG.OBJECT_CLASS_POINT;
  var isClosed = (o.elType === 'circle' || o.elType === 'polygon' || o.elType === 'circumcircle');
  var isPtEl = function (x) { return x.elementClass === JXG.OBJECT_CLASS_POINT; };
  var isClsEl = function (x) { return x.elType === 'circle' || x.elType === 'polygon' || x.elType === 'circumcircle'; };
  var allLine = list.every(function (x) { return !isPtEl(x); });
  var allClosed = list.every(isClsEl);
  document.getElementById('ppTitle').textContent = multi
    ? '属性：已选 ' + list.length + ' 个对象'
    : '属性：' + (o.name || o.elType);
  var h = '';
  /* 多选取值：全部一致取该值；存在差异返回 mixed（界面对应项标注“多值”等待用户选择） */
  function eachVal(getter) {
    var vals = list.map(getter);
    var same = vals.every(function (x) { return x === vals[0]; });
    return { val: vals[0], mixed: !same };
  }
  /* 选中高亮（红色）会覆盖 visProp 样式：处于高亮态时读 highlightOn 保存的 _selBackup 原值 */
  function rawVis(x) { return (x && x._selBackup) ? x._selBackup : null; }
  function colorOf(x) {
    var b = rawVis(x);
    var c = b ? b.strokeColor : x.visProp.strokecolor;
    return normColor(c) || '#000000';
  }
  function dashOf(x) { return x.visProp.dash || 0; }
  function widthOf(x) {
    var b = rawVis(x);
    if (b && b.strokeWidth !== undefined && b.strokeWidth !== null) return b.strokeWidth;
    return x.visProp.strokewidth || 2;
  }
  function fillOf(x) {
    var b = rawVis(x);
    var fc = normColor(b ? b.fillColor : x.visProp.fillcolor);
    return (fc && fc !== 'none') ? fc : '';
  }
  function fillOpOf(x) { return Math.round(Number(x.visProp.fillopacity || 0) * 100); }
  function fontSizeOf(x) {
    try {
      if (x.label && x.label.rendNode && x.label.rendNode.style) {
        var pf = parseInt(x.label.rendNode.style.fontSize || '', 10);
        if (isFinite(pf)) return pf;
      }
    } catch (e) {}
    return 12;
  }
  function fontFamOf(x) {
    try {
      if (x.label && x.label.rendNode && x.label.rendNode.style) {
        return x.label.rendNode.style.fontFamily || '';
      }
    } catch (e) {}
    return '';
  }
  function colorRow(label, id, val, mixed) {
    return '<div class="prow"><span>' + label + '</span><span class="ctl">' +
           '<input type="color" id="' + id + '" value="' + escAttr(val || '#000000') + '">' +
           (mixed ? '<span class="pval">多值</span>' : '') + '</span></div>';
  }
  /* 填充色专用行：比 colorRow 多一个“透明”勾选（fillColor 'none'），
   * 勾选时禁用取色器，取消勾选恢复取色器当前值 */
  function fillRow(label, id, val, mixed) {
    var none = !val;   // fillOf 对 'none'/无填充返回 ''
    return '<div class="prow"><span>' + label + '</span><span class="ctl">' +
           '<label style="display:inline-flex;align-items:center;gap:3px;font-size:12px;white-space:nowrap;">' +
           '<input type="checkbox" id="' + id + 'None"' + (!mixed && none ? ' checked' : '') + '>透明</label>' +
           '<input type="color" id="' + id + '" value="' + escAttr(val || '#f0e442') + '"' +
           (!mixed && none ? ' disabled' : '') + '>' +
           (mixed ? '<span class="pval">多值</span>' : '') + '</span></div>';
  }
  function dashRow(id, val, mixed) {
    var opts = (mixed ? '<option value="">（多值）</option>' : '') + DASH_NAMES.map(function (n, i) {
      return '<option value="' + i + '"' + (!mixed && i === val ? ' selected' : '') + '>' + n + '</option>';
    }).join('');
    return '<div class="prow"><span>线型</span><span class="ctl"><select id="' + id + '">' + opts + '</select></span></div>';
  }
  function rangeRow(label, id, valId, val, min, max, step, suffix, mixed) {
    return '<div class="prow"><span>' + label + '</span><span class="ctl">' +
           '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '">' +
           '<span class="pval" id="' + valId + '">' + (mixed ? '多值' : val + (suffix || '')) + '</span></span></div>';
  }
  /* 名称（可改，自动重写全部引用）—— 仅单对象，多选时不显示 */
  if (!multi) h += '<div class="prow"><span>名称</span><span class="ctl">' +
       '<input type="text" id="ppName" value="' + escAttr(o.name || '') + '" ' +
       'style="width:104px;font-size:12px;padding:3px 6px;border:1px solid #d0d7de;border-radius:4px;">' +
       '<button id="ppNameOk" title="确定改名" ' +
       'style="font-size:12px;padding:3px 8px;border:1px solid #d0d7de;border-radius:4px;background:#f6f8fa;cursor:pointer;">✓</button>' +
       '</span></div>';
  /* 定义 / 公式 */
  var ftxt = '';
  try { ftxt = stepToFormulaText(objectToStepRaw(o)); } catch (e) {}
  if (!multi && ftxt) {
    if (o.elementClass === JXG.OBJECT_CLASS_POINT || o.elType === 'arrow') {
      /* 点/向量：定义可编辑（重定义），回车应用 */
      h += '<div class="prow" style="align-items:flex-start;"><span>定义</span>' +
           '<span class="ctl"><input type="text" id="ppDefIn" value="' + escAttr(ftxt) + '" ' +
           'title="回车重定义：点为 (x, y) / (表达式, 表达式) / Point(对象[, 比例]) / Point(多边形.边N[, 比例]) / Midpoint(A, B) / A + k×向量 / B（跟随点）/ 点算术（P3+P17、P3-P17、2*P3、(A+B)/2、Distance(P1,P2)*P1 等，函数可作标量或点参与运算）；向量为 Vector(A, B) / UnitVector(向量/线段/直线)" ' +
           'style="width:168px;font-size:12px;padding:3px 6px;border:1px solid #d0d7de;border-radius:4px;text-align:right;"></span></div>';
    } else {
      h += '<div class="prow" style="align-items:flex-start;"><span>定义</span>' +
           '<span class="ctl" id="ppDef" style="max-width:160px;word-break:break-all;text-align:right;color:#24292f;">' +
           escHtml(ftxt) + '</span></div>';
    }
  }
  /* 方程（直线/圆） */
  var eqt = equationTextOf(o);
  if (!multi && eqt) {
    h += '<div class="prow" style="align-items:flex-start;"><span>方程</span>' +
         '<span class="ctl" id="ppEq" style="max-width:160px;word-break:break-all;text-align:right;color:#24292f;">' +
         escHtml(eqt) + '</span></div>';
  }
  /* 度量变量：只读"值"行（refreshPropDynamic 里随画板更新刷新） */
  if (!multi && o._measure) {
    var mv0 = measureCarrierValue(o);
    h += '<div class="prow"><span>值</span>' +
         '<span class="ctl" id="ppMsrVal" style="text-align:right;color:#24292f;">' +
         (o._measure.kind === 'angle' ? ppNum(mv0) + '°' : ppNum(mv0)) + '</span></div>';
  }
  /* 表达式文本：值（动态）+ 可编辑表达式 */
  if (!multi && o._isExprText) {
    var tv0 = NaN;
    try { tv0 = evalMsrExpr(o._exprText); } catch (e) {}
    h += '<div class="prow"><span>值</span>' +
         '<span class="ctl" id="ppMsrVal" style="text-align:right;color:#24292f;">' +
         (isFinite(tv0) ? ppNum(tv0) : '?') + '</span></div>';
    h += '<div class="prow"><span>表达式</span><span class="ctl">' +
         '<input type="text" id="ppExpr" value="' + escAttr(o._exprText) + '" ' +
         'style="width:150px;font-size:12px;padding:3px 6px;border:1px solid #d0d7de;border-radius:4px;">' +
         '</span></div>';
  }
  /* 边上约束点：位置（比例 0~1 或距首端点距离）—— 仅当滑动对象为线段 */
  if (!multi && o._defKind === 'glider') {
    var slideEl = null;
    try { slideEl = board.objects[o._onId]; } catch (e) {}
    if (slideEl && slideEl.elType === 'segment') {
      var posMode = o._posMode || 'ratio';
      var L0 = measureLenOf(slideEl);
      var posVal = posMode === 'ratio' ? ppNum(o.position)
                                       : (isFinite(L0) ? ppNum(o.position * L0) : '');
      h += '<div class="prow"><span>位置</span><span class="ctl">' +
           '<select id="ppPosMode" style="font-size:12px;">' +
           '<option value="ratio"' + (posMode === 'ratio' ? ' selected' : '') + '>比例</option>' +
           '<option value="dist"' + (posMode === 'dist' ? ' selected' : '') + '>距起点</option>' +
           '</select>' +
           '<input type="text" id="ppPos" value="' + escAttr(posVal) + '" ' +
           'title="比例 0~1（0=首端点，1=尾端点）或距首端点距离，支持表达式（如 L1/Length(s)、Distance(A,B)/3），回车应用" ' +
           'style="width:80px;font-size:12px;padding:3px 6px;border:1px solid #d0d7de;border-radius:4px;">' +
           '</span></div>';
    }
  }
  /* 共同样式属性：颜色所有对象都有；线型/线宽仅全部为非点对象时显示；
   * 填充仅全部为封闭图形时显示；值不一致的项标注“多值”，用户改动后统一应用到全部对象 */
  var colM = multi ? eachVal(colorOf) : { val: colorOf(o), mixed: false };
  var colorLabel = multi ? (allClosed ? '边框颜色' : '颜色')
                         : (isClosed || o.elType === 'polygon' ? '边框颜色' : '颜色');
  h += colorRow(colorLabel, 'ppColor', colM.val, colM.mixed);
  if (multi ? allLine : !isPt) {
    var dM = multi ? eachVal(dashOf) : { val: dashOf(o), mixed: false };
    h += dashRow('ppDash', dM.val, dM.mixed);
    var wM = multi ? eachVal(widthOf) : { val: widthOf(o), mixed: false };
    h += rangeRow('线宽', 'ppWidth', 'ppWidthV', wM.val, 1, 8, 1, '', wM.mixed);
  }
  if (multi ? allClosed : isClosed) {
    var fM = multi ? eachVal(fillOf) : { val: fillOf(o), mixed: false };
    h += fillRow('填充色', 'ppFill', fM.val, fM.mixed);
    var foM = multi ? eachVal(fillOpOf) : { val: fillOpOf(o), mixed: false };
    h += rangeRow('填充不透明度', 'ppFillOp', 'ppFillOpV', foM.val, 0, 100, 5, '%', foM.mixed);
  }
  /* 标签字体 */
  var fsM = multi ? eachVal(fontSizeOf) : { val: fontSizeOf(o), mixed: false };
  h += rangeRow('标签字号', 'ppFontSize', 'ppFontSizeV', fsM.val, 10, 32, 1, '', fsM.mixed);
  var ffM = multi ? eachVal(fontFamOf) : { val: fontFamOf(o), mixed: false };
  var fopts = (ffM.mixed ? '<option value="">（多值）</option>' : '') + FONT_NAMES.map(function (f) {
    return '<option value="' + escAttr(f[0]) + '"' + (!ffM.mixed && f[0] === ffM.val ? ' selected' : '') + '>' + f[1] + '</option>';
  }).join('');
  h += '<div class="prow"><span>标签字体</span><span class="ctl"><select id="ppFont">' + fopts + '</select></span></div>';
  /* 主动点活动周期 */
  if (!multi && o._defKind === 'glider') {
    var per = (typeof o._period === 'number' && o._period > 0) ? o._period : TRACE_DEFAULT_PERIOD;
    h += '<div class="prow"><span>活动周期（秒）</span><span class="ctl">' +
         '<input type="number" id="ppPeriod" min="0.5" max="120" step="0.5" value="' + per + '"></span></div>';
  }
  document.getElementById('ppBody').innerHTML = h;
  /* 接线：input 实时预览，change/首次 input 时记一次历史（一次打开记一次撤销） */
  function markHist() { if (!propHistPushed) { pushHistory(); propHistPushed = true; } }
  function readAndApply() {
    function took(id) { return !!touchedFields[id]; }
    var st = {};
    var c = document.getElementById('ppColor');
    if (c && took('ppColor')) st.c = c.value;
    var d = document.getElementById('ppDash');
    if (d && took('ppDash')) st.d = parseInt(d.value, 10);
    var w = document.getElementById('ppWidth');
    if (w && took('ppWidth')) { st.w = parseInt(w.value, 10); document.getElementById('ppWidthV').textContent = w.value; }
    var fc2 = document.getElementById('ppFill');
    var fcNone = document.getElementById('ppFillNone');
    if (fcNone && took('ppFillNone')) {
      /* 勾选=透明（fillColor 'none'）；取消勾选=取色器当前值 */
      st.fc = fcNone.checked ? 'none' : (fc2 ? fc2.value : 'none');
      if (fc2) fc2.disabled = fcNone.checked;
    } else if (fc2 && took('ppFill')) {
      /* 拖取色器时若勾着透明，先取消勾选再上色 */
      if (fcNone && fcNone.checked) { fcNone.checked = false; fc2.disabled = false; }
      st.fc = fc2.value;
    }
    var fo2 = document.getElementById('ppFillOp');
    if (fo2 && took('ppFillOp')) { st.fo = parseInt(fo2.value, 10) / 100; document.getElementById('ppFillOpV').textContent = fo2.value + '%'; }
    var fz = document.getElementById('ppFontSize');
    if (fz && took('ppFontSize')) { st.fs = parseInt(fz.value, 10); document.getElementById('ppFontSizeV').textContent = fz.value; }
    var ff2 = document.getElementById('ppFont');
    if (ff2 && took('ppFont')) st.ff = ff2.value;
    var pp = document.getElementById('ppPeriod');
    if (pp && took('ppPeriod') && propTarget && !Array.isArray(propTarget)) {
      var pv = parseFloat(pp.value);
      if (isFinite(pv) && pv >= 0.5 && pv <= 120) propTarget._period = pv;
    }
    if (!Object.keys(st).length) return;
    /* 若对象正被选中：先卸下红色高亮再改样式，避免取消选中时把新样式还原 */
    var list = propTargetList();
    list.forEach(function (tg) {
      var wasSel = isSelected(tg);
      if (wasSel) highlightOff(tg);
      applyStyle(tg, st);
      if (wasSel) highlightOn(tg);
    });
    board.update();
  }
  ['ppColor', 'ppDash', 'ppWidth', 'ppFill', 'ppFillNone', 'ppFillOp', 'ppFontSize', 'ppFont', 'ppPeriod'].forEach(function (id) {
    var elm = document.getElementById(id);
    if (!elm) return;
    elm.addEventListener('input', function () { touchedFields[id] = true; preFieldHook(id); markHist(); readAndApply(); });
    elm.addEventListener('change', function () { touchedFields[id] = true; preFieldHook(id); markHist(); readAndApply(); });
  });
  /* 控件字段：文本框内容 / 复选框·按钮标题 / 事件脚本（change 时记一次历史并应用） */
  /* 取色器变动时若勾着“透明”：先取消勾选并启用取色器，
   * 否则 readAndApply 会走 ppFillNone 分支继续写 'none' */
  function preFieldHook(id) {
    if (id !== 'ppFill') return;
    var n = document.getElementById('ppFillNone');
    var pc = document.getElementById('ppFill');
    if (n && n.checked && pc) { n.checked = false; pc.disabled = false; }
  }
  /* 名称改名：回车或 ✓ 应用；成功后面板重挂到新对象（重建后旧引用失效） */
  var ppName = document.getElementById('ppName');
  var ppNameOk = document.getElementById('ppNameOk');
  function applyName() {
    if (!propTarget) return;
    var nn = ppName.value.trim();
    var err = renameObjectTo(propTarget, nn);
    if (err) { setStatus(err, false); return; }
    try { refreshObjectList(); } catch (e) {}
    var nb = null;
    if (nn) {
      for (var fid in board.objects) {
        if (board.objects[fid].name === nn) { nb = board.objects[fid]; break; }
      }
    }
    if (nb) { propTarget = nb; renderPropPanel(); }
    else closePropPanel();
  }
  if (ppNameOk) ppNameOk.addEventListener('click', function (ev) { ev.stopPropagation(); applyName(); });
  if (ppName) {
    ppName.addEventListener('keydown', function (ev) {
      ev.stopPropagation();
      if (ev.key === 'Enter') applyName();
    });
    ppName.addEventListener('click', function (ev) { ev.stopPropagation(); });
  }
  /* 表达式文本：回车应用新表达式（记一次历史，重扫级联依赖） */
  var ppExpr = document.getElementById('ppExpr');
  if (ppExpr) {
    ppExpr.addEventListener('keydown', function (ev) {
      ev.stopPropagation();
      if (ev.key !== 'Enter') return;
      var v = ppExpr.value.trim();
      if (!v) { setStatus('表达式不能为空。', false); return; }
      if (propTarget && propTarget._isExprText) {
        markHist();
        propTarget._exprText = v;
        rescanTextDeps(propTarget);
        try { board.update(); } catch (e) {}
        try { refreshObjectList(); } catch (e) {}
        setStatus('已更新表达式为 "' + v + '"。', true);
      }
    });
    ppExpr.addEventListener('click', function (ev) { ev.stopPropagation(); });
  }
  /* 点定义重定义：回车解析并重建该点的构造步骤 */
  var ppDefIn = document.getElementById('ppDefIn');
  if (ppDefIn) {
    ppDefIn.addEventListener('keydown', function (ev) {
      ev.stopPropagation();
      if (ev.key !== 'Enter') return;
      applyPointRedefine(ppDefIn.value);
    });
    ppDefIn.addEventListener('click', function (ev) { ev.stopPropagation(); });
  }
  /* 边上约束点位置：回车应用（比例 → 0~1；距起点 → 按当前长度换算成比例存储） */
  var ppPosMode = document.getElementById('ppPosMode');
  if (ppPosMode) ppPosMode.addEventListener('change', function () {
    if (propTarget && !Array.isArray(propTarget)) propTarget._posMode = this.value;
    renderPropPanel();
  });
  var ppPos = document.getElementById('ppPos');
  if (ppPos) {
    ppPos.addEventListener('keydown', function (ev) {
      ev.stopPropagation();
      if (ev.key !== 'Enter') return;
      var o = propTarget;
      if (!o || Array.isArray(o) || !board.objects[o.id]) return;
      var slideEl = board.objects[o._onId];
      if (!slideEl || slideEl.elType !== 'segment') return;
      /* 支持表达式：比例/距起点都按"数表达式"求值（度量变量、Distance、Length 等） */
      var v;
      try { v = evalMsrExpr(ppPos.value); }
      catch (e) { setStatus('位置表达式无效：' + e.message, false); return; }
      if (!isFinite(v)) { setStatus('位置需要是一个有限的数。', false); return; }
      var t, L;
      if ((o._posMode || 'ratio') === 'ratio') {
        if (v < 0 || v > 1) { setStatus('比例需要在 0~1 之间。', false); return; }
        t = v;
      } else {
        L = measureLenOf(slideEl);
        if (!isFinite(L) || L <= 0) { setStatus('无法计算线段长度。', false); return; }
        if (v < 0 || v > L) { setStatus('距离需要在 0~' + ppNum(L) + ' 之间。', false); return; }
        t = v / L;
      }
      pushHistory();
      o.position = Math.max(0, Math.min(1, t));
      o.needsUpdateFromParent = true;   // 强制从 position 重算坐标（否则可能被 updateGlider 从旧坐标覆盖）
      try { board.update(); } catch (e) {}
      renderPropPanel();
      setStatus('已设置 ' + o.name + ' 在线段上的位置。', true);
    });
    ppPos.addEventListener('click', function (ev) { ev.stopPropagation(); });
  }
}
document.getElementById('ppClose').addEventListener('click', closePropPanel);
/* 面板打开期间：画板更新后 300ms 节流刷新 定义/方程 数值（名称输入中不刷新） */
var lastPropRefresh = 0;
function refreshPropDynamic() {
  var p = document.getElementById('proppanel');
  if (!p || p.style.display === 'none') return;
  if (Array.isArray(propTarget)) {
    /* 多选：目标被删除（删除/级联/撤销）后过滤或关闭 */
    var live = propTarget.filter(function (o) { return o && board.objects[o.id]; });
    if (!live.length) { closePropPanel(); return; }
    if (live.length !== propTarget.length) { propTarget = live; renderPropPanel(); }
    return;   // 多选无定义/方程行，无需刷新
  }
  if (!propTarget) return;
  if (!board.objects[propTarget.id]) { closePropPanel(); return; }
  var ae = document.activeElement;
  if (ae && ae.id === 'ppName') return;
  var d = document.getElementById('ppDef');
  if (d) {
    var ftxt = '';
    try { ftxt = stepToFormulaText(objectToStepRaw(propTarget)); } catch (e) {}
    d.textContent = ftxt;
  }
  /* 点的可编辑定义行：未输入时跟随画板刷新 */
  var din = document.getElementById('ppDefIn');
  if (din && document.activeElement !== din && board.objects[propTarget.id]) {
    var ftxt2 = '';
    try { ftxt2 = stepToFormulaText(objectToStepRaw(propTarget)); } catch (e) {}
    if (ftxt2) din.value = ftxt2;
  }
  var q = document.getElementById('ppEq');
  if (q) q.textContent = equationTextOf(propTarget);
  /* 度量/表达式文本的"值"行随画板更新刷新 */
  var mv = document.getElementById('ppMsrVal');
  if (mv) {
    var vv = NaN;
    try {
      vv = propTarget._measure ? measureCarrierValue(propTarget) : evalMsrExpr(propTarget._exprText);
    } catch (e) {}
    mv.textContent = (propTarget._measure && propTarget._measure.kind === 'angle')
      ? (isFinite(vv) ? ppNum(vv) + '°' : '?')
      : (isFinite(vv) ? ppNum(vv) : '?');
  }
  /* 边上约束点的"位置"输入随画板更新刷新（输入框聚焦时不打扰） */
  var pp = document.getElementById('ppPos');
  if (pp && document.activeElement !== pp && propTarget && !Array.isArray(propTarget) &&
      propTarget._defKind === 'glider' && board.objects[propTarget._onId]) {
    var sl = board.objects[propTarget._onId];
    if (sl.elType === 'segment') {
      if ((propTarget._posMode || 'ratio') === 'ratio') pp.value = ppNum(propTarget.position);
      else {
        var LL = measureLenOf(sl);
        pp.value = isFinite(LL) ? ppNum(propTarget.position * LL) : '';
      }
    }
  }
}
board.on('update', function () {
  var now = Date.now();
  if (now - lastPropRefresh < 300) return;
  lastPropRefresh = now;
  try { refreshPropDynamic(); } catch (e) {}
});
document.getElementById('ppReset').addEventListener('click', function () {
  var list = propTargetList();
  if (!list.length) { closePropPanel(); return; }
  pushHistory();
  list.forEach(function (o) {
    var isPt = o.elementClass === JXG.OBJECT_CLASS_POINT;
    var isClosed = (o.elType === 'circle' || o.elType === 'polygon' || o.elType === 'circumcircle');
    var st = {};
    if (isPt) st.c = globalStyle.pointColor;
    else { st.c = globalStyle.strokeColor; st.w = globalStyle.strokeWidth; st.d = globalStyle.dash; }
    if (isClosed) { st.fc = globalStyle.fillColor; st.fo = globalStyle.fillOpacity; }
    st.fs = globalStyle.fontSize;
    st.ff = globalStyle.fontFamily || '';
    var wasSel2 = isSelected(o);
    if (wasSel2) highlightOff(o);
    applyStyle(o, st);
    if (wasSel2) highlightOn(o);
    if (o._defKind === 'glider') delete o._period;
  });
  board.update();
  renderPropPanel();
  setStatus('已恢复为当前全局样式。', true);
});

/* ============================================================
 * 全局当前样式条接线（“模式”，不记撤销）
 * ============================================================ */
(function bindStylebar() {
  function $(id) { return document.getElementById(id); }
  $('gsColor').addEventListener('input', function () {
    globalStyle.pointColor = this.value;
    globalStyle.strokeColor = this.value;
  });
  $('gsDash').addEventListener('change', function () { globalStyle.dash = parseInt(this.value, 10); });
  $('gsWidth').addEventListener('input', function () {
    globalStyle.strokeWidth = parseInt(this.value, 10);
    $('gsWidthV').textContent = this.value;
  });
  $('gsFill').addEventListener('input', function () { globalStyle.fillColor = this.value; });
  $('gsFillOp').addEventListener('input', function () {
    globalStyle.fillOpacity = parseInt(this.value, 10) / 100;
    $('gsFillOpV').textContent = this.value + '%';
  });
  $('gsFontSize').addEventListener('input', function () {
    globalStyle.fontSize = parseInt(this.value, 10);
    $('gsFontSizeV').textContent = this.value;
  });
  $('gsFont').addEventListener('change', function () { globalStyle.fontFamily = this.value; });
})();
