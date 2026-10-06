/* ============================================================
 * jxg-app3.js —— 工具栏、命名、冻结帧、序列化/快照/撤销、对象列表、几何工厂（中点/三角形中心/角平分线/垂线段/圆弧）
 * 与其它 jxg-app*.js 以普通 <script> 顺序加载，共享全局作用域。
 * ============================================================ */
/* ---------- 工具栏 ---------- */
document.querySelectorAll('#toolbar button[data-action]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    if (btn.disabled) return;
    var a = btn.getAttribute('data-action');
    if (a === 'undo') doUndo();
    else if (a === 'redo') doRedo();
    else if (a === 'delete') deleteSelection();
    else if (a === 'props-toggle') togglePropPanel();
    else if (a === 'traceanim') { traceAnim.running ? stopTraceAnimation() : startTraceAnimation(); }
  });
});
/* Ctrl+Z 撤销，Ctrl+Y / Ctrl+Shift+Z 重做（输入框内保持原生文本撤销） */
document.addEventListener('keydown', function (e) {
  if (typeof READ_ONLY !== 'undefined' && READ_ONLY) return;   // 只读态禁用快捷键（工具/撤销重做）
  var t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (e.key === 'Escape') {
    closeToolFlyout(); resetParallel(); resetSym(); hideCtxMenu(); closePropPanel();
    /* 构建过程中（多步拾取/多边形顶点/交点/平行/对称旋转/框选）按 Esc 取消当前构建，
     * 停留在当前工具；无构建进行时 Esc 不动选择集 */
    if (isConstructing()) {
      setMode(mode);   // 同模式重入：清空一切拾取态/预览/框选/高亮，并复位提示
      setStatus('已取消当前构建。', true);
    } else if (selectedObjs.length) {
      /* 无构建进行时：Esc 取消选中（含依赖联动选中），与 GeoGebra 一致 */
      clearSelection();
      updateSelectHint();
    } else if (typeof selWidget !== 'undefined' && selWidget) {
      /* 文本框选中态：Esc 取消选中 */
      deselectWidget();
    }
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    var k = (e.key || '').toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); doRedo(); }
    return;
  }
  /* Del：删除当前选中的对象（含级联依赖）；选中文本框时删除该控件；未选中时提示 */
  if (e.key === 'Delete' || e.key === 'Del') {
    e.preventDefault();
    if (typeof selWidget !== 'undefined' && selWidget && !selectedObjs.length) {
      deleteWidget(selWidget);
      return;
    }
    deleteSelection();
  }
});
/* ---------- 工具栏：模式切换 + 工具组（线段组 / 平行线组） ---------- */
var TOOL_GROUPS = {
  lineGroup:     { main: 'lineGroupMain',     arrow: 'lineGroupArrow',     flyout: 'lineGroupFlyout',
                   modes: ['segment', 'line', 'ray'] },
  triCenterGroup:{ main: 'triCenterGroupMain',arrow: 'triCenterGroupArrow',flyout: 'triCenterGroupFlyout',
                   modes: ['incenter', 'circumcenter', 'orthocenter'] },
  parallelGroup: { main: 'parallelGroupMain', arrow: 'parallelGroupArrow', flyout: 'parallelGroupFlyout',
                   modes: ['pline', 'pray', 'pseg', 'psegfree'] }
};
function syncGroupMain(gid, m) {
  /* 把组主按钮的外观同步为组内当前工具 */
  var G = TOOL_GROUPS[gid];
  var main = document.getElementById(G.main);
  var opt = document.querySelector('#' + G.flyout + ' button[data-groupopt="' + m + '"]');
  if (!main || !opt) return;
  main.setAttribute('data-mode', m);
  main.innerHTML = opt.innerHTML;
  main.setAttribute('title', opt.getAttribute('title') || '');
  main.setAttribute('aria-label', opt.getAttribute('aria-label') || '');
}
function setMode(m) {
  var oldMode = mode;   // 记录切换前的工具：选择 ⇄ 框选互切时保留选择集
  closeHistoryBundle();   // 切换工具：结束未完成的组合手势（已创建的记账保留）
  document.querySelectorAll('#toolbar button[data-mode]').forEach(function (b) {
    if (b.getAttribute('data-mode') === m) b.classList.add('active');
    else b.classList.remove('active');
  });
  Object.keys(TOOL_GROUPS).forEach(function (gid) {
    var g = document.getElementById(gid);
    if (!g) return;
    if (TOOL_GROUPS[gid].modes.indexOf(m) >= 0) { syncGroupMain(gid, m); g.classList.add('group-active'); }
    else g.classList.remove('group-active');
  });
  mode = m;
  pendingPts = [];
  pendingReused = false;
  pendingInter = false;
  polyPts = [];
  pendingCurve = null;
  pendingParPoint = null;
  pendingParRef = null;
  symAxis = null;
  symPending = [];
  cancelSymMarquee();
  cancelMarquee();   // 切换工具时取消未完成的框选
  panState = null;
  clearPolyPreview();   // 离开多边形工具时清掉进行中的边/填充预览
  candHighlightOff();
  clearFlashes();
  perpSegHoverKey = null;
  midpointHoverKey = null;
  var preSel = selectedObjs.slice();  // 中点工具需要沿用进入前的选中状态
  /* 选择 ⇄ 框选互切时保留选择集（框选完切回选择工具可整体移动） */
  var keepSel = (oldMode === 'select' && m === 'marquee') || (oldMode === 'marquee' && m === 'select');
  if (keepSel) { try { syncListSelection(); } catch (eKS) {} } else { clearSelection(); }
  document.getElementById('hint').textContent = HINTS[m];
  try { document.getElementById('rotAngleWrap').style.display = (m === 'rotate') ? 'inline-flex' : 'none'; } catch (e) {}
  try { document.getElementById('ngonWrap').style.display = (m === 'ngon') ? 'inline-flex' : 'none'; } catch (e) {}
  try { document.getElementById('msrExprWrap').style.display = (m === 'mtext') ? 'inline-flex' : 'none'; } catch (e) {}
  /* 控件创建改走弹出对话框（仿 GeoGebra），工具栏不再提供输入框；切工具时关掉未完成的弹框 */
  try { closeWidgetDialog(); } catch (e) {}
  try { deselectWidget(); } catch (e) {}
  try { document.getElementById('adriveKWrap').style.display = (m === 'adrive') ? 'inline-flex' : 'none'; } catch (e) {}
  try { document.getElementById('angDirWrap').style.display = (m === 'mang') ? 'inline-flex' : 'none'; } catch (e) {}
  if (m === 'midpoint') seedMidpointFromSelection(preSel);
}
function isToolFlyoutOpen(gid) {
  var f = document.getElementById(TOOL_GROUPS[gid].flyout);
  return !!(f && !f.hidden);
}
function openToolFlyout(gid) {
  /* 展开时只显示组内"其他"工具，当前工具不重复出现；同时收起另一个组 */
  closeToolFlyout();
  var G = TOOL_GROUPS[gid];
  var cur = document.getElementById(G.main).getAttribute('data-mode');
  document.querySelectorAll('#' + G.flyout + ' button[data-groupopt]').forEach(function (b) {
    b.style.display = (b.getAttribute('data-groupopt') === cur) ? 'none' : '';
  });
  document.getElementById(G.flyout).hidden = false;
}
function closeToolFlyout() {
  Object.keys(TOOL_GROUPS).forEach(function (gid) {
    var f = document.getElementById(TOOL_GROUPS[gid].flyout);
    if (f) f.hidden = true;
  });
}
document.querySelectorAll('#toolbar button[data-mode]').forEach(function (btn) {
  btn.addEventListener('click', function () { setMode(btn.getAttribute('data-mode')); });
});
/* 组内选项：点选后切换为该工具，并记为组的主图标 */
Object.keys(TOOL_GROUPS).forEach(function (gid) {
  var G = TOOL_GROUPS[gid];
  document.querySelectorAll('#' + G.flyout + ' button[data-groupopt]').forEach(function (btn) {
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      closeToolFlyout();
      setMode(btn.getAttribute('data-groupopt'));
    });
  });
  /* 小箭头：展开 / 收起组内其他工具 */
  document.getElementById(G.arrow).addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (isToolFlyoutOpen(gid)) closeToolFlyout(); else openToolFlyout(gid);
  });
});
/* 点工具组之外的地方：收起所有展开面板 */
document.addEventListener('click', function (e) {
  var inside = Object.keys(TOOL_GROUPS).some(function (gid) {
    var g = document.getElementById(gid);
    return g && e.target && g.contains(e.target);
  });
  if (!inside) closeToolFlyout();
});
syncGroupMain('lineGroup', 'segment');   // 初始化线段组主按钮
syncGroupMain('parallelGroup', 'pline'); // 初始化平行组主按钮
syncGroupMain('triCenterGroup', 'incenter'); // 初始化三角形中心组主按钮

/* 给多边形的每条边打上归属标记（多边形 id + 边序号），供"边交点"的序列化/级联删除/高亮用 */
function tagPolygonBorders(el) {
  if (!el || !el.borders) return;
  for (var bi = 0; bi < el.borders.length; bi++) {
    el.borders[bi]._polyId = el.id;
    el.borders[bi]._edgeIdx = bi;
  }
}

/* 用已选顶点闭合多边形（点起点 / 双击时调用） */
function finishPolygon() {
  if (polyPts.length < 3) { setStatus('多边形至少需要 3 个顶点。', false); return; }
  var el = board.create('polygon', polyPts.slice(), { name: nextId('poly') });
  tagPolygonBorders(el);
  trackId(el.id);
  polyPts.forEach(function (p) { try { delete p._polyNew; } catch (e0) {} });
  polyPts = [];
  clearPolyPreview();   // 预览边/填充被正式多边形取代
  clearFlashes();
  lastPolyFinishMs = Date.now();   // 供 mousedown 吞掉双击结束的第二次按下
  setStatus('已创建多边形。', true);
  document.getElementById('hint').textContent = HINTS.polygon;
}

/* ---------- 多边形创建实时预览 ----------
 * 过程中直接画出：已选顶点之间的边（实线）、末顶点到光标的橡皮筋（虚线）、
 * 末顶点连回起点的闭合边（虚线），>=3 个顶点时填充内部区域。
 * 全部是临时对象（不进 createdIds / 对象列表 / 快照，不参与拾取），闭合建图或
 * 切换工具时由 clearPolyPreview 清除。 */
var polyPreview = null;   // { segs:[], rubber, rubberEnd, area }
function clearPolyPreview() {
  if (!polyPreview) return;
  try { polyPreview.segs.forEach(function (s) { board.removeObject(s); }); } catch (e) {}
  ['rubber', 'rubberEnd', 'area'].forEach(function (k) {
    var o = polyPreview[k];
    if (o) { try { board.removeObject(o); } catch (e) {} }
  });
  polyPreview = null;
}
/* 顶点集合变化（增/删顶点）后调用：整体重建；鼠标移动时调用：只挪橡皮筋端点 */
function updatePolyPreview(e) {
  if (!board || !polyPts) return;
  if (!polyPts.length) { clearPolyPreview(); return; }
  /* 光标用户坐标：橡皮筋端点直接建在这里，避免"先落在原点再跳到光标"的闪帧 */
  var ux = 0, uy = 0, hasC = false;
  if (e) {
    try {
      var ce = getUsrCoords(e);
      ux = ce.usrCoords[1]; uy = ce.usrCoords[2]; hasC = true;
    } catch (e0) {}
  }
  /* 批量重建合并成一帧渲染，中间态（点到中心、旧闭合边残留等）不逐次上屏 */
  board.suspendUpdate();
  try {
  var needSegs = Math.max(0, polyPts.length - 1);
  if (!polyPreview || polyPreview.segs.length !== needSegs) {
    clearPolyPreview();
    polyPreview = { segs: [], rubber: null, rubberEnd: null, area: null };
    for (var i = 0; i < needSegs; i++) {
      var pseg = board.create('segment', [polyPts[i], polyPts[i + 1]], {
        strokeColor: '#4a90d9', strokeWidth: 2, highlight: false, fixed: true
      });
      pseg._polyPreview = true;   // 标记打在元素上（属性对象不会挂到元素）
      polyPreview.segs.push(pseg);
    }
  }
  if (!polyPreview.rubber) {
    /* 橡皮筋末端用不可见自由点承载，移动时 setPosition 跟手 */
    var ep = board.create('point', [ux, uy], { visible: false, fixed: true });
    ep._polyPreview = true;
    polyPreview.rubber = board.create('segment', [polyPts[polyPts.length - 1], ep], {
      strokeColor: '#4a90d9', strokeWidth: 2, dash: 2, highlight: false, fixed: true
    });
    polyPreview.rubber._polyPreview = true;
    polyPreview.rubberEnd = ep;
  }
  if (polyPts.length >= 3 && !polyPreview.area) {
    var parea = board.create('polygon', polyPts.slice(), {
      withLines: false, fillColor: '#4a90d9', fillOpacity: 0.15,
      highlightFillColor: '#4a90d9', highlightFillOpacity: 0.15,
      highlight: false
    });
    parea._polyPreview = true;
    polyPreview.area = parea;
  }
  if (hasC && polyPreview.rubberEnd) {
    try {
      polyPreview.rubberEnd.setPosition(JXG.COORDS_BY_USER, [ux, uy]);
    } catch (e2) {}
  }
  } finally {
    board.unsuspendUpdate();
  }
}
document.getElementById('clearBoard').addEventListener('click', function () {
  pushHistory();   // 先记快照，支持撤销清空
  board.suspendUpdate();   // 批量删除只刷一帧，避免闪屏
  try { clearUserObjects(); } finally { board.unsuspendUpdate(); }
  setStatus('画板已清空。', true);
});

function clearUserObjects() {
  clearFlashes();
  clearSelection();
  clearAllTrails();   // 轨迹是运行时视觉对象，重建/清空时一并清除
  createdIds.forEach(function (id) {
    var o = board.objects[id];
    if (o) { try { board.removeObject(o); } catch (e) {} }
  });
  /* 垂线的附属线、三点圆弧的隐藏圆心、平行工具的隐藏方向点/隐藏约束线、正N边形两点模式的隐藏中心未登记在 createdIds 里，这里一并清掉，避免重建时残留 */
  Object.keys(board.objects).forEach(function (id) {
    var o = board.objects[id];
    if (o && (o._defKind === 'perpline' || o._defKind === 'arc3center' || o._defKind === 'parhelp' || o._defKind === 'parline' || o._defKind === 'bishelp' || o._defKind === 'sidecand' || o._defKind === 'ngoncenter' ||
           o._defKind === 'pfoot' || o._defKind === 'psegext' || o._defKind === 'vhelp')) { try { board.removeObject(o); } catch (e) {} }
  });
  createdIds = [];
  /* 批量重建期间（renderSteps 内 suppressHistory=true）跳过，由 renderSteps 统一刷一次，避免列表闪空 */
  if (!suppressHistory) refreshObjectList();
  pendingPts = [];
  polyPts = [];
  clearPolyPreview();
  autoN = 0;
}

/* 名称是否已被占用：id 键或任一对象的 name（含隐藏辅助对象） */
function nameTaken(nm) {
  if (!nm || !board || !board.objects) return false;
  if (board.objects[nm]) return true;
  for (var id in board.objects) {
    if (!Object.prototype.hasOwnProperty.call(board.objects, id)) continue;
    var o = board.objects[id];
    if (o && o.name === nm) return true;
  }
  return false;
}
/* 分配唯一自动名：顺延计数器并跳过已被占用的名字。
 * 单纯递增不再保证唯一：改名可能占用"未来的"序号（如 P3 改名 P10），
 * 手写 JSON 导入（无 autoN）后计数器也会从 0 开始。 */
function nextId(prefix) {
  var nm, guard = 0;
  do {
    autoN += 1;
    nm = (prefix || 'el') + autoN;
    guard++;
  } while (nameTaken(nm) && guard < 100000);
  return nm;
}
/* 前缀独立序号的自动名（度量变量/表达式文本用）：L1、L2… / a1、a2… / t1、t2…
 * 不受全局 autoN 混排影响，用户按名字引用表达式时更可预期 */
function nextSeqId(prefix) {
  var n = 1;
  while (nameTaken(prefix + n)) n++;
  return prefix + n;
}

/* 登记一个用户对象 id 并刷新对象列表（所有新增统一走这里，避免漏刷新） */
function trackId(id) {
  if (!suppressHistory) {
    if (histBundled === true) {
      /* 组合手势：第一次创建时已统一记一条，后续创建跳过 */
    } else {
      pushHistory();   // 先记下"新增之前"的快照，用于撤销；'open' 状态在 pushHistory 里转为已记
    }
    if (histBundled) {
      gestureGroupIds.push(id);
    }
  }
  createdIds.push(id);
  /* 批量重建期间（suppressHistory=true）不逐个刷新列表，由 renderSteps 统一刷一次，避免闪烁 */
  if (!suppressHistory) { try { refreshObjectList(); } catch (e) {} }
}

/* ============================================================
 * 冻结帧：全量重建时的防闪罩
 * JSXGraph 重建后，标签尺寸要靠异步 setTimeout(getBBox) 测量校准，
 * 同步重建完会先露出一帧"标签未归位"的中间画面再跳变，看起来就是闪一下。
 * 做法（先写缓存、再直接覆盖）：重建前把当前 SVG 画面克隆成一张冻结帧盖在画板上；
 * 同步重建在罩子底下完成；等异步校准结束、正确画面已绘制好之后再揭开，
 * 用户只看到一次干净的"旧画面 → 新画面"切换。
 * ============================================================ */
var frozenGen = 0;    // 冻结帧代次：连续撤销时只有最后一次负责揭开
var frozenEl = null;
function showFrozenFrame() {
  hideFrozenFrame();
  try {
    var box = document.getElementById('jxgbox');
    var wrap = document.getElementById('boardwrap');
    if (!box || !wrap || typeof document.createElement !== 'function' ||
        typeof box.cloneNode !== 'function') return null;
    /* 关键：必须克隆整个 #jxgbox，不能只克隆 svg——
     * 点/线的标签是 #jxgbox 下的 HTML div（display:html），不在 svg 里；
     * 只克隆 svg 会导致罩子盖住的 80ms 里标签凭空消失、揭开才回来，即"标签闪"。 */
    var cs = (typeof getComputedStyle === 'function') ? getComputedStyle(box) : null;
    var bg = cs ? cs.backgroundColor : '#ffffff';
    var radius = cs ? cs.borderRadius : '8px';
    var clone = box.cloneNode(true);
    clone.removeAttribute('id');
    clone.className = '';   // 去掉 jxgbox 类，避免套用 vendor 的蓝边框样式；外框用计算样式精确复制
    clone.style.cssText = 'position:relative;overflow:hidden;width:100%;height:100%;' +
      'margin:0;padding:0;background:' + bg + ';border-radius:' + radius + ';border:none;';
    var ov = document.createElement('div');
    ov.style.position = 'absolute';
    ov.style.left = '0'; ov.style.top = '0';
    ov.style.right = '0'; ov.style.bottom = '0';
    ov.style.overflow = 'hidden';
    ov.style.pointerEvents = 'none';
    ov.style.zIndex = '60';
    ov.style.background = bg;
    ov.style.borderRadius = radius;
    ov.style.border = 'none';
    ov.appendChild(clone);
    wrap.appendChild(ov);
    frozenEl = ov;
    return ov;
  } catch (e) { return null; }
}
function hideFrozenFrame() {
  try {
    if (frozenEl && frozenEl.parentNode) frozenEl.parentNode.removeChild(frozenEl);
  } catch (e) {}
  frozenEl = null;
}
/* 带冻结帧的重建：renderSteps 的包装，调用方（撤销/重做/JSON 渲染）用这个 */
function renderStepsFrozen(steps) {
  var gen = ++frozenGen;
  var ov = showFrozenFrame();
  var n;
  try {
    /* 步骤 id 查重：AI 生成或手改的 JSON 常有重复名（尤其点），
     * 重复者自动顺延改名并重写后续引用，避免重建后画板同名/互相顶掉 */
    n = renderSteps(dedupeStepIds(steps));
  } catch (e) {
    hideFrozenFrame();   // 重建失败立刻揭开，不遮挡错误状态
    throw e;
  }
  if (ov) {
    /* vendor 用 setTimeout(0/1) 异步校准标签尺寸；多等一点确保正确画面已绘制再揭开 */
    setTimeout(function () { if (gen === frozenGen) hideFrozenFrame(); }, 80);
  }
  return n;
}

/* ============================================================
 * 撤销 / 重做：基于 JSON 构造步骤的快照
 * 每次新增对象前记下当前状态；撤销 = 清空后用旧快照重建。
 * ============================================================ */
var undoStack = [];
var redoStack = [];
var _lastHistKey = null;
var suppressHistory = true;    // 初始化及批量重建期间不记录历史
function r4(v) { return Math.round(v * 10000) / 10000; }
function oname(id) { var o = board.objects[id]; return o ? (o.name || '?') : '?'; }

/* 把一个已创建对象转回 JSON 构造步骤（用于快照）；对称生成的曲线/多边形额外附 mirror 引用 */
function objectToStep(o) {
  var s = objectToStepRaw(o);
  if (s && o._mirrorOf && o._mtype !== 'rotate') {
    s.mirror = { of: oname(o._mirrorOf), axis: oname(o._axisId), t: o._mtype };
  }
  if (s) {
    /* 单对象样式覆盖、轨迹开关、主动点活动周期：记入快照以便撤销/重载恢复 */
    try {
      var st = collectStyle(o);
      if (st) s.style = st;
      if (o._traceOn) s.trace = true;
      if (o._defKind === 'glider' && typeof o._period === 'number' && o._period !== TRACE_DEFAULT_PERIOD) {
        s.period = o._period;
      }
    } catch (e) {}
  }
  return s;
}
/* 把一个已创建对象转回 JSON 构造步骤（用于快照） */
function objectToStepRaw(o) {
  if (!o) return null;
  var nm = o.name || '';
  var dk = o._defKind;
  if (dk === 'perpline') return null;   // 垂线的附属线，随垂足步骤一起重建
  if (dk === 'parhelp') return null;     // 平行工具的隐藏方向点，随平行对象重建
  if (dk === 'parline') return null;     // 不等长平行线段的隐藏约束线，随线段重建
  if (dk === 'parend') return null;      // 平行线段的远端端点，随线段步骤一起重建
  if (dk === 'bishelp') return null;     // 角平分线的隐藏方向点，随角平分线重建
  if (dk === 'pfoot') return null;       // 垂线段的垂足，随垂线段步骤一起重建
  if (dk === 'psegext') return null;     // 垂线段的越界连接段，随垂线段步骤一起重建
  if (dk === 'sidecand') return null;    // side 约束交点的候选交点，随 sidepick 点一起重建
  if (dk === 'vhelp') return null;       // 单位向量的隐藏辅助点，随 vunit 步骤一起重建
  if (dk === 'ngonpt') return null;      // 正 N 边形的派生顶点，随 regularpolygon 步骤一起重建
  if (dk === 'ngoncenter') return null;  // 两点模式的隐藏中心点，随 regularpolygon 步骤一起重建
  if (dk === 'glider') {
    /* 多边形边上的约束点：边无独立名称，用 polygon+edge 定位（与 intersection 一致） */
    if (o._polyEdge) {
      var gp2 = { type: 'point', id: nm, polygon: oname(o._polyEdge.polyId),
                  edge: o._polyEdge.edgeIdx, coords: [r4(o.X()), r4(o.Y())] };
      var gb2 = board.objects[o._onId];
      if (gb2 && gb2.elType === 'segment') gp2.pos = r4(o.position);
      return gp2;
    }
    var gp1 = { type: 'point', id: nm, on: oname(o._onId), coords: [r4(o.X()), r4(o.Y())] };
    if (board.objects[o._onId] && board.objects[o._onId].elType === 'segment')
      gp1.pos = r4(o.position);
    return gp1;
  }
    if (dk === 'mirrorpt')
      return { type: 'mirrorpt', id: nm, of: oname(o._mirrorIds[0]), axis: oname(o._mirrorIds[1]), t: o._mtype };
    if (dk === 'rotate')
      return { type: 'rotate', id: nm, of: oname(o._rotOf), center: oname(o._rotCenter), angle: o._rotAngle };
    if (dk === 'dilate')
      return { type: 'dilate', id: nm, of: oname(o._dilOf), center: oname(o._dilCenter), ratio: o._dilRatio };
    if (dk === 'exprpoint')
      return { type: 'exprpoint', id: nm, x: o._exprX, y: o._exprY, def: o._defRaw };
    if (dk === 'sidepick')
      return { type: 'intersection', id: nm, e1: oname(o._sideE1), e2: oname(o._sideE2),
               side: { line: oname(o._sideLine), point: oname(o._sidePoint), rel: o._sideRel } };
  if (o._measure) {
    if (o._measure.kind === 'length')
      return { type: 'measure', id: nm, kind: 'length', of: oname(o._measure.of) };
    var mstep = { type: 'measure', id: nm, kind: 'angle',
             p1: oname(o._measure.pts[0]), vertex: oname(o._measure.pts[1]), p2: oname(o._measure.pts[2]) };
    if (o._measure.dir && o._measure.dir !== 'minor') mstep.dir = o._measure.dir;
    return mstep;
  }
  if (o._isExprText)
    return { type: 'text', id: nm, at: [r4(o.X()), r4(o.Y())], expr: o._exprText };
  if (dk === 'angdrive')
    return { type: 'angdrive', id: nm, vertex: oname(o._adVertex), side: oname(o._adSide),
             k: o._adK, src: o._adSrcName };
  if (dk === 'vector')
    return { type: 'vector', id: nm, p1: oname(o.parents[0]), p2: oname(o.parents[1]) };
  if (dk === 'vunit')
    return { type: 'vunit', id: nm, of: oname(o._vOf) };
  if (dk === 'vpoint')
    return { type: 'vpoint', id: nm, of: oname(o._vOf), by: oname(o._vBy), k: o._vK };
  if (o.elementClass === JXG.OBJECT_CLASS_POINT) {
    if (o.elType === 'intersection') {
      if (o._polyEdge)
        return { type: 'intersection', id: nm,
                 e1: oname(o.parents[0]), polygon: oname(o._polyEdge.polyId), edge: o._polyEdge.edgeIdx,
                 index: (o._interIndex !== undefined ? o._interIndex : 0) };
      return { type: 'intersection', id: nm,
               e1: oname(o.parents[0]), e2: oname(o.parents[1]),
               index: (o._interIndex !== undefined ? o._interIndex : 0) };
    }
    if (dk === 'footpoint')
      return { type: 'perpendicular', id: nm,
               line: oname(o._perpIds[0]), point: oname(o._perpIds[1]) };
    if (dk === 'midpoint')
      return { type: 'midpoint', id: nm, p1: oname(o._mpIds[0]), p2: oname(o._mpIds[1]) };
    if (dk === 'tricenter' && o._tcIds)
      return { type: 'tricenter', id: nm, kind: o._tcKind,
               points: [oname(o._tcIds[0]), oname(o._tcIds[1]), oname(o._tcIds[2])] };
    return { type: 'point', id: nm, coords: [r4(o.X()), r4(o.Y())] };
  }
  if (o.elType === 'segment') {
    if (dk === 'perpseg' && o._psegIds)
      return { type: 'perpseg', id: nm,
               point: oname(o._psegIds[0]), p1: oname(o._psegIds[1]), p2: oname(o._psegIds[2]) };
    if (dk === 'pseg')
      return { type: 'pseg', id: nm, point: oname(o._parIds[0]), ref: oname(o._parIds[1]), end: oname(o._endId) };
    if (dk === 'psegfree')
      return { type: 'psegfree', id: nm, point: oname(o._parIds[0]), ref: oname(o._parIds[1]),
               len: r4(parSignedLen(o)), end: oname(o._endId) };
    return { type: 'segment', id: nm, p1: oname(o.parents[0]), p2: oname(o.parents[1]) };
  }
  if (o.elType === 'line') {
    if (dk === 'ray')
      return { type: 'ray', id: nm, p1: oname(o.parents[0]), p2: oname(o.parents[1]) };
    if (dk === 'pline')
      return { type: 'pline', id: nm, point: oname(o._parIds[0]), ref: oname(o._parIds[1]) };
    if (dk === 'pray')
      return { type: 'pray', id: nm, point: oname(o._parIds[0]), ref: oname(o._parIds[1]) };
    if (dk === 'bisector' && o._bisIds)
      return { type: 'bisector', id: nm,
               vertex: oname(o._bisIds[0]), p1: oname(o._bisIds[1]), p2: oname(o._bisIds[2]) };
    return { type: 'line', id: nm, p1: oname(o.parents[0]), p2: oname(o.parents[1]) };
  }
  if (dk === 'parabola')
    return { type: 'parabola', id: nm,
             focus: oname(o._conicIds[0]), directrix: oname(o._conicIds[1]) };
  if (dk === 'ellipse' || dk === 'hyperbola')
    return { type: dk, id: nm,
             f1: oname(o._conicIds[0]), f2: oname(o._conicIds[1]), p: oname(o._conicIds[2]) };
  if (dk === 'conic')
    return { type: 'conic', id: nm,
             through5: o._conicIds.map(function (pid) { return oname(pid); }) };
  if (o.elType === 'circumcircle' || dk === 'circle3')
    return { type: 'circle', id: nm, through3: [oname(o.parents[0]), oname(o.parents[1]), oname(o.parents[2])] };
  if (o.elType === 'circle') {
    if (dk === 'circleRadius' || o._radius !== undefined)
      return { type: 'circle', id: nm, center: oname(o.parents[0]), radius: o._radius };
    return { type: 'circle', id: nm, center: oname(o.parents[0]), through: oname(o.parents[1]) };
  }
  if (dk === 'arc3')
    return { type: 'arc3', id: nm,
             through3: [oname(o._arc3pts[0]), oname(o._arc3pts[1]), oname(o._arc3pts[2])] };
  if (o.elType === 'arc' || dk === 'arc')
    return { type: 'arc', id: nm, center: oname(o.parents[0]), p1: oname(o.parents[1]), p2: oname(o.parents[2]) };
  if (o.elType === 'polygon') {
    if (dk === 'regularpolygon') {
      var rs = { type: 'regularpolygon', id: nm, n: o._ngonN };
      if (o._ngonByCenter) { rs.center = oname(o._ngonCen); rs.vertex = oname(o._ngonV0); }
      else { rs.p1 = oname(o._ngonV0); rs.p2 = oname(o._ngonP2); }
      return rs;
    }
    return { type: 'polygon', id: nm,
             points: (o.vertices || []).map(function (v) { return v.name; }) };
  }
  return null;
}
function snapshotState() {
  var steps = [];
  createdIds.forEach(function (id) {
    var o = board.objects[id];
    if (!o) return;
    try {
      var s = objectToStep(o);
      if (s) {
        /* 显示/隐藏也是变更的一部分，记入快照以便撤销恢复 */
        try { if (o.getAttribute('visible') === false) s.visible = false; } catch (e) {}
        steps.push(s);
      }
    } catch (e) {}
  });
  /* 控件（HTML 浮层，屏幕固定）：同样记入快照 */
  try {
    widgets.forEach(function (w) {
      var ws = widgetToStep(w);
      if (ws) steps.push(ws);
    });
  } catch (e) {}
  return { steps: steps, autoN: autoN };
}
/* 记录一次历史（调用方保证在变更之前调用） */
function pushHistory() {
  if (suppressHistory) return;
  if (histBundled === true) return;   // 组合手势：第一次创建时已统一记一条
  if (histBundled === 'open') histBundled = true;   // 组合手势的显式记账：视同第一次创建
  undoStack.push(snapshotState());
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  _lastHistKey = JSON.stringify(undoStack[undoStack.length - 1].steps);
  updateUndoButtons();
}
function updateUndoButtons() {
  var u = document.querySelector('#toolbar button[data-action="undo"]');
  var r = document.querySelector('#toolbar button[data-action="redo"]');
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}
/* 用快照重建画板（不记录历史） */
function restoreState(snap) {
  if (traceAnim.running) stopTraceAnimation();   // 撤销/重做时先停下轨迹运动
  closeHistoryBundle();   // 撤销/重做结束未完成的组合手势（分组登记走存活检查）
  suppressHistory = true;
  try {
    renderStepsFrozen(snap.steps);  // 盖冻结帧重建，避免异步校准造成闪烁
    autoN = snap.autoN || 0;      // 恢复命名计数器
  } finally {
    suppressHistory = false;
  }
  clearSelection();
  pendingPts = []; polyPts = []; pendingCurve = null; panState = null;
  pendingParPoint = null; pendingParRef = null;   // 撤销/重建时丢弃进行中的平行拾取，避免悬空引用
  clearFlashes();
  _lastHistKey = JSON.stringify(snapshotState().steps);
  /* 对象列表已由 renderSteps 统一刷新过，这里不再重复刷新 */
  updateUndoButtons();
}
function doUndo() {
  if (!undoStack.length) { setStatus('没有可撤销的操作。', false); return; }
  redoStack.push(snapshotState());
  var snap = undoStack.pop();
  restoreState(snap);
  setStatus('已撤销。', true);
  updateUndoButtons();
}
function doRedo() {
  if (!redoStack.length) { setStatus('没有可重做的操作。', false); return; }
  undoStack.push(snapshotState());
  var snap = redoStack.pop();
  restoreState(snap);
  setStatus('已重做。', true);
  updateUndoButtons();
}

/* ---------- 左侧对象列表 ---------- */
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/* 取某对象的第 i 个父元素的名称 */
function pname(o, i) {
  try {
    var p = o.parents && board.objects[o.parents[i]];
    return (p && p.name) || '?';
  } catch (e) { return '?'; }
}
function fmtR(r) { return isFinite(r) ? Number(r).toFixed(2) : '?'; }
function radiusOf(o) {
  if (typeof o._radius === 'number') return o._radius;
  try {
    var c = o.center, t = o.point2 || (o.parents && board.objects[o.parents[1]]);
    if (c && t && c.X && t.X) return Math.hypot(t.X() - c.X(), t.Y() - c.Y());
  } catch (e) {}
  try { return o.Radius(); } catch (e2) {}
  return NaN;
}
function polyNames(o) {
  try {
    return (o.vertices || []).map(function (v) { return v.name || '?'; }).join('、');
  } catch (e) { return ''; }
}
/* 生成对象的中文定义，如：圆 c1：圆心 A，半径 3.00 */
/* 对象列表的定义描述；对称生成的对象附加镜像标注 */
function describeDef(o) {
  var d = describeDefRaw(o);
  if (o._mirrorOf) {
    var mx = o._axisId && board.objects[o._axisId];
    d += '〔关于' + (mx ? (mx.elementClass === JXG.OBJECT_CLASS_POINT ? '点' : '') + mx.name : '?') +
         (o._mtype === 'rotate' ? '旋转 ' + (o._rotProdAngle || 0) + '°' : (o._mtype === 'central' ? '中心对称' : '轴对称')) + '〕';
  }
  return d;
}
function describeDefRaw(o) {
  var nm = o.name || '';
  if (o._measure) {
    if (o._measure.kind === 'length') {
      var lt = board.objects[o._measure.of];
      var ltLabel = lt ? ({ segment: '线段', circle: '圆', circumcircle: '圆', arc: '圆弧', polygon: '多边形' })[lt.elType] || '对象' : '?';
      return '长度 ' + nm + '：' + ltLabel + ' ' + (lt ? lt.name || '?' : '?') + ' = ' + fmtR(measureLenOf(lt));
    }
    var ap = o._measure.pts;
    return '角度 ' + nm + '：∠' + oname(ap[0]) + oname(ap[1]) + oname(ap[2]) +
           ' = ' + fmtR(measureCarrierValue(o)) + '°';
  }
  if (o._isExprText) {
    var tv = NaN;
    try { tv = evalMsrExpr(o._exprText); } catch (e) {}
    return '文本 ' + nm + '：' + o._exprText + ' = ' + (isFinite(tv) ? fmtR(tv) : '?');
  }
  if (o._defKind === 'angdrive')
    return '从动点 ' + nm + '：∠' + oname(o._adSide) + oname(o._adVertex) + nm +
           ' = ' + ppNum(o._adK) + ' × ∠' + (o._adSrcName || '?') + '（单向从动）';
  if (o._defKind === 'vector')
    return '向量 ' + nm + '：' + pname(o, 0) + ' → ' + pname(o, 1);
  if (o._defKind === 'vunit')
    return '单位向量 ' + nm + '：与 ' + oname(o._vOf) + ' 同向，长度 1';
  if (o._defKind === 'vpoint')
    return '向量点 ' + nm + '：' + oname(o._vOf) + ' + ' + ppNum(o._vK) + '×' + oname(o._vBy) +
           '（' + o.X().toFixed(2) + ', ' + o.Y().toFixed(2) + '）';
  if (o._defKind === 'mirrorpt') {
    var mo = o._mirrorIds && board.objects[o._mirrorIds[0]];
    var mx = o._mirrorIds && board.objects[o._mirrorIds[1]];
    return '对称点 ' + nm + '（' + o.X().toFixed(2) + ', ' + o.Y().toFixed(2) + '）：' +
           (mo ? mo.name : '?') + ' 关于' +
           (mx ? (mx.elementClass === JXG.OBJECT_CLASS_POINT ? '点 ' : '') + mx.name : '?') +
           (o._mtype === 'central' ? '中心对称' : '轴对称');
  }
  if (o._defKind === 'midpoint')
    return '中点 ' + nm + '：' + pname(o, 0) + '、' + pname(o, 1) + ' 的中点';
  if (o._defKind === 'tricenter' && o._tcIds) {
    var tcl = o._tcKind === 'incenter' ? '内心' : (o._tcKind === 'circumcenter' ? '外心' : '垂心');
    return tcl + ' ' + nm + '：△' + oname(o._tcIds[0]) + oname(o._tcIds[1]) + oname(o._tcIds[2]) + ' 的' + tcl;
  }
  if (o._defKind === 'bisector' && o._bisIds)
    return '角平分线 ' + nm + '：∠' + oname(o._bisIds[1]) + oname(o._bisIds[0]) + oname(o._bisIds[2]) + ' 的平分线';
  if (o._defKind === 'perpseg' && o._psegIds) {
    var pfh = o._footId && board.objects[o._footId];
    return '垂线段 ' + nm + '：由 ' + oname(o._psegIds[0]) + ' 向 ' +
           oname(o._psegIds[1]) + '–' + oname(o._psegIds[2]) + ' 作的垂线段' +
           (pfh ? '，垂足 ' + pfh.name : '');
  }
  if (o._defKind === 'perpline')
    return '垂线 ' + nm + '：过 ' + pname(o, 1) + ' 垂直于 ' + pname(o, 0);
  if (o._defKind === 'footpoint')
    return '垂足 ' + nm + '（' + o.X().toFixed(2) + ', ' + o.Y().toFixed(2) + '）';
  if (o._defKind === 'parabola')
    return '抛物线 ' + nm + '：焦点 ' + oname(o._conicIds[0]) +
           '，准线 ' + oname(o._conicIds[1]);
  if (o._defKind === 'ellipse' || o._defKind === 'hyperbola')
    return (o._defKind === 'ellipse' ? '椭圆 ' : '双曲线 ') + nm +
           '：焦点 ' + oname(o._conicIds[0]) + '、' + oname(o._conicIds[1]) +
           '，过点 ' + oname(o._conicIds[2]);
  if (o._defKind === 'conic')
    return '二次曲线 ' + nm + '：过 ' + o._conicIds.map(function (pid) { return oname(pid); }).join('、') + ' 五点';
  if (o._defKind === 'circle3' || o.elType === 'circumcircle')
    return '三点圆 ' + nm + '：过 ' + pname(o, 0) + '、' + pname(o, 1) + '、' + pname(o, 2);
  if (o._defKind === 'glider') {
    if (o._polyEdge) {
      var gPoly = board.objects[o._polyEdge.polyId];
      return '点 ' + nm + '（' + o.X().toFixed(2) + ', ' + o.Y().toFixed(2) + '）在多边形 ' +
             (gPoly ? gPoly.name : '?') + ' 的边' + (o._polyEdge.edgeIdx + 1) + '上';
    }
    var cv = o._onId && board.objects[o._onId];
    return '点 ' + nm + '（' + o.X().toFixed(2) + ', ' + o.Y().toFixed(2) + '）在' +
           (cv ? curveLabel(cv) + ' ' + cv.name : '?') + '上';
  }
  if (o._defKind === 'ray')
    return '射线 ' + nm + '：从 ' + pname(o, 0) + ' 出发过 ' + pname(o, 1);
  if (o._defKind === 'parend')
    return '平行端点 ' + nm + '（' + o.X().toFixed(2) + ', ' + o.Y().toFixed(2) + '）' +
      (o._free ? '，可沿方向拖动' : '');
  if (o._defKind === 'pline' || o._defKind === 'pray' || o._defKind === 'pseg' || o._defKind === 'psegfree') {
    var parP = o._parIds && board.objects[o._parIds[0]];
    var parR = o._parIds && board.objects[o._parIds[1]];
    var ppn = parP ? parP.name : '?', prn = parR ? parR.name : '?';
    if (o._defKind === 'pline')
      return '平行直线 ' + nm + '：过点 ' + ppn + '，平行于 ' + prn;
    if (o._defKind === 'pray')
      return '平行射线 ' + nm + '：起点 ' + ppn + '，沿 ' + prn + ' 的点1→点2方向';
    if (o._defKind === 'pseg')
      return '等长平行线段 ' + nm + '：起点 ' + ppn + '，与 ' + prn + ' 等长且平行';
    return '平行线段 ' + nm + '：起点 ' + ppn + '，平行于 ' + prn + '，长度 ' + fmtR(Math.abs(parSignedLen(o)));
  }
  if (o._defKind === 'arc3')
    return '三点圆弧 ' + nm + '：依次过 ' + oname(o._arc3pts[0]) + '、' + oname(o._arc3pts[1]) + '、' + oname(o._arc3pts[2]);
  if (o._defKind === 'arc' || o.elType === 'arc')
    return '圆弧 ' + nm + '：圆心 ' + pname(o, 0) + '，从 ' + pname(o, 1) + ' 到 ' + pname(o, 2);
  switch (o.elType) {
    case 'point':
      return '点 ' + nm + '（' + o.X().toFixed(2) + ', ' + o.Y().toFixed(2) + '）';
    case 'intersection':
      if (o._polyEdge) {
        var pePoly = board.objects[o._polyEdge.polyId];
        return '交点 ' + nm + '：' + pname(o, 0) + ' ∩ 多边形 ' +
               (pePoly ? pePoly.name : '?') + ' 的边' + (o._polyEdge.edgeIdx + 1) +
               '（' + o.X().toFixed(2) + ', ' + o.Y().toFixed(2) + '）';
      }
      return '交点 ' + nm + '：' + pname(o, 0) + ' ∩ ' + pname(o, 1) +
             '（' + o.X().toFixed(2) + ', ' + o.Y().toFixed(2) + '）';
    case 'segment':
      return '线段 ' + nm + '：' + pname(o, 0) + '–' + pname(o, 1);
    case 'line':
      return '直线 ' + nm + '：过 ' + pname(o, 0) + '、' + pname(o, 1);
    case 'circle':
      return '圆 ' + nm + '：圆心 ' + pname(o, 0) + '，半径 ' + fmtR(radiusOf(o));
    case 'polygon':
      return '多边形 ' + nm + '：' + polyNames(o);
    default:
      return (o.elType || '图形') + (nm ? ' ' + nm : '');
  }
}
var editingId = null;   // 双击改名时正在编辑的对象内部 id（编辑期间不刷新列表）
/* 列表显示顺序：仅影响对象列表行的排列，不改 createdIds（构造/序列化/撤销顺序不受影响） */
var listOrder = [];
function syncListOrder() {
  var alive = {}, i, id;
  for (i = 0; i < createdIds.length; i++) alive[createdIds[i]] = true;
  listOrder = listOrder.filter(function (oid) { return alive[oid]; });
  for (i = 0; i < createdIds.length; i++) {
    id = createdIds[i];
    if (listOrder.indexOf(id) < 0) listOrder.push(id);
  }
}
function refreshObjectList() {
  if (editingId) return;   // 正在行内编辑时保持编辑器不被刷新掉
  var box = document.getElementById('objlist');
  if (!box) return;
  syncListOrder();
  var html = '';
  listOrder.forEach(function (id) {
    var o = board.objects[id];
    if (!o || o._defKind === 'perpline') return;   // 垂线附属线不单独列出
    var d;
    try { d = describeDef(o); }
    catch (e) { d = (o.elType || '图形') + ' ' + (o.name || ''); }
    var vis = o.getAttribute('visible') !== false;
    var selCls = isSelected(o) ? ' is-selected' : '';
    var depCls = (!isSelected(o) && isDepSelected(o)) ? ' is-dep-selected' : '';
    html += '<div class="objrow' + (vis ? '' : ' is-hidden') + selCls + depCls + '" draggable="true" data-id="' + escHtml(id) + '" title="双击修改名称">' +
      '<span class="visdot' + (vis ? '' : ' off') + '" data-id="' + escHtml(id) + '" title="显示 / 隐藏"></span>' +
      '<span class="objdef">' + escHtml(d) + '</span></div>';
  });
  /* 控件行：点击打开控件属性（配置标题/脚本/删除） */
  try {
    widgets.forEach(function (w) {
      html += '<div class="objrow objrow-widget" data-wid="' + escHtml(w.id) + '" title="点击配置控件">' +
        '<span class="objdef">' + escHtml(describeWidget(w)) + '</span></div>';
    });
  } catch (e) {}
  box.innerHTML = html || '<div class="objempty">暂无对象</div>';
}
/* 列表拖拽排序：只改 listOrder 显示顺序。
 * 组合手势生成的对象块（objGroups，按对象名记录）保持连续：
 * 拖分组成员 = 整块一起移动；任何对象都不允许插入块中间（吸附到最近边缘）。 */
(function () {
  var box = document.getElementById('objlist');
  if (!box) return;
  var dragIds = [];
  function rowOf(t) { return (t && t.closest) ? t.closest('.objrow') : null; }
  function clearHints() {
    box.querySelectorAll('.drop-before,.drop-after').forEach(function (r) {
      r.classList.remove('drop-before'); r.classList.remove('drop-after');
    });
  }
  /* dragId 所在的分块（当前存活且成员>1 才生效）：返回整组成员 id */
  function groupBlockOf(id) {
    for (var gi = 0; gi < objGroups.length; gi++) {
      var g = objGroups[gi];
      if (g.indexOf(id) < 0) continue;
      var ids = g.filter(function (oid) { return createdIds.indexOf(oid) >= 0 && board.objects[oid]; });
      return ids.length > 1 ? ids : null;
    }
    return null;
  }
  /* 各分块当前在 listOrder 里的位置（存活成员；不连续/不足 2 个的块返回 null） */
  function groupRanges() {
    var ranges = [];
    objGroups.forEach(function (g) {
      var idxs = [];
      g.forEach(function (oid) {
        var li = listOrder.indexOf(oid);
        if (li >= 0 && board.objects[oid]) idxs.push(li);
      });
      if (idxs.length < 2) return;
      var pmin = Math.min.apply(null, idxs), pmax = Math.max.apply(null, idxs);
      if (idxs.length !== pmax - pmin + 1) return;   // 块已不连续（成员被删/散开），放弃约束
      ranges.push([pmin, pmax]);
    });
    return ranges;
  }
  /* 插入位置吸附：不允许落在任何分块 (pmin, pmax] 区间内，取最近的块边缘 */
  function snapOutOfGroups(ins) {
    for (;;) {
      var snapped = false;
      groupRanges().forEach(function (rg) {
        if (ins > rg[0] && ins <= rg[1]) {
          ins = (ins - rg[0] <= rg[1] + 1 - ins) ? rg[0] : rg[1] + 1;
          snapped = true;
        }
      });
      if (!snapped) return ins;
    }
  }
  /* 依赖序校验：newOrder 中任何对象都不得排在其依赖对象之前（依赖 = 直接 + 多级传递）。
   * 只校验被拖对象与其余对象的配对（其余对象间相对顺序未变，原有顺序天然合法）。
   * 返回首个违规的中文描述，合法返回 null。 */
  function depOrderViolation(moving, newOrder) {
    var pos = {};
    newOrder.forEach(function (oid, i) { pos[oid] = i; });
    var isMv = {};
    moving.forEach(function (id) { isMv[id] = true; });
    for (var k = 0; k < newOrder.length; k++) {
      var oid = newOrder[k];
      if (isMv[oid]) continue;              // 块内成员相对顺序保持，两两不校验
      var o = board.objects[oid];
      if (!o) continue;
      for (var j = 0; j < moving.length; j++) {
        var mid = moving[j];
        var m = board.objects[mid];
        if (!m) continue;
        /* o 依赖被拖对象 ⇒ o 必须排在它后面，不得移到它前面 */
        if (pos[oid] < pos[mid] && dependsOnId(o, mid))
          return '「' + describeDef(o) + '」依赖于被拖动的对象，被依赖的对象必须排在前面';
        /* 被拖对象依赖 o ⇒ 被拖对象必须排在 o 后面，不得移到它前面 */
        if (pos[mid] < pos[oid] && dependsOnId(m, oid))
          return '被拖动的对象依赖于「' + describeDef(o) + '」，不能把它移到该对象之前';
      }
    }
    return null;
  }
  /* 拖拽悬停时预览该落点是否合法：不合法不显示插入提示（松手同样会被拒绝） */
  function dropViolationAt(targetId, after) {
    var moving = dragIds.slice();
    var rest = listOrder.filter(function (oid) { return moving.indexOf(oid) < 0; });
    var ti = rest.indexOf(targetId);
    if (ti < 0) return null;
    var save = listOrder;
    listOrder = rest;                       // snapOutOfGroups 按全局 listOrder 取块位置
    var ins;
    try { ins = snapOutOfGroups(after ? ti + 1 : ti); }
    finally { listOrder = save; }
    var newOrder = rest.slice();
    moving.forEach(function (oid, k) { newOrder.splice(ins + k, 0, oid); });
    return depOrderViolation(moving, newOrder);
  }
  box.addEventListener('dragstart', function (e) {
    var row = rowOf(e.target);
    if (!row) return;
    var dragId = row.getAttribute('data-id');
    dragIds = groupBlockOf(dragId) || [dragId];
    row.classList.add('dragging');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); } catch (err) {}
  });
  box.addEventListener('dragover', function (e) {
    if (!dragIds.length) return;
    var row = rowOf(e.target);
    if (!row || dragIds.indexOf(row.getAttribute('data-id')) >= 0) { clearHints(); return; }
    /* 依赖序非法的落点：不显示插入提示，松手也会被拒绝 */
    if (dropViolationAt(row.getAttribute('data-id'),
        (e.clientY - row.getBoundingClientRect().top) > row.getBoundingClientRect().height / 2)) {
      clearHints();
      return;
    }
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
    clearHints();
    var r = row.getBoundingClientRect();
    var after = (e.clientY - r.top) > r.height / 2;
    row.classList.add(after ? 'drop-after' : 'drop-before');
    row._dropAfter = after;
  });
  box.addEventListener('dragleave', function (e) {
    var row = rowOf(e.target);
    if (row) { row.classList.remove('drop-before'); row.classList.remove('drop-after'); }
  });
  box.addEventListener('drop', function (e) {
    if (!dragIds.length) return;
    var row = rowOf(e.target);
    e.preventDefault();
    clearHints();
    if (row && dragIds.indexOf(row.getAttribute('data-id')) < 0) {
      var targetId = row.getAttribute('data-id');
      var after = !!row._dropAfter;
      var moving = dragIds.slice();
      var prevOrder = listOrder;
      listOrder = listOrder.filter(function (oid) { return moving.indexOf(oid) < 0; });
      var ti = listOrder.indexOf(targetId);
      if (ti < 0) { dragIds = []; return; }
      var ins = snapOutOfGroups(after ? ti + 1 : ti);
      var newOrder = listOrder.slice();
      moving.forEach(function (oid, k) { newOrder.splice(ins + k, 0, oid); });
      var viol = depOrderViolation(moving, newOrder);
      if (viol) {
        listOrder = prevOrder;              // 还原，顺序不变
        try { setStatus(viol + '。', false); } catch (e) {}
        dragIds = [];
        return;
      }
      listOrder = newOrder;
      refreshObjectList();
    }
    dragIds = [];
  });
  box.addEventListener('dragend', function () {
    dragIds = [];
    clearHints();
    box.querySelectorAll('.dragging').forEach(function (r) { r.classList.remove('dragging'); });
  });
})();
function toggleObjVisible(id) {
  var o = board.objects[id];
  if (!o) return;
  pushHistory();   // 显示/隐藏记入撤销
  var vis = o.getAttribute('visible') !== false;
  try { o.setAttribute({ visible: !vis }); } catch (e) { return; }
  board.update();
  refreshObjectList();
}
document.getElementById('objlist').addEventListener('click', function (e) {
  var t = e.target;
  var dot = (t.classList && t.classList.contains('visdot')) ? t : null;
  var row = (t.closest) ? t.closest('.objrow') : null;
  var id = dot ? dot.getAttribute('data-id') : (row ? row.getAttribute('data-id') : null);
  var wid = row ? row.getAttribute('data-wid') : null;
  if (wid) {
    var w = widgetById(wid);
    if (w) openWidgetPropPanel(w);
    return;
  }
  if (!id || !board.objects[id]) return;
  if (dot) { toggleObjVisible(id); return; }
  /* 点行内其他区域：已在选择模式下 Ctrl/⌘/Shift+点击 → 加选/取消，不清空已有选择 */
  var multiKey = e.ctrlKey || e.metaKey || e.shiftKey;
  if (mode === 'select' && multiKey) { toggleSelect(board.objects[id]); return; }
  var selBtn = document.querySelector('#toolbar button[data-mode="select"]');
  if (selBtn) selBtn.click();
  selectObject(board.objects[id]);
});

/* ---------- 双击行内改名（仅改名，不改定义） ---------- */
function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;')
                  .replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/* 改名并重写所有步骤中的引用；返回 null 表示成功（含未变化），否则返回错误信息。
 * 对象列表双击改名与属性面板共用。 */
function renameObjectTo(o, nn) {
  var id = o.id;
  var idx = createdIds.indexOf(id);
  if (idx < 0) return '该对象不支持改名。';
  var prev = snapshotState();
  var oldStep = prev.steps[idx];
  if (!oldStep) return '该对象不支持改名。';
  var oldName = oldStep.id || o.name || '';
  if (!nn) return '名称不能为空。';
  if (/\s/.test(nn)) return '名称不能包含空格。';
  if (nn === oldName) return null;
  var clash = prev.steps.some(function (s, j) { return j !== idx && s.id === nn; });
  if (clash) return '名称 "' + nn + '" 已被使用。';
  var steps = prev.steps.map(function (s, j) {
    if (j === idx) { var c = {}; for (var k in s) c[k] = s[k]; c.id = nn; return c; }
    return renameRefsInStep(s, oldName, nn);
  });
  var prevKey = _lastHistKey;
  pushHistory();          // 先记快照，改名也支持撤销
  try {
    restoreState({ steps: steps, autoN: prev.autoN });
    setStatus('已改名为 "' + nn + '"。', true);
    return null;
  } catch (err) {
    undoStack.pop();      // 回滚这次历史记录
    _lastHistKey = prevKey;
    updateUndoButtons();
    restoreState(prev);
    return '改名失败：' + err.message;
  }
}
function startRename(id, row) {
  var o = board.objects[id];
  if (!o) return;
  var idx = createdIds.indexOf(id);
  if (idx < 0) return;
  var prev = snapshotState();
  var oldStep = prev.steps[idx];
  if (!oldStep) return;
  var oldName = oldStep.id || o.name || '';
  editingId = id;
  row.innerHTML = '<input class="stepedit" type="text" value=\'' + escAttr(oldName) + '\' title="修改对象名称">' +
    '<button class="stepok" title="确定">✓</button><button class="stepcancel" title="取消">✕</button>';
  var input = row.querySelector('.stepedit');
  var okBtn = row.querySelector('.stepok');
  var cancelBtn = row.querySelector('.stepcancel');
  function cancel() { editingId = null; refreshObjectList(); }
  function apply() {
    var nn = input.value.trim();
    if (!nn) { setStatus('名称不能为空。', false); return; }
    if (/\s/.test(nn)) { setStatus('名称不能包含空格。', false); return; }
    if (nn === oldName) { cancel(); return; }
    var err = renameObjectTo(o, nn);
    editingId = null;
    if (err) setStatus(err, false);
    refreshObjectList();
  }
  okBtn.addEventListener('click', function (ev) { ev.stopPropagation(); apply(); });
  cancelBtn.addEventListener('click', function (ev) { ev.stopPropagation(); cancel(); });
  input.addEventListener('keydown', function (ev) {
    ev.stopPropagation();
    if (ev.key === 'Enter') apply();
    else if (ev.key === 'Escape') cancel();
  });
  input.addEventListener('click', function (ev) { ev.stopPropagation(); });
  input.focus();
  try { input.select(); } catch (e) {}
}
document.getElementById('objlist').addEventListener('dblclick', function (e) {
  var t = e.target;
  if (t.classList && (t.classList.contains('visdot') || t.classList.contains('stepedit') ||
      t.classList.contains('stepok') || t.classList.contains('stepcancel'))) return;
  var row = (t.closest) ? t.closest('.objrow') : null;
  if (!row || editingId) return;
  startRename(row.getAttribute('data-id'), row);
});
/* 把步骤里的旧名引用全部换成新名（改名时用） */
function renameRefsInStep(s, oldN, newN) {
  var c = {};
  for (var k in s) c[k] = s[k];
  ['p1', 'p2', 'center', 'through', 'line', 'point', 'e1', 'e2', 'on', 'ref', 'polygon', 'end', 'of', 'axis', 'vertex', 'f1', 'f2', 'p', 'focus', 'directrix', 'src', 'side'].forEach(function (k) {
    if (c[k] === oldN) c[k] = newN;
  });
  if (c.mirror) {  // 注意深拷贝：原实现是浅拷贝，直接改会污染原步骤
    c.mirror = { of: c.mirror.of, axis: c.mirror.axis, t: c.mirror.t };
    if (c.mirror.of === oldN) c.mirror.of = newN;
    if (c.mirror.axis === oldN) c.mirror.axis = newN;
  }
  if (c.side) {    // 同侧/异侧约束同样按名字引用，需一并重写
    c.side = { line: c.side.line, point: c.side.point, rel: c.side.rel };
    if (c.side.line === oldN) c.side.line = newN;
    if (c.side.point === oldN) c.side.point = newN;
  }
  /* 表达式点（exprpoint 的 x/y）以标识符引用点名：整词替换，避免误伤含该串的其他标识符 */
  if (typeof c.x === 'string' || typeof c.y === 'string') {
    var re = new RegExp('(^|[^A-Za-z0-9_])' + oldN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_])', 'g');
    if (typeof c.x === 'string') c.x = c.x.replace(re, '$1' + newN);
    if (typeof c.y === 'string') c.y = c.y.replace(re, '$1' + newN);
  }
  /* 表达式文本（text 的 expr）与从动角（angdrive 的 src）同样按标识符/名字引用 */
  if (typeof c.expr === 'string') {
    var re2 = new RegExp('(^|[^A-Za-z0-9_])' + oldN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_])', 'g');
    c.expr = c.expr.replace(re2, '$1' + newN);
  }
  if (Array.isArray(c.through3)) c.through3 = c.through3.map(function (v) { return v === oldN ? newN : v; });
  if (Array.isArray(c.points)) c.points = c.points.map(function (v) { return v === oldN ? newN : v; });
  return c;
}
/* 渲染前查重：AI 生成或手改的 JSON 步骤可能带重复 id（尤其点）。
 * 重复的自动顺延改名（B → B_1 → B_2…），并把后续步骤里的引用一并重写，
 * 避免后建对象顶掉先建对象或画板出现同名图形。 */
function dedupeStepIds(steps) {
  if (!Array.isArray(steps) || steps.length < 2) return steps;
  var used = {}, out = steps.slice();
  out.forEach(function (s, i) {
    if (!s || typeof s.id !== 'string' || !s.id) return;
    if (!used[s.id]) { used[s.id] = true; return; }
    var old = s.id, cand, k = 1;
    do { cand = old + '_' + k; k++; } while (used[cand] || nameTaken(cand));
    used[cand] = true;
    out[i] = renameRefsInStep(out[i], old, cand);
    out[i].id = cand;
    for (var j = i + 1; j < out.length; j++) {
      if (!out[j]) continue;
      var keepId = out[j].id;
      out[j] = renameRefsInStep(out[j], old, cand);
      out[j].id = keepId;
    }
  });
  return out;
}
/* 三点构成的三角形面积（绝对值），用于三点圆的共线校验 */
function triArea(a, b, c) {
  return Math.abs((b.X() - a.X()) * (c.Y() - a.Y()) - (c.X() - a.X()) * (b.Y() - a.Y())) / 2;
}

/* 三点外心（用户坐标），三点共线时返回 null */
function circumcenterOf(a, b, c) {
  var ax = a.X(), ay = a.Y(), bx = b.X(), by = b.Y(), cx = c.X(), cy = c.Y();
  var d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  var a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  return [
    (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d,
    (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
  ];
}
/* 分配对象名：want 若未被占用则直接用，否则退回 nextId(prefix) 自动顺延 */
function allocName(want, prefix) {
  if (want) {
    var taken = !!board.objects[want];
    if (!taken) {
      for (var i = 0; i < createdIds.length; i++) {
        var o = board.objects[createdIds[i]];
        if (o && o.name === want) { taken = true; break; }
      }
    }
    if (!taken) return want;
  }
  return nextId(prefix);
}
/* ---------- 中点 ---------- */
/* 点击位置附近的线段（有限线段，14px 容差内最近的一条） */
function findSegmentAt(sx, sy) {
  var best = null, bestD = 14;
  createdIds.forEach(function (id) {
    var o = board.objects[id];
    if (!o || o.elType !== 'segment') return;
    var d = distToCurvePx(o, sx, sy);
    if (d <= bestD) { bestD = d; best = o; }
  });
  return best;
}
/* 找鼠标下的线段或多边形边：返回 {p1, p2, key}；key 供悬停高亮判变。
 * 多边形的边未登记在 createdIds 中，这里把各多边形的 borders 一并纳入。 */
function findSegOrPolyEdgeAt(sx, sy) {
  var best = null, bestD = 14, bestKey = null;
  function visOff(o) {
    try { return o.visProp && o.visProp.visible === false; } catch (e) { return false; }
  }
  function consider(o, key) {
    if (!o || !o.point1 || !o.point2 || visOff(o)) return;
    var d = distToCurvePx(o, sx, sy);
    if (d <= bestD) { bestD = d; best = o; bestKey = key; }
  }
  createdIds.forEach(function (id) {
    var o = board.objects[id];
    if (!o || !o.hasPoint || visOff(o)) return;
    if (o.elType === 'segment') { consider(o, 's:' + o.id); return; }
    if (o.elType === 'polygon' && o.borders) {
      for (var bi = 0; bi < o.borders.length; bi++) consider(o.borders[bi], 'p:' + o.id + '#' + bi);
    }
  });
  if (!best) return null;
  return { p1: best.point1, p2: best.point2, key: bestKey };
}
/* 已存在的两点中点（无序对匹配），用于避免重复创建 */
function findMidpointOf(a, b) {
  for (var i = 0; i < createdIds.length; i++) {
    var o = board.objects[createdIds[i]];
    if (!o || o._defKind !== 'midpoint' || !o._mpIds) continue;
    if ((o._mpIds[0] === a.id && o._mpIds[1] === b.id) ||
        (o._mpIds[0] === b.id && o._mpIds[1] === a.id)) return o;
  }
  return null;
}
/* 创建两点联动中点（端点移动时自动跟随）；name 由调用方分配 */
function createMidpoint(a, b, name, skipTrack) {
  var el = board.create('midpoint', [a, b], { name: name });
  el._defKind = 'midpoint';
  el._mpIds = [a.id, b.id];
  applyDrivenGray(el);
  if (!skipTrack) trackId(el.id);
  return el;
}
/* 进入中点工具时沿用选择工具下已有的选中状态：
   - 之前已选中一条线段：直接做其中点；
   - 之前已选中一个点：作为第一点，之后再选一个点即可；
   - 其他情况（多选/未选中）：走常规点击流程 */
function seedMidpointFromSelection(preSel) {
  if (!preSel || preSel.length !== 1) return;
  var o = preSel[0];
  if (o.elementClass === JXG.OBJECT_CLASS_LINE && o.elType === 'segment' && o.point1 && o.point2) {
    var sa = o.point1, sb = o.point2;
    var dup = findMidpointOf(sa, sb);
    if (dup) { flashOn(dup); setStatus('该线段的中点已存在：' + dup.name + '。', true); }
    else {
      var m0 = createMidpoint(sa, sb, nextId('M'));
      flashOn(m0);
      setStatus('已创建线段中点 ' + m0.name + '（端点移动时联动）。', true);
    }
    return;
  }
  if (o.elementClass === JXG.OBJECT_CLASS_POINT) {
    pendingPts = [o];
    pendingReused = true;
    flashOn(o);
    document.getElementById('hint').textContent =
      '已选第一点 ' + o.name + '（复用已有点），再点击第二个位置。';
  }
}
/* ---------- 三角形中心 ---------- */
/* 三角形中心纯数学计算（用户坐标）：kind 为 incenter / circumcenter / orthocenter；退化返回 null */
function triCenterXY(kind, A, B, C) {
  var ax = A.X(), ay = A.Y(), bx = B.X(), by = B.Y(), cx = C.X(), cy = C.Y();
  if (kind === 'circumcenter') return circumcenterOf(A, B, C);
  if (kind === 'incenter') {
    /* 内心 = (a·A + b·B + c·C) / (a+b+c)，a/b/c 为对边长 */
    var sa = Math.hypot(bx - cx, by - cy),
        sb = Math.hypot(cx - ax, cy - ay),
        sc = Math.hypot(ax - bx, ay - by),
        per = sa + sb + sc;
    if (per < 1e-12) return null;
    return [(sa * ax + sb * bx + sc * cx) / per, (sa * ay + sb * by + sc * cy) / per];
  }
  /* 垂心：欧拉关系 H = A + B + C − 2·O（O 为外心） */
  var O = circumcenterOf(A, B, C);
  if (!O) return null;
  return [ax + bx + cx - 2 * O[0], ay + by + cy - 2 * O[1]];
}
/* 创建三角形中心点（顶点移动时实时联动）；kind: incenter/circumcenter/orthocenter */
function createTriCenter(kind, A, B, C, name, skipTrack) {
  var nm = name || allocName(kind === 'orthocenter' ? 'H' : 'O',
                             kind === 'incenter' ? 'I' : (kind === 'orthocenter' ? 'H' : 'O'));
  var el = board.create('point', [
    function () { var p = triCenterXY(kind, A, B, C); return p ? p[0] : 0; },
    function () { var p = triCenterXY(kind, A, B, C); return p ? p[1] : 0; }
  ], { name: nm });
  el._defKind = 'tricenter';
  el._tcKind = kind;
  el._tcIds = [A.id, B.id, C.id];
  applyDrivenGray(el);
  if (!skipTrack) trackId(el.id);
  return el;
}
/* ---------- 角平分线 ---------- */
/* 角 A-V-B 内角平分线方向上的点（V + 单位方向），返回用户坐标 */
function bisDirXY(V, A, B) {
  var v1x = A.X() - V.X(), v1y = A.Y() - V.Y();
  var v2x = B.X() - V.X(), v2y = B.Y() - V.Y();
  var l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
  if (l1 < 1e-12 || l2 < 1e-12) return [V.X() + 1, V.Y()];
  var dx = v1x / l1 + v2x / l2, dy = v1y / l1 + v2y / l2;
  var l = Math.hypot(dx, dy);
  if (l < 1e-9) { dx = -v1y / l1; dy = v1x / l1; l = 1; }  /* 平角退化：取垂直方向 */
  return [V.X() + dx / l, V.Y() + dy / l];
}
/* 创建 ∠AVB 的角平分线（V 为顶点）：从顶点出发的射线（<180° 内角的平分线），方向实时联动 */
function createBisector(V, A, B, name, skipTrack) {
  var Q = board.create('point', [
    function () { var p = bisDirXY(V, A, B); return p[0]; },
    function () { var p = bisDirXY(V, A, B); return p[1]; }
  ], { name: '', visible: false, fixed: true, withLabel: false });
  Q._defKind = 'bishelp';
  var el = board.create('line', [V, Q], { name: name || nextId('bl'), straightFirst: false, straightLast: true });
  el._defKind = 'bisector';
  el._bisIds = [V.id, A.id, B.id];
  el._bisHelpId = Q.id;
  Q._bisLineId = el.id;
  if (!skipTrack) trackId(el.id);
  return el;
}

/* ---------- 垂线段 ---------- */
/* 点 P 在直线 AB 上的投影：返回 { t, x, y }，t 为 A→B 方向的参数
 *（t<0 / t>1 表示垂足落在对边线段范围之外） */
function perpFootParam(P, A, B) {
  var ax = A.X(), ay = A.Y();
  var dx = B.X() - ax, dy = B.Y() - ay;
  var len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return null;
  var t = ((P.X() - ax) * dx + (P.Y() - ay) * dy) / len2;
  return { t: t, x: ax + t * dx, y: ay + t * dy };
}
/* 垂线段退化检查：返回错误文案，无问题返回 null */
var perpSegHoverKey = null;  // 垂线段第二步当前悬停高亮的边标识（null = 无悬停）
/* 垂线段第二步悬停反馈：鼠标落在线段/多边形边上时高亮其两端点；
 * 已有点优先（与点击拾取的优先级一致，避免抢点的拾取）；
 * 起点 P 全程保持高亮，表示"已选起点"。 */
function perpSegHover(sx, sy) {
  var hit = null;
  if (!findPointNear(sx, sy)) hit = findSegOrPolyEdgeAt(sx, sy);
  var key = hit ? hit.key : null;
  if (key === perpSegHoverKey) return;
  perpSegHoverKey = key;
  clearFlashes();
  if (pendingPts.length > 0 && pendingPts[0]) { try { flashOn(pendingPts[0]); } catch (e) {} }
  if (hit) { try { flashOn(hit.p1); flashOn(hit.p2); } catch (e) {} }
}
var midpointHoverKey = null;  // 中点工具当前悬停高亮的边标识（null = 无悬停）
/* 中点工具悬停反馈：鼠标落在线段/多边形边上时高亮其两端点（点击即取该边中点）；
 * 已有点优先（与点击拾取的优先级一致）。 */
function midpointHover(sx, sy) {
  var hit = null;
  if (!findPointNear(sx, sy)) hit = findSegOrPolyEdgeAt(sx, sy);
  var key = hit ? hit.key : null;
  if (key === midpointHoverKey) return;
  midpointHoverKey = key;
  clearFlashes();
  if (pendingPts.length > 0 && pendingPts[0]) { try { flashOn(pendingPts[0]); } catch (e) {} }
  if (hit) { try { flashOn(hit.p1); flashOn(hit.p2); } catch (e) {} }
}
function checkPerpSeg(P, A, B) {
  if (P.id === A.id || P.id === B.id) return '对边端点不能与垂线段起点重合，请重新选择。';
  if (A.id === B.id) return '对边的两个点不能是同一个点，请重新选择。';
  var dx = B.X() - A.X(), dy = B.Y() - A.Y();
  var len = Math.hypot(dx, dy);
  if (len < 1e-12) return '对边两点重合，无法作垂线段，请重新选择。';
  var dist = Math.abs(dx * (A.Y() - P.Y()) - (A.X() - P.X()) * dy) / len;
  if (dist < 1e-9) return '起点在对边直线上，无法作垂线段，请重新选择。';
  return null;
}
/* 已存在的垂线段（P 相同、对边端点无序匹配），用于避免重复创建 */
function findPerpSegOf(P, A, B) {
  for (var i = 0; i < createdIds.length; i++) {
    var o = board.objects[createdIds[i]];
    if (!o || o._defKind !== 'perpseg' || !o._psegIds) continue;
    var q = o._psegIds;
    if (q[0] === P.id &&
        ((q[1] === A.id && q[2] === B.id) || (q[1] === B.id && q[2] === A.id))) return o;
  }
  return null;
}
/* 垂线段拾取失败：清掉待定点并提示 */
/* 垂线段对边非法时：保留已选起点 P，停在第二步让用户重选对边（而不是回退到选起点，避免误新建点） */
function perpSegFail(msg, keepP) {
  pendingPts = keepP ? [keepP] : [];
  pendingReused = false; pendingInter = false; clearFlashes();
  perpSegHoverKey = null;
  setStatus(msg, false);
  document.getElementById('hint').textContent = keepP ?
    '已选垂线段起点 ' + keepP.name + ' — 请重新点击一条线段/边作对边，或依次点击对边两个点。' :
    HINTS.perpseg;
}
/* 垂线段拾取完成：退化检查 → 判重 → 创建 */
function perpSegDone(P, A, B) {
  var err = checkPerpSeg(P, A, B);
  if (err) { perpSegFail(err, P); return; }
  var dup = findPerpSegOf(P, A, B);
  pendingPts = [];
  if (dup) { flashOn(dup); setStatus('该垂线段已存在：' + dup.name + '。', true); }
  else {
    var s = createPerpSeg(P, A, B, nextId('ps'));
    flashOn(s);
    var fh = s._footId && board.objects[s._footId];
    var note = pendingInter ? '（含联动交点）' : (pendingReused ? '（复用了已有点）' : '');
    setStatus('已创建垂线段 ' + s.name + note + '（垂足 ' + (fh ? fh.name : '?') + '，拖动时联动）。', true);
  }
  pendingReused = false; pendingInter = false; clearFlashes();
  perpSegHoverKey = null;
  document.getElementById('hint').textContent = HINTS.perpseg;
}
/* 创建垂线段：P 为起点，A、B 为对边两端点。
 * 生成：垂线段 seg（P→垂足 H，登记为步骤 id）、垂足点 H（函数坐标，实时联动）、
 * 越界连接段 H–A、H–B（附属对象，仅当垂足落在线段 AB 范围外时可见，拖动时自动显隐）。 */
function createPerpSeg(P, A, B, name, skipTrack) {
  var nm = name || nextId('ps');
  var H = board.create('point', [
    function () { var f = perpFootParam(P, A, B); return f ? f.x : P.X(); },
    function () { var f = perpFootParam(P, A, B); return f ? f.y : P.Y(); }
  ], { name: allocName('D', 'D'), fixed: true, withLabel: true });
  H._defKind = 'pfoot';
  applyDrivenGray(H);
  var seg = board.create('segment', [P, H], { name: nm });
  seg._defKind = 'perpseg';
  seg._psegIds = [P.id, A.id, B.id];
  seg._footId = H.id;
  H._segId = seg.id;
  /* 越界连接段：visible 用函数动态判定，拖动对边端点导致垂足进出范围时自动显隐；
   * 垂足越界（t<0 或 t>1）时 H–A、H–B 两条同时显示，范围内则同时隐藏 */
  function mkExt(Q) {
    var e = board.create('segment', [H, Q], {
      name: '', withLabel: false,
      visible: function () {
        var f = perpFootParam(P, A, B);
        return !!f && (f.t < 0 || f.t > 1);
      }
    });
    e._defKind = 'psegext';
    e._segId = seg.id;
    return e;
  }
  mkExt(A);
  mkExt(B);
  if (!skipTrack) trackId(seg.id);
  return seg;
}
/* 以 cc 为圆心，从 cc→p 到 cc→q 的逆时针夹角（弧度，[0, 2π)） */
function ccwAngleOnCircle(cc, p, q) {
  var t = Math.atan2(q.Y() - cc[1], q.X() - cc[0]) - Math.atan2(p.Y() - cc[1], p.X() - cc[0]);
  if (t < 0) t += Math.PI * 2;
  return t;
}
/* 三点圆弧：生成依次经过 pA→pB→pC 的圆弧。
 * 原理：JSXGraph 的 arc 默认从起点逆时针扫到终点；
 * 若中间点 B 不在 A→C 的逆时针弧上，则交换起终点画 C→A 的逆时针弧——
 * 点集与 A→C 的顺时针弧完全相同。不能用 orientation:'clockwise'：
 * JSXGraph 的 glider 定位只按逆时针区间算角度，顺时针弧上描点会被吸到端点。 */
function createArc3(pA, pB, pC, name) {
  var cc = circumcenterOf(pA, pB, pC);
  if (!cc) throw new Error('三点共线，无法确定圆弧');
  /* 圆心：随三点联动的隐藏辅助点（不进对象列表、不序列化，随圆弧重建） */
  var O = board.create('point', [
    function () { var r = circumcenterOf(pA, pB, pC); return r ? r[0] : 0; },
    function () { var r = circumcenterOf(pA, pB, pC); return r ? r[1] : 0; }
  ], { name: '', visible: false, fixed: true, withLabel: false });
  O._defKind = 'arc3center';
  var thB = ccwAngleOnCircle(cc, pA, pB);
  var thC = ccwAngleOnCircle(cc, pA, pC);
  var arcEl = null;
  try {
    arcEl = board.create('arc', (thB > thC) ? [O, pC, pA] : [O, pA, pC], { name: name });
  } catch (err) {
    /* 圆弧创建失败时清理已建的隐藏圆心，避免残留 */
    try { board.removeObject(O); } catch (e2) {}
    throw err;
  }
  arcEl._defKind = 'arc3';
  arcEl._arc3pts = [pA.id, pB.id, pC.id];
  arcEl._arc3centerId = O.id;
  O._arc3arcId = arcEl.id;
  return arcEl;
}

