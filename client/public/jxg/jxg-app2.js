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
    }
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    var k = (e.key || '').toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); doRedo(); }
    return;
  }
  /* Del：删除当前选中的对象（含级联依赖）；未选中时提示 */
  if (e.key === 'Delete' || e.key === 'Del') { e.preventDefault(); deleteSelection(); }
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
  try { document.getElementById('adriveKWrap').style.display = (m === 'adrive') ? 'inline-flex' : 'none'; } catch (e) {}
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
           o._defKind === 'pfoot' || o._defKind === 'psegext')) { try { board.removeObject(o); } catch (e) {} }
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
  if (dk === 'ngonpt') return null;      // 正 N 边形的派生顶点，随 regularpolygon 步骤一起重建
  if (dk === 'ngoncenter') return null;  // 两点模式的隐藏中心点，随 regularpolygon 步骤一起重建
  if (dk === 'glider') {
    /* 多边形边上的约束点：边无独立名称，用 polygon+edge 定位（与 intersection 一致） */
    if (o._polyEdge)
      return { type: 'point', id: nm, polygon: oname(o._polyEdge.polyId),
               edge: o._polyEdge.edgeIdx, coords: [r4(o.X()), r4(o.Y())] };
    return { type: 'point', id: nm, on: oname(o._onId), coords: [r4(o.X()), r4(o.Y())] };
  }
    if (dk === 'mirrorpt')
      return { type: 'mirrorpt', id: nm, of: oname(o._mirrorIds[0]), axis: oname(o._mirrorIds[1]), t: o._mtype };
    if (dk === 'rotate')
      return { type: 'rotate', id: nm, of: oname(o._rotOf), center: oname(o._rotCenter), angle: o._rotAngle };
    if (dk === 'dilate')
      return { type: 'dilate', id: nm, of: oname(o._dilOf), center: oname(o._dilCenter), ratio: o._dilRatio };
    if (dk === 'exprpoint')
      return { type: 'exprpoint', id: nm, x: o._exprX, y: o._exprY };
    if (dk === 'sidepick')
      return { type: 'intersection', id: nm, e1: oname(o._sideE1), e2: oname(o._sideE2),
               side: { line: oname(o._sideLine), point: oname(o._sidePoint), rel: o._sideRel } };
  if (o._measure) {
    if (o._measure.kind === 'length')
      return { type: 'measure', id: nm, kind: 'length', of: oname(o._measure.of) };
    return { type: 'measure', id: nm, kind: 'angle',
             p1: oname(o._measure.pts[0]), vertex: oname(o._measure.pts[1]), p2: oname(o._measure.pts[2]) };
  }
  if (o._isExprText)
    return { type: 'text', id: nm, at: [r4(o.X()), r4(o.Y())], expr: o._exprText };
  if (dk === 'angdrive')
    return { type: 'angdrive', id: nm, vertex: oname(o._adVertex), side: oname(o._adSide),
             k: o._adK, src: o._adSrcName };
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

/* ---------- 画板点击 ---------- */
function getUsrCoords(e) {
  var cPos = board.getCoordsTopLeftCorner(e);
  var absPos = JXG.getPosition(e);
  var dx = absPos[0] - cPos[0];
  var dy = absPos[1] - cPos[1];
  return new JXG.Coords(JXG.COORDS_BY_SCREEN, [dx, dy], board);
}

board.on('down', function (e) {
  if (e.button === 2) {
    /* 右键拖动 = 平移视图（选择/只读模式，与左键空白拖动互斥）；
     * 原地右击（未拖动）仍走下方 contextmenu 菜单 */
    if (mode === 'select' || (typeof READ_ONLY !== 'undefined' && READ_ONLY)) {
      try {
        var cPosR0 = board.getCoordsTopLeftCorner(e);
        var absPosR0 = JXG.getPosition(e);
        var rpx = absPosR0[0] - cPosR0[0], rpy = absPosR0[1] - cPosR0[1];
        rightPan = { sx: rpx, sy: rpy, ox: rpx, oy: rpy, moved: false };
      } catch (eR0) { rightPan = null; }
    }
    return;
  }
  /* 只读态：不拦截原生拖拽（点可拖），但只做视图平移兜底，随后直接返回，
   * 禁止一切工具新建/删除/约束/多选搬运 */
  if (typeof READ_ONLY !== 'undefined' && READ_ONLY) {
    try {
      var cPosR = board.getCoordsTopLeftCorner(e);
      var absPosR = JXG.getPosition(e);
      var sxR = absPosR[0] - cPosR[0], syR = absPosR[1] - cPosR[1];
      panState = findPointNear(sxR, syR) ? null : { sx: sxR, sy: syR };
    } catch (eR) { panState = null; }
    return;
  }
  var cPos0 = board.getCoordsTopLeftCorner(e);
  var absPos0 = JXG.getPosition(e);
  var sx = absPos0[0] - cPos0[0], sy = absPos0[1] - cPos0[1];

  /* 轨迹运动中：被动画驱动的主动点只允许点选，不接受用户拖拽（位置每帧由动画写回）；
   * 其余交互——视图平移、对象选择/拖动——保持可用 */
  var animMoverHit = null;
  if (traceAnim.running) {
    try {
      var pHit = findPointNear(sx, sy);
      if (pHit && isAnimMover(pHit)) animMoverHit = pHit;
    } catch (e0) { animMoverHit = null; }
  }
  /* 关闭本轮对该主动点的原生拖拽（各工具模式通用；点选/框选等不受影响） */
  if (animMoverHit && board.mode === board.BOARD_MODE_DRAG) {
    board.mode = board.BOARD_MODE_NONE;
  }

  /* 单点原生拖拽的撤销支持：按下时若命中一个点，先存下"拖拽前"快照；
   * multiDrag/moveSel 走自己的历史；up 时只有真移动了才入栈，避免纯点击产生空历史 */
  singleDrag = null;
  candHighlightOff();   // 新一轮手势开始，清除上一轮残留的候选高亮
  try {
    var ptDown = findPointNear(sx, sy);
    if (ptDown && ptDown !== animMoverHit) singleDrag = { point: ptDown, x0: ptDown.X(), y0: ptDown.Y(), pre: snapshotState() };
  } catch (e) { singleDrag = null; }
  /* 表达式文本原生拖拽的撤销支持：按下命中文本时存"拖拽前"快照（up 时真移动了才入栈） */
  textDragPre = null;
  try {
    var txtDown = findObjectAt(sx, sy, (getUsrCoords(e).usrCoords[1]), (getUsrCoords(e).usrCoords[2]));
    if (txtDown && txtDown.elType === 'text' && txtDown._isExprText)
      textDragPre = { el: txtDown, x0: txtDown.X(), y0: txtDown.Y(), pre: snapshotState() };
  } catch (e) { textDragPre = null; }

  /* 双击检测：多边形模式下双击某处，直接用已有顶点闭合多边形 */
  var nowMs = Date.now();
  var prevDownX = lastDownX, prevDownY = lastDownY;   // 上一次按下的位置（更新前取）
  var prevDownTime = lastDownTime;
  var isDbl = (mode === 'polygon') && polyPts.length >= 3 &&
              (nowMs - lastDownTime < 450) &&
              Math.hypot(sx - lastDownX, sy - lastDownY) < 12;
  lastDownTime = nowMs; lastDownX = sx; lastDownY = sy;
  blankDownAddKey = false;
  if (isDbl) { finishPolygon(); return; }

  /* 双击约束点（蓝色）：取消约束，原地还原为自由点（选择/框选模式） */
  if ((mode === 'select' || mode === 'marquee') &&
      (nowMs - prevDownTime < 450) &&
      Math.hypot(sx - prevDownX, sy - prevDownY) < 12) {
    var dblPt = findPointNear(sx, sy);
    if (dblPt && dblPt._defKind === 'glider') { freeGliderPoint(dblPt); return; }
  }

  /* 用户坐标（select 分支的选区判断需要用到，提前计算） */
  var coords = getUsrCoords(e);
  var x = coords.usrCoords[1], y = coords.usrCoords[2];

  /* 组合手势历史捆绑：拾取状态全部清空 = 上个手势已结束 → 关闭旧包并登记列表分组；
   * 组合工具在无 pending 状态下开新包（懒记：第一次真正创建对象时才 pushHistory），
   * 同一手势里的点/辅助/图形共享一条撤销。 */
  if (histBundled !== false && !pendingPts.length && !polyPts.length && !pendingCurve &&
      pendingParPoint === null && !symPending.length) {
    closeHistoryBundle();
  }
  if (histBundled === false && COMPOSITE_BUNDLE_MODES[mode] &&
      !pendingPts.length && !polyPts.length && !pendingCurve && pendingParPoint === null) {
    histBundled = 'open';
    gestureGroupIds = [];
  }

  /* 框选工具：按住拖拽拉出虚线框；只有完全被框住的图形才会被选中 */
  if (mode === 'marquee') {
    var addKeyM = !!(e.shiftKey || e.ctrlKey || e.metaKey);
    /* 按在当前圈选已选中的对象（或其定义点）上 → 整体移动选择集，不重新开始框选；
     * 与选择模式同一套判定/搬运逻辑，框选-移动-再框选无需切工具 */
    var mHit = findObjectAt(sx, sy, x, y);
    var mOnSel = mHit && (isSelected(mHit) ||
      (mHit.elementClass === JXG.OBJECT_CLASS_POINT &&
       selectedObjs.some(function (o) { return definesPoint(o, mHit); })));
    if (!addKeyM && mOnSel) {
      panState = null;
      startMoveSelection(sx, sy, findPointNear(sx, sy));
      /* 按中非点对象（线段/圆/多边形…）：关闭原生拖拽，统一走 moveSel 手动整体移动，
       * 否则被按中的对象跟手、其余选中对象冻结（多选位移不一致） */
      if (moveSel && mHit.elementClass !== JXG.OBJECT_CLASS_POINT && mHit.elType !== 'text' &&
          board.mode === board.BOARD_MODE_DRAG) {
        board.mode = board.BOARD_MODE_NONE;
      }
      return;
    }
    /* 框选按下时关闭 JSXGraph 原生对象拖拽，避免框选顺带移动图元 */
    try { if (board.mode === board.BOARD_MODE_DRAG) board.mode = board.BOARD_MODE_NONE; } catch (eM) {}
    panState = null;
    startMarquee(sx, sy, addKeyM);
    return;
  }
  /* 选择工具：点选图形查看信息，点击空白处取消；空白处按下拖动可平移视图 */
  if (mode === 'select') {
    var hit = findObjectAt(sx, sy, x, y);
    var addKey = !!(e.shiftKey || e.ctrlKey || e.metaKey);
    pendingSingleSel = null;
    if (hit) {
      if (addKey) {
        toggleSelect(hit);
        if (isSelected(hit)) startMoveSelection(sx, sy, findPointNear(sx, sy));
      } else {
        /* 点中的是已选对象，或是某已选对象的定义点 → 视为按中选择集 */
        var onSel = isSelected(hit) ||
          (hit.elementClass === JXG.OBJECT_CLASS_POINT &&
           selectedObjs.some(function (o) { return definesPoint(o, hit); }));
        if (!onSel) {
          selectSingle(hit);
          startMoveSelection(sx, sy, findPointNear(sx, sy));
        } else {
          /* 保持多选并准备整体移动；纯单击（无拖拽）时在 mouseup 收拢为单选 */
          if (selectedObjs.length > 1) pendingSingleSel = hit;
          startMoveSelection(sx, sy, findPointNear(sx, sy));
        }
      }
      panState = null;
      /* 按中非点对象（线段/圆/多边形…）时：JSXGraph 会同时启动对该对象的原生拖拽，
       * 把它的定义点按鼠标原始位移搬运；而应用的 moveSel 也搬运同一批点，并以
       * “已被原生搬过的 lead 点”为基准算增量 → 增量约等于 0，其余已选对象冻结。
       * 结果就是被按中的对象跟手、其余对象几乎不动（多选位移不一致），且原生
       * 拖拽不走网格吸附。选择模式下统一走 moveSel，本轮关闭原生拖拽；
       * 点保持原生拖拽（供 multiDrag 主点与单点拖拽使用）。 */
      if (moveSel && hit.elementClass !== JXG.OBJECT_CLASS_POINT && hit.elType !== 'text' &&
          board.mode === board.BOARD_MODE_DRAG) {
        board.mode = board.BOARD_MODE_NONE;
      }
    } else if (!addKey && selectedObjs.length > 0 && inSelectionArea(x, y)) {
      /* 点中选区内空白：不取消选择，直接准备整体移动 */
      panState = null;
      startMoveSelection(sx, sy, null);
    } else {
      /* 空白处：左键拖动 = 平移视图（框选已移至独立的框选工具）；
       * 纯点击（无位移）则在 mouseup 取消选择 */
      panState = { sx: sx, sy: sy, moved: false };
      blankDownAddKey = addKey;
    }
    return;
  }

  /* 交点工具：依次点选两条曲线，生成联动的交点 */
  if (mode === 'intersect') {
    var cv = findCurveAt(sx, sy);
    if (!cv) { setStatus('请点击一条直线、线段或圆。', false); return; }
    if (!pendingCurve) {
      pendingCurve = cv;
      flashOn(cv);
      document.getElementById('hint').textContent =
        '已选第一条' + curveLabel(cv) + '，再点击第二条直线/线段/圆。';
    } else {
      if (pendingCurve.id === cv.id) {
        setStatus('不能选择同一条线，请重新选择第二条。', false);
        return;
      }
      var ips = computeIntersections(pendingCurve, cv);
      clearFlashes();
      pendingCurve = null;
      if (ips.length === 0) {
        setStatus('这两条线没有交点。', false);
      } else {
        ips.forEach(function (ip) { adoptIntersection(ip); });
        setStatus('已创建 ' + ips.length + ' 个交点（联动：图形移动时交点跟着动）。', true);
      }
      document.getElementById('hint').textContent = HINTS.intersect;
    }
    return;
  }

  /* 对称/旋转工具：先选对称轴/对称中心/旋转中心，再多选图形，双击空白处生成 */
  if (mode === 'axsym' || mode === 'ctsym' || mode === 'rotate') {
    handleSymDown(x, y, sx, sy);
    return;
  }

  /* 度量：长度 — 点选线段/圆/圆弧/多边形，生成长度变量 */
  if (mode === 'mlen') {
    var mh = findObjectAt(sx, sy, x, y);
    if (!mh) { setStatus('请点击一条线段、圆、圆弧或多边形。', false); return; }
    if (!isFinite(measureLenOf(mh))) {
      setStatus('该对象没有有限长度（直线/射线无限长），请选线段、圆、圆弧或多边形。', false);
      return;
    }
    var lm = makeLengthMeasure(mh, nextSeqId('L'));
    setStatus('已创建' + describeDef(lm) + '。', true);
    return;
  }
  /* 度量：角度 — 依次三点（第 2 点为角顶点） */
  if (mode === 'mang') {
    var rp = pickOrCreatePoint(x, y, sx, sy);
    pendingPts.push(rp.point);
    if (pendingPts.length < 3) {
      document.getElementById('hint').textContent =
        '角度度量：已选 ' + pendingPts.length + '/3 点' +
        (pendingPts.length === 1 ? '（第 2 点为角顶点）' : '') + '。';
      return;
    }
    var mpa = pendingPts[0], mpv = pendingPts[1], mpb = pendingPts[2];
    pendingPts = []; pendingReused = false; pendingInter = false; clearFlashes();
    var am = makeAngleMeasure(mpa, mpv, mpb, nextSeqId('a'));
    document.getElementById('hint').textContent = HINTS.mang;
    setStatus('已创建' + describeDef(am) + '。', true);
    return;
  }
  /* 度量：表达式文本 — 工具栏输入表达式，点击空白处放置 */
  if (mode === 'mtext') {
    var exprInput = document.getElementById('msrExpr');
    var mexpr = exprInput ? exprInput.value.trim() : '';
    if (!mexpr) { setStatus('请先在工具栏右侧输入表达式（如 2*L1+a1/2）。', false); return; }
    var mtx = makeExprTextEl(mexpr, x, y, nextSeqId('t'));
    setStatus('已创建' + describeDef(mtx) + '。', true);
    return;
  }
  /* 从动角 — 依次：基准角三点（第 2 点为顶点）→ 目标顶点 → 目标边点；倍数 k 在工具栏输入 */
  if (mode === 'adrive') {
    var rk = pickOrCreatePoint(x, y, sx, sy);
    pendingPts.push(rk.point);
    var adStages = ['基准角第 1 个点', '基准角顶点', '基准角第 2 个点', '目标角顶点', '目标角起始边上的点'];
    if (pendingPts.length < 5) {
      document.getElementById('hint').textContent =
        '从动角：已选 ' + pendingPts.length + '/5，请点击' + adStages[pendingPts.length] + '。';
      return;
    }
    var bp1 = pendingPts[0], bv = pendingPts[1], bp2 = pendingPts[2],
        tv = pendingPts[3], ts = pendingPts[4];
    pendingPts = []; pendingReused = false; pendingInter = false; clearFlashes();
    if (tv.id === ts.id) {
      setStatus('目标顶点与边上的点不能是同一个点，请重新操作。', false);
      document.getElementById('hint').textContent = HINTS.adrive;
      return;
    }
    var kEl = document.getElementById('adriveK');
    var ak = kEl ? Number(kEl.value) : 1;
    if (!isFinite(ak)) ak = 1;
    /* 复用同三点的已有角度度量作为基准；没有则顺手新建 */
    var srcCarrier = null;
    for (var ci = 0; ci < createdIds.length; ci++) {
      var cc = board.objects[createdIds[ci]];
      if (cc && cc._measure && cc._measure.kind === 'angle') {
        var cpts = cc._measure.pts;
        if (cpts[0] === bp1.id && cpts[1] === bv.id && cpts[2] === bp2.id) { srcCarrier = cc; break; }
      }
    }
    if (!srcCarrier) srcCarrier = makeAngleMeasure(bp1, bv, bp2, nextSeqId('a'));
    var dp = makeAngleDrivenPoint(tv, ts, srcCarrier, ak, nextId('P'));
    document.getElementById('hint').textContent = HINTS.adrive;
    setStatus('已创建' + describeDef(dp) + '。', true);
    return;
  }

  /* 开始一次新的作图操作时，先清除上一轮复用点的高亮 */
  if (pendingPts.length === 0 && polyPts.length === 0) clearFlashes();

  if (mode === 'pline' || mode === 'pray' || mode === 'pseg' || mode === 'psegfree') {
    handleParallelDown(x, y, sx, sy);
  } else if (mode === 'point') {
    var r0 = pickOrCreatePoint(x, y, sx, sy);
    document.getElementById('hint').textContent = r0.isIntersection
      ? '已在两线交叉处生成联动' + describeObj(r0.point) + '。'
      : (r0.isGlider ? '已生成' + describeObj(r0.point) + '。'   /* describeObj 已含约束位置（含多边形边） */
      : (r0.reused ? '已选中已有' + describeObj(r0.point) + '，没有新建点。' : HINTS.point));
  } else if (mode === 'segment' || mode === 'line' || mode === 'ray' || mode === 'circle') {
    var r = pickOrCreatePoint(x, y, sx, sy);
    if (r.reused) pendingReused = true;
    if (r.isIntersection) pendingInter = true;
    pendingPts.push(r.point);
    if (pendingPts.length === 2) {
      var a = pendingPts[0], b = pendingPts[1], el;
      if (a.id === b.id) {
        setStatus('两次选择了同一个点，请重新选择两个不同的点。', false);
        pendingPts = []; pendingReused = false; pendingInter = false; clearFlashes();
        return;
      }
      if (mode === 'segment')      el = board.create('segment', [a, b], { name: nextId('s') });
      else if (mode === 'line')    el = board.create('line', [a, b], { name: nextId('l') });
      else if (mode === 'ray') {
        el = board.create('line', [a, b], { name: nextId('r'), straightFirst: false, straightLast: true });
        el._defKind = 'ray';
      }
      else {
        el = board.create('circle', [a, b], { name: nextId('c') });
        el._defKind = 'circleThrough';
      }
      trackId(el.id);
      pendingPts = [];
      var reusedMsg = pendingInter ? '（含联动交点）' : (pendingReused ? '（复用了已有点）' : '');
      pendingReused = false; pendingInter = false;
      clearFlashes();
      setStatus('已创建图形' + reusedMsg + '。', true);
      document.getElementById('hint').textContent = HINTS[mode];
    } else {
      document.getElementById('hint').textContent =
        '已选第一点' + reuseLabel(r) + '，再点击第二个位置。';
    }
  } else if (mode === 'ngon') {
    /* 正 N 边形：两点模式=依次点两个相邻顶点（逆时针）；中心模式=先中心后一个顶点 */
    var rn = pickOrCreatePoint(x, y, sx, sy);
    if (rn.reused) pendingReused = true;
    if (rn.isIntersection) pendingInter = true;
    pendingPts.push(rn.point);
    if (pendingPts.length === 2) {
      var na = pendingPts[0], nb = pendingPts[1];
      if (na.id === nb.id) {
        setStatus('两次选择了同一个点，请重新选择两个不同的位置。', false);
        pendingPts = []; pendingReused = false; pendingInter = false; clearFlashes();
        return;
      }
      var nWant = Math.round(Number(document.getElementById('ngonN').value));
      if (!isFinite(nWant) || nWant < 3 || nWant > 60) nWant = 6;
      var byCtr = document.getElementById('ngonMode').value === 'center';
      pushHistory();
      try {
        var npg = createRegularPolygon(byCtr
          ? { id: nextId('p'), n: nWant, byCenter: true, v0: nb, cen: na }
          : { id: nextId('p'), n: nWant, byCenter: false, v0: na, p2: nb });
        trackId(npg.id);
        var reusedMsg2 = pendingInter ? '（含联动交点）' : (pendingReused ? '（复用了已有点）' : '');
        setStatus('已创建正 ' + nWant + ' 边形' + reusedMsg2 + '。', true);
      } catch (err2) {
        setStatus('创建正 N 边形失败：' + err2.message, false);
      }
      pendingPts = []; pendingReused = false; pendingInter = false;
      clearFlashes();
      document.getElementById('hint').textContent = HINTS.ngon;
    } else {
      var ctrMode = document.getElementById('ngonMode').value === 'center';
      document.getElementById('hint').textContent = '已选' +
        (ctrMode ? '中心' : '第一个顶点') + reuseLabel(rn) + '，再点击' +
        (ctrMode ? '一个顶点' : '下一个相邻顶点（逆时针方向）') + '。';
    }
  } else if (mode === 'circle3') {
    /* 三点圆：依次点三个点，生成三点确定的圆（外接圆） */
    var r3 = pickOrCreatePoint(x, y, sx, sy);
    if (r3.reused) pendingReused = true;
    if (r3.isIntersection) pendingInter = true;
    pendingPts.push(r3.point);
    if (pendingPts.length === 3) {
      var p1 = pendingPts[0], p2 = pendingPts[1], p3 = pendingPts[2];
      pendingPts = [];
      if (p1.id === p2.id || p2.id === p3.id || p1.id === p3.id) {
        setStatus('三点中有重复，请选择三个不同的点。', false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS.circle3;
        return;
      }
      if (triArea(p1, p2, p3) < 1e-9) {
        setStatus('三点共线，无法确定圆，请重新选择。', false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS.circle3;
        return;
      }
      var c3;
      try { c3 = board.create('circle', [p1, p2, p3], { name: nextId('c') }); }
      catch (err) {
        setStatus('无法创建三点圆：' + err.message, false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS.circle3;
        return;
      }
      c3._defKind = 'circle3';
      trackId(c3.id);
      var note3 = pendingInter ? '（含联动交点）' : (pendingReused ? '（复用了已有点）' : '');
      pendingReused = false; pendingInter = false;
      clearFlashes();
      setStatus('已创建三点圆' + note3 + '。', true);
      document.getElementById('hint').textContent = HINTS.circle3;
    } else {
      document.getElementById('hint').textContent =
        '已选第 ' + pendingPts.length + ' 点' + reuseLabel(r3) + '，还需 ' + (3 - pendingPts.length) + ' 点。';
    }
  } else if (mode === 'ellipse' || mode === 'hyperbola') {
    /* 椭圆/双曲线：依次点两个焦点，再点曲线上一点（焦点/曲线上点可复用已有点/交点） */
    var rC = pickOrCreatePoint(x, y, sx, sy);
    if (rC.reused) pendingReused = true;
    if (rC.isIntersection) pendingInter = true;
    pendingPts.push(rC.point);
    if (pendingPts.length === 3) {
      var f1 = pendingPts[0], f2 = pendingPts[1], pc = pendingPts[2];
      pendingPts = [];
      var cname = mode === 'ellipse' ? '椭圆' : '双曲线';
      if (f1.id === f2.id || f1.id === pc.id || f2.id === pc.id) {
        setStatus('三点中有重复，请选择两个焦点和曲线上一个不同的点。', false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS[mode];
        return;
      }
      if (triArea(f1, f2, pc) < 1e-9) {
        setStatus('三点共线，无法确定' + cname + '，请重新选择。', false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS[mode];
        return;
      }
      var con;
      try { con = board.create(mode, [f1, f2, pc], { name: nextId(mode === 'ellipse' ? 'e' : 'h') }); }
      catch (err) {
        setStatus('无法创建' + cname + '：' + err.message, false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS[mode];
        return;
      }
      con._defKind = mode;
      con._conicIds = [f1.id, f2.id, pc.id];
      trackId(con.id);
      var noteC = pendingInter ? '（含联动交点）' : (pendingReused ? '（复用了已有点）' : '');
      pendingReused = false; pendingInter = false;
      clearFlashes();
      setStatus('已创建' + cname + noteC + '。', true);
      document.getElementById('hint').textContent = HINTS[mode];
    } else {
      document.getElementById('hint').textContent =
        (pendingPts.length === 1 ? '已选第一个焦点' : '已选第二个焦点') + reuseLabel(rC) +
        '，再点击' + (pendingPts.length === 1 ? '第二个焦点' : (mode === 'ellipse' ? '椭圆上一点' : '双曲线上一点')) + '。';
    }
  } else if (mode === 'parabola') {
    /* 抛物线：先点焦点（可复用已有点/交点），再点一条直线/线段作准线 */
    if (!pendingPts.length) {
      var rF = pickOrCreatePoint(x, y, sx, sy);
      if (rF.reused) pendingReused = true;
      if (rF.isIntersection) pendingInter = true;
      pendingPts.push(rF.point);
      document.getElementById('hint').textContent =
        '已选焦点' + reuseLabel(rF) + '，再点击一条直线或线段作准线。';
      return;
    }
    var dirx = findCurveAt(sx, sy);
    if (!dirx || (dirx.elType !== 'line' && dirx.elType !== 'segment')) {
      setStatus('请点选一条直线或线段作准线。', false);
      return;
    }
    var foc = pendingPts[0];
    pendingPts = [];
    /* 焦点不能在准线上（退化） */
    var dq = projectPointToCurve(foc.X(), foc.Y(), dirx);
    var degD = dq ? Math.hypot(dq[0] - foc.X(), dq[1] - foc.Y()) : 0;
    if (degD < 1e-6) {
      setStatus('焦点在准线上，无法确定抛物线，请重新选择。', false);
      pendingReused = false; pendingInter = false; clearFlashes();
      document.getElementById('hint').textContent = HINTS.parabola;
      return;
    }
    var par;
    try { par = board.create('parabola', [foc, dirx], { name: nextId('p') }); }
    catch (err) {
      setStatus('无法创建抛物线：' + err.message, false);
      pendingReused = false; pendingInter = false; clearFlashes();
      document.getElementById('hint').textContent = HINTS.parabola;
      return;
    }
    par._defKind = 'parabola';
    par._conicIds = [foc.id, dirx.id];
    trackId(par.id);
    var noteP = pendingInter ? '（含联动交点）' : (pendingReused ? '（复用了已有点）' : '');
    pendingReused = false; pendingInter = false;
    clearFlashes();
    setStatus('已创建抛物线' + noteP + '。', true);
    document.getElementById('hint').textContent = HINTS.parabola;
  } else if (mode === 'conic') {
    /* 五点二次曲线：依次点五个点，自动生成椭圆/双曲线/抛物线（类型自动判断） */
    var rk = pickOrCreatePoint(x, y, sx, sy);
    if (rk.reused) pendingReused = true;
    if (rk.isIntersection) pendingInter = true;
    pendingPts.push(rk.point);
    if (pendingPts.length === 5) {
      var k5p = pendingPts.slice();
      pendingPts = [];
      var seenK = {}, dupK = false;
      k5p.forEach(function (p) { if (seenK[p.id]) dupK = true; seenK[p.id] = 1; });
      if (dupK) {
        setStatus('五点中有重复，请选择五个不同的点。', false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS.conic;
        return;
      }
      if (triArea(k5p[0], k5p[1], k5p[2]) < 1e-9 && triArea(k5p[2], k5p[3], k5p[4]) < 1e-9) {
        setStatus('五点共线（退化），无法确定二次曲线，请重新选择。', false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS.conic;
        return;
      }
      var con;
      try { con = board.create('conic', k5p, { name: nextId('k') }); }
      catch (err) {
        setStatus('无法创建二次曲线：' + err.message, false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS.conic;
        return;
      }
      con._defKind = 'conic';
      con._conicIds = k5p.map(function (p) { return p.id; });
      trackId(con.id);
      var noteK = pendingInter ? '（含联动交点）' : (pendingReused ? '（复用了已有点）' : '');
      pendingReused = false; pendingInter = false;
      clearFlashes();
      setStatus('已创建五点二次曲线' + noteK + '。', true);
      document.getElementById('hint').textContent = HINTS.conic;
    } else {
      document.getElementById('hint').textContent =
        '已选第 ' + pendingPts.length + ' 点' + reuseLabel(rk) + '，还需 ' + (5 - pendingPts.length) + ' 点。';
    }
  } else if (mode === 'midpoint') {
    /* 中点：点击线段/多边形边直接取其中点；或依次点击两个已有点取其中点（不新建点） */
    var mp0 = findPointNear(sx, sy);
    if (!mp0) {
      var segHit = findSegOrPolyEdgeAt(sx, sy);
      if (segHit) {
        /* 选中了线段/边则直接做其中点，之前待定的第一点作废 */
        pendingPts = [];
        pendingReused = false; pendingInter = false; clearFlashes();
        midpointHoverKey = null;
        var sa = segHit.p1, sb = segHit.p2;
        var dup0 = findMidpointOf(sa, sb);
        if (dup0) { flashOn(dup0); setStatus('该线段的中点已存在：' + dup0.name + '。', true); }
        else {
          var m0 = createMidpoint(sa, sb, nextId('M'));
          flashOn(m0);
          setStatus('已创建线段中点 ' + m0.name + '（端点移动时联动）。', true);
        }
        document.getElementById('hint').textContent = HINTS.midpoint;
        return;
      }
    }
    /* 中点工具只允许选择已有的点或线段/多边形边，点击空白处不新建点 */
    if (!mp0) {
      setStatus('中点工具只能选择已有的点或线段：请点击一个已有点，或直接点击一条线段取其中点。', false);
      return;
    }
    flashOn(mp0);
    pendingReused = true;
    pendingPts.push(mp0);
    if (pendingPts.length === 2) {
      var ma = pendingPts[0], mb = pendingPts[1];
      pendingPts = [];
      if (ma.id === mb.id) {
        setStatus('两次选择了同一个点，请重新选择两个不同的点。', false);
        pendingReused = false; pendingInter = false; clearFlashes();
        midpointHoverKey = null;
        document.getElementById('hint').textContent = HINTS.midpoint;
        return;
      }
      var dup = findMidpointOf(ma, mb);
      if (dup) { flashOn(dup); setStatus('这两点的中点已存在：' + dup.name + '。', true); }
      else {
        var mm = createMidpoint(ma, mb, nextId('M'));
        var noteM = pendingInter ? '（含联动交点）' : (pendingReused ? '（复用了已有点）' : '');
        setStatus('已创建中点 ' + mm.name + noteM + '（端点移动时联动）。', true);
      }
      pendingReused = false; pendingInter = false; clearFlashes();
      midpointHoverKey = null;
      document.getElementById('hint').textContent = HINTS.midpoint;
    } else {
      document.getElementById('hint').textContent =
        '已选第一点 ' + mp0.name + '（已有点），再点击第二个已有点。';
    }
  } else if (mode === 'incenter' || mode === 'circumcenter' || mode === 'orthocenter') {
    /* 三角形中心：依次选三个点，生成联动的内心 / 外心 / 垂心 */
    var tcr = pickOrCreatePoint(x, y, sx, sy);
    if (tcr.reused) pendingReused = true;
    if (tcr.isIntersection) pendingInter = true;
    pendingPts.push(tcr.point);
    if (pendingPts.length === 3) {
      var t1 = pendingPts[0], t2 = pendingPts[1], t3 = pendingPts[2];
      pendingPts = [];
      var tLabel = mode === 'incenter' ? '内心' : (mode === 'circumcenter' ? '外心' : '垂心');
      if (t1.id === t2.id || t2.id === t3.id || t1.id === t3.id) {
        setStatus('三点中有重复，请选择三个不同的点。', false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS[mode];
        return;
      }
      if (triArea(t1, t2, t3) < 1e-9) {
        setStatus('三点共线，无法确定' + tLabel + '，请重新选择。', false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS[mode];
        return;
      }
      var tce = createTriCenter(mode, t1, t2, t3);
      var noteC = pendingInter ? '（含联动交点）' : (pendingReused ? '（复用了已有点）' : '');
      pendingReused = false; pendingInter = false;
      clearFlashes();
      setStatus('已创建' + tLabel + ' ' + tce.name + noteC + '（顶点移动时联动）。', true);
      document.getElementById('hint').textContent = HINTS[mode];
    } else {
      document.getElementById('hint').textContent =
        '已选第 ' + pendingPts.length + ' 点' + reuseLabel(tcr) + '，还需 ' + (3 - pendingPts.length) + ' 点。';
    }
  } else if (mode === 'bisector') {
    /* 角平分线：依次选三点，第 2 点为角顶点，生成 ∠ABC 的角平分线 */
    var bir = pickOrCreatePoint(x, y, sx, sy);
    if (bir.reused) pendingReused = true;
    if (bir.isIntersection) pendingInter = true;
    pendingPts.push(bir.point);
    if (pendingPts.length === 3) {
      var ba = pendingPts[0], bvx = pendingPts[1], bc = pendingPts[2];
      pendingPts = [];
      if (ba.id === bvx.id || bvx.id === bc.id || ba.id === bc.id) {
        setStatus('三点中有重复，请选择三个不同的点。', false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS.bisector;
        return;
      }
      if (triArea(ba, bvx, bc) < 1e-9) {
        setStatus('三点共线，无法确定角平分线，请重新选择。', false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS.bisector;
        return;
      }
      var ble = createBisector(bvx, ba, bc, nextId('bl'));
      var noteB = pendingInter ? '（含联动交点）' : (pendingReused ? '（复用了已有点）' : '');
      pendingReused = false; pendingInter = false;
      clearFlashes();
      setStatus('已创建角平分线 ' + ble.name + noteB + '（顶点移动时联动）。', true);
      document.getElementById('hint').textContent = HINTS.bisector;
    } else {
      document.getElementById('hint').textContent =
        '已选第 ' + pendingPts.length + ' 点' + reuseLabel(bir) + '（第 2 点为角顶点），还需 ' + (3 - pendingPts.length) + ' 点。';
    }
  } else if (mode === 'perpseg') {
    /* 垂线段：先选起点 P；再点击一条线段直接作垂线段，或依次点击对边两点 A、B */
    if (pendingPts.length >= 1) {
      /* 第二步优先看是否点中了线段/多边形边主体（没点中已有点时）→
       * 直接用该边的两端点作对边，不新建点 */
      var pp0 = findPointNear(sx, sy);
      if (!pp0) {
        var psegHit = findSegOrPolyEdgeAt(sx, sy);
        if (psegHit) {
          perpSegHoverKey = null;
          perpSegDone(pendingPts[0], psegHit.p1, psegHit.p2);
          return;
        }
      }
    }
    var pr = pickOrCreatePoint(x, y, sx, sy);
    if (pr.reused) pendingReused = true;
    if (pr.isIntersection) pendingInter = true;
    pendingPts.push(pr.point);
    if (pendingPts.length === 3) {
      perpSegDone(pendingPts[0], pendingPts[1], pendingPts[2]);
    } else if (pendingPts.length === 1) {
      document.getElementById('hint').textContent =
        '已选垂线段起点 ' + pr.point.name + reuseLabel(pr) + ' — 点击一条线段作对边，或依次点击对边两个点。';
    } else {
      document.getElementById('hint').textContent =
        '已选对边第一点 ' + pr.point.name + reuseLabel(pr) + '，再点击对边第二点（或点一条线段直接作对边）。';
    }
  } else if (mode === 'arc') {
    /* 圆弧：先点圆心，再依次点弧的起点和终点 */
    var ra = pickOrCreatePoint(x, y, sx, sy);
    if (ra.reused) pendingReused = true;
    if (ra.isIntersection) pendingInter = true;
    pendingPts.push(ra.point);
    if (pendingPts.length === 3) {
      var ac0 = pendingPts[0], aa1 = pendingPts[1], aa2 = pendingPts[2];
      pendingPts = [];
      if (aa1.id === ac0.id || aa2.id === ac0.id) {
        setStatus('圆弧的起点/终点不能与圆心重合，请重新选择。', false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS.arc;
        return;
      }
      if (aa1.id === aa2.id) {
        setStatus('圆弧的起点和终点不能是同一个点，请重新选择。', false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS.arc;
        return;
      }
      var arcEl;
      try { arcEl = board.create('arc', [ac0, aa1, aa2], { name: nextId('a') }); }
      catch (err) {
        setStatus('无法创建圆弧：' + err.message, false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS.arc;
        return;
      }
      arcEl._defKind = 'arc';
      trackId(arcEl.id);
      var noteA = pendingInter ? '（含联动交点）' : (pendingReused ? '（复用了已有点）' : '');
      pendingReused = false; pendingInter = false;
      clearFlashes();
      setStatus('已创建圆弧' + noteA + '。', true);
      document.getElementById('hint').textContent = HINTS.arc;
    } else {
      document.getElementById('hint').textContent =
        '已选第 ' + pendingPts.length + ' 点' + reuseLabel(ra) + '，还需 ' + (3 - pendingPts.length) + ' 点。';
    }
  } else if (mode === 'arc3') {
    /* 三点圆弧：依次点 A、B、C，生成三点外接圆上依次经过 A→B→C 的圆弧 */
    var r3a = pickOrCreatePoint(x, y, sx, sy);
    if (r3a.reused) pendingReused = true;
    if (r3a.isIntersection) pendingInter = true;
    pendingPts.push(r3a.point);
    if (pendingPts.length === 3) {
      var t1 = pendingPts[0], t2 = pendingPts[1], t3 = pendingPts[2];
      pendingPts = [];
      if (t1.id === t2.id || t2.id === t3.id || t1.id === t3.id) {
        setStatus('三点中有重复，请选择三个不同的点。', false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS.arc3;
        return;
      }
      if (triArea(t1, t2, t3) < 1e-9) {
        setStatus('三点共线，无法确定圆弧，请重新选择。', false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS.arc3;
        return;
      }
      var arc3El;
      try { arc3El = createArc3(t1, t2, t3, nextId('a')); }
      catch (err) {
        setStatus('无法创建三点圆弧：' + err.message, false);
        pendingReused = false; pendingInter = false; clearFlashes();
        document.getElementById('hint').textContent = HINTS.arc3;
        return;
      }
      trackId(arc3El.id);
      var note3a = pendingInter ? '（含联动交点）' : (pendingReused ? '（复用了已有点）' : '');
      pendingReused = false; pendingInter = false;
      clearFlashes();
      setStatus('已创建三点圆弧' + note3a + '。', true);
      document.getElementById('hint').textContent = HINTS.arc3;
    } else {
      document.getElementById('hint').textContent =
        '已选第 ' + pendingPts.length + ' 点' + reuseLabel(r3a) + '（第 2 点决定圆弧走哪一侧），还需 ' + (3 - pendingPts.length) + ' 点。';
    }
  } else if (mode === 'polygon') {
    /* 双击结束的第二次按下只作为“结束”，不得紧接着以同一点开新多边形 */
    if (lastPolyFinishMs && nowMs - lastPolyFinishMs < 450 &&
        Math.hypot(sx - prevDownX, sy - prevDownY) < 12) return;
    var rp = pickOrCreatePoint(x, y, sx, sy);
    /* 点中起点 → 自动闭合 */
    if (polyPts.length >= 3 && rp.point.id === polyPts[0].id) { finishPolygon(); return; }
    /* 连续点中同一个点 → 忽略，避免重复顶点 */
    if (polyPts.length && rp.point.id === polyPts[polyPts.length - 1].id) {
      document.getElementById('hint').textContent =
        '已选 ' + polyPts.length + ' 个顶点，该点已是上一个顶点，换个位置或双击/点起点结束。';
      return;
    }
    /* 点中已选顶点（非起点）→ 从待选顶点中删除，用于纠正误点；
     * 该点若是本次专为多边形新建、且删除后无人引用，一并从画板移除 */
    var existIdx = -1;
    for (var pi = 1; pi < polyPts.length; pi++) {
      if (polyPts[pi].id === rp.point.id) { existIdx = pi; break; }
    }
    if (existIdx > 0) {
      var rmPt = polyPts.splice(existIdx, 1)[0];
      var killPt = false;
      try {
        /* childElements 里含标签（TEXT）和多边形预览对象，都不算依赖 */
        var hasDep = Object.keys(rmPt.childElements || {}).some(function (cid) {
          var c = rmPt.childElements[cid];
          return c && c.type !== JXG.OBJECT_TYPE_TEXT && !c._polyPreview;
        });
        killPt = !!rmPt._polyNew && rmPt.elType === 'point' && !rmPt.fixed &&
                 !hasDep;
      } catch (eRm) {}
      if (killPt) {
        try { board.removeObject(rmPt); } catch (eRm2) {}
        createdIds = createdIds.filter(function (id) { return id !== rmPt.id; });
        selectedObjs = selectedObjs.filter(function (s) { return s.id !== rmPt.id; });
        removeTrail(rmPt.id);
      }
      document.getElementById('hint').textContent =
        '已删除该顶点' + (killPt ? '（点一并移除）' : '') +
        '，还剩 ' + polyPts.length + ' 个顶点，继续点击；点起点或双击结束。';
      updatePolyPreview(e);
      return;
    }
    polyPts.push(rp.point);
    if (!rp.reused && !rp.isIntersection && !rp.isGlider) rp.point._polyNew = true;
    updatePolyPreview(e);
    document.getElementById('hint').textContent =
      '已选 ' + polyPts.length + ' 个顶点' + (rp.reused || rp.isIntersection ? '（刚才' + reuseLabel(rp).slice(1, -1) + '）' : '') + '，继续点击；点起点或双击结束。';
  }
});

/* 删除当前选中的对象（动作式：删除按钮 / Del 键触发，不是模式）。
 * 未选中时提示先选择；删除会级联删掉依赖选中对象的对象。 */
function deleteSelection() {
  if (typeof READ_ONLY !== 'undefined' && READ_ONLY) return;
  var roots = selectedObjs.filter(function (o) { return o && board.objects[o.id]; });
  if (!roots.length) { setStatus('请先在选择模式下选中要删除的对象，再点删除按钮或按 Del 键。', false); return; }
  deleteObjects(roots.map(function (o) { return o.id; }));
}
/* 级联删除一批根对象：依赖它们的对象一并删除，避免残留坏引用 */
function deleteObjects(rootIds) {
  pushHistory();   // 先记快照，支持撤销删除
  var doomed = {};
  rootIds.forEach(function (rid) {
    var d = collectDependents(rid);
    Object.keys(d).forEach(function (k) { doomed[k] = true; });
  });
  /* 三点圆弧被删时，其隐藏圆心一并清掉（圆心未登记在 createdIds 里） */
  Object.keys(doomed).forEach(function (id) {
    var ac = board.objects[id];
    if (ac && ac._defKind === 'arc3' && ac._arc3centerId) doomed[ac._arc3centerId] = true;
    /* 过点平行对象被删时，其附属对象一并清掉：
     * _endId 远端端点（已登记）、_lineId 隐藏约束线、_helpId 隐藏方向点（均未登记） */
    if (ac && ac._endId) doomed[ac._endId] = true;
    if (ac && ac._lineId) doomed[ac._lineId] = true;
    if (ac && ac._helpId) doomed[ac._helpId] = true;
    if (ac && ac._bisHelpId) doomed[ac._bisHelpId] = true;   // 角平分线被删时，其隐藏方向点一并清掉
    if (ac && ac._sideCands) { ac._sideCands.forEach(function (cid) { doomed[cid] = true; }); }  // side 约束点被删时，候选交点一并清掉
    /* 正 N 边形被删时：派生顶点与两点模式的隐藏中心一并清掉（起点/参照点是用户点，保留） */
    if (ac && ac._defKind === 'regularpolygon') {
      (ac._ngonVertIds || []).forEach(function (vid) {
        if (vid !== ac._ngonV0 && vid !== ac._ngonP2) doomed[vid] = true;
      });
      if (!ac._ngonByCenter && ac._ngonCen) doomed[ac._ngonCen] = true;
    }
  });
  Object.keys(doomed).forEach(function (id) {
    var target = board.objects[id];
    if (target) { try { board.removeObject(target); } catch (e) {} }
    removeTrail(id);   // 被删的点，其轨迹一并清除
  });
  /* 垂足被删时，其附属垂线一并清掉（附属线未登记在 createdIds 里） */
  Object.keys(board.objects).forEach(function (id) {
    var t = board.objects[id];
    if (t && t._defKind === 'perpline' && doomed[t._footId]) {
      try { board.removeObject(t); } catch (e) {}
    }
    /* 垂线段被删时，其垂足与越界连接段一并清掉（均未登记在 createdIds 里） */
    if (t && (t._defKind === 'pfoot' || t._defKind === 'psegext') && doomed[t._segId]) {
      try { board.removeObject(t); } catch (e) {}
    }
  });
  /* 被删对象若在选择集合里，一并移出选择 */
  selectedObjs = selectedObjs.filter(function (s) { return !doomed[s.id]; });
  recomputeDepSelection();
  createdIds = createdIds.filter(function (id) { return !doomed[id] && !!board.objects[id]; });
  refreshObjectList();
  syncListSelection();
  flashed = flashed.filter(function (p) { return !!board.objects[p.id]; });
  updateSelectHint();
  syncPropPanelToSelection();
  setStatus('已删除 ' + Object.keys(doomed).length + ' 个图形' + (Object.keys(doomed).length > rootIds.length ? '（含级联依赖）' : '') + '。', true);
}

/* ============================================================
 * JSON 构造步骤 → 渲染
 * ============================================================ */
function resolveRef(ref, registry, stepIdx) {
  if (Array.isArray(ref)) {
    var p = board.create('point', ref, { name: nextId('P'), visible: true });
    trackId(p.id);
    return p;
  }
  if (typeof ref === 'string') {
    if (!registry[ref]) throw new Error('第 ' + (stepIdx + 1) + ' 步：引用了未定义的 id "' + ref + '"');
    return registry[ref];
  }
  throw new Error('第 ' + (stepIdx + 1) + ' 步：引用格式错误，应为 id 字符串或 [x,y] 坐标');
}

/* ============================================================
 * 正 N 边形（regularpolygon 步骤 / 交互工具共用）
 * byCenter=true  ：v0=vertex 为第一个顶点，cen=center 为已有点（中心模式）
 * byCenter=false ：v0=p1、p2=p2 为相邻两顶点（逆时针，多边形在 v0→p2 左侧），
 *                  中心为隐藏函数点（中点 + 左法向 * (边长/2)*cot(π/n)）
 * 派生顶点登记 createdIds（对象列表可见、可级联删除）；隐藏中心不登记，
 * 删除正多边形时经显式清理一并移除。
 * ============================================================ */
function makeNgonVertex(v0, cen, ang) {
  var c = Math.cos(ang), s = Math.sin(ang);
  var pt = board.create('point', [
    function () { var dx = v0.X() - cen.X(), dy = v0.Y() - cen.Y(); return cen.X() + dx * c - dy * s; },
    function () { var dx = v0.X() - cen.X(), dy = v0.Y() - cen.Y(); return cen.Y() + dx * s + dy * c; }
  ], { name: nextId('V'), fixed: true });
  pt._defKind = 'ngonpt';
  pt._depIds = [v0.id, cen.id];
  applyDrivenGray(pt);
  trackId(pt.id);
  return pt;
}
function createRegularPolygon(opts) {
  var nN = Math.round(Number(opts.n));
  if (!isFinite(nN) || nN < 3 || nN > 60) throw new Error('正 N 边形的边数 N 需要 3～60 的整数');
  var v0 = opts.v0, p2 = opts.p2 || null, cen;
  if (opts.byCenter) {
    cen = opts.cen;
  } else {
    var cotHalf = 1 / Math.tan(Math.PI / nN);
    cen = board.create('point', [
      function () {
        var dx = p2.X() - v0.X(), dy = p2.Y() - v0.Y();
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-9) len = 1e-9;
        var off = (len / 2) * cotHalf;
        return (v0.X() + p2.X()) / 2 - (dy / len) * off;
      },
      function () {
        var dx = p2.X() - v0.X(), dy = p2.Y() - v0.Y();
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-9) len = 1e-9;
        var off = (len / 2) * cotHalf;
        return (v0.Y() + p2.Y()) / 2 + (dx / len) * off;
      }
    ], { name: '', visible: false, fixed: true, withLabel: false });
    cen._defKind = 'ngoncenter';
    cen._depIds = [v0.id, p2.id];
  }
  /* 顶点 v_k = v0 绕中心逆时针旋转 k*2π/n（CCW 多边形：中心在 v0→p2 左侧） */
  var theta = 2 * Math.PI / nN, verts = [v0], k;
  if (opts.byCenter) {
    for (k = 1; k < nN; k++) verts.push(makeNgonVertex(v0, cen, k * theta));
  } else {
    verts.push(p2);
    for (k = 2; k < nN; k++) verts.push(makeNgonVertex(v0, cen, k * theta));
  }
  var el = board.create('polygon', verts, { name: opts.id });
  tagPolygonBorders(el);
  el._defKind = 'regularpolygon';
  el._ngonN = nN;
  el._ngonByCenter = !!opts.byCenter;
  el._ngonV0 = v0.id;
  el._ngonCen = cen.id;
  if (!opts.byCenter) el._ngonP2 = p2.id;
  el._ngonVertIds = verts.map(function (vv) { return vv.id; });
  return el;
}

  function renderSteps(steps) {
  if (!Array.isArray(steps)) throw new Error('JSON 顶层必须是数组');
  var prevSuppress = suppressHistory;
  suppressHistory = true;   // 批量重建期间不产生中间历史
  board.suspendUpdate();    // 批量重建期间暂停逐个重绘，结束时只刷一帧，避免撤销/重做闪屏
  var n = 0;
  try {
    clearUserObjects();
    n = renderStepsBody(steps);
  } finally {
    board.unsuspendUpdate();
    suppressHistory = prevSuppress;
  }
    try { refreshObjectList(); } catch (e) {}   // 批量重建只刷新一次对象列表
    return n;
  }

  /* ============================================================
   * 受限表达式编译（exprpoint 用）：x(A) / y(A) / Distance(A,B) + 数字 + - * / 括号
   * 解析为 AST 后直接生成 JS 表达式串，new Function 成坐标函数（动态跟随被引用点）。
   * 与服务端 lib/jxg-steps.js 的校验器保持同一语法子集。
   * ============================================================ */
  function exprTokenize(src) {
    var tokens = [], i = 0;
    while (i < src.length) {
      var c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      var m;
      if (/[0-9.]/.test(c)) {
        m = src.slice(i).match(/^\d*\.?\d+(?:[eE][+-]?\d+)?/);
        if (!m) throw new Error('无法解析的数字');
        tokens.push({ t: 'num', v: parseFloat(m[0]) });
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
        tokens.push({ t: 'id', v: m[0] });
        i += m[0].length;
        continue;
      }
      if ('+-*/(),'.indexOf(c) >= 0) { tokens.push({ t: c }); i++; continue; }
      throw new Error('不支持的字符 "' + c + '"');
    }
    return tokens;
  }
  function exprParse(src) {
    var tokens = exprTokenize(src), pos = 0;
    function peek() { return tokens[pos]; }
    function next() { return tokens[pos++]; }
    function factor() {
      var tk = next();
      if (!tk) throw new Error('表达式意外结束');
      if (tk.t === 'num') return { k: 'num', v: tk.v };
      if (tk.t === '-') return { k: 'neg', a: factor() };
      if (tk.t === '(') {
        var e = add();
        if (!peek() || peek().t !== ')') throw new Error('缺少右括号');
        next();
        return e;
      }
      if (tk.t === 'id') {
        if (peek() && peek().t === '(') {
          next();
          var args = [];
          if (peek() && peek().t !== ')') {
            args.push(add());
            while (peek() && peek().t === ',') { next(); args.push(add()); }
          }
          if (!peek() || peek().t !== ')') throw new Error('函数 ' + tk.v + '( 缺少右括号');
          next();
          return { k: 'call', fn: tk.v, args: args };
        }
        return { k: 'id', v: tk.v };
      }
      throw new Error('意外的符号 "' + tk.t + '"');
    }
    function mul() {
      var l = factor();
      while (peek() && (peek().t === '*' || peek().t === '/')) {
        var op = next().t;
        l = { k: 'bin', op: op, a: l, b: factor() };
      }
      return l;
    }
    function add() {
      var l = mul();
      while (peek() && (peek().t === '+' || peek().t === '-')) {
        var op = next().t;
        l = { k: 'bin', op: op, a: l, b: mul() };
      }
      return l;
    }
    var ast = add();
    if (pos < tokens.length) throw new Error('表达式末尾有多余内容');
    return ast;
  }
  /* AST -> JS 串；idArgs 收集函数参数里的点名（须已注册且为点） */
  function exprToJs(node, stepIdx, regNames) {
    if (node.k === 'num') return String(node.v);
    if (node.k === 'neg') return '(-' + exprToJs(node.a, stepIdx, regNames) + ')';
    if (node.k === 'bin') return '(' + exprToJs(node.a, stepIdx, regNames) + node.op + exprToJs(node.b, stepIdx, regNames) + ')';
    if (node.k === 'id')
      throw new Error('第 ' + (stepIdx + 1) + ' 步：值位置不能直接用点名 "' + node.v + '"，请写成 x(' + node.v + ') 或 y(' + node.v + ')');
    if (node.k === 'call') {
      if (node.fn !== 'x' && node.fn !== 'y' && node.fn !== 'Distance')
        throw new Error('第 ' + (stepIdx + 1) + ' 步：不支持的函数 "' + node.fn + '"（只允许 x/y/Distance）');
      var want = node.fn === 'Distance' ? 2 : 1;
      if (node.args.length !== want)
        throw new Error('第 ' + (stepIdx + 1) + ' 步：函数 ' + node.fn + ' 需要 ' + want + ' 个参数');
      var names = node.args.map(function (a) {
        if (a.k !== 'id') throw new Error('第 ' + (stepIdx + 1) + ' 步：函数参数必须是点名');
        return a.v;
      });
      names.forEach(function (n) {
        if (regNames.indexOf(n) < 0)
          throw new Error('第 ' + (stepIdx + 1) + ' 步：表达式引用了未定义的点 "' + n + '"');
      });
      if (node.fn === 'x') return '(P[' + JSON.stringify(names[0]) + '].X())';
      if (node.fn === 'y') return '(P[' + JSON.stringify(names[0]) + '].Y())';
      return '(P[' + JSON.stringify(names[0]) + '].Dist(P[' + JSON.stringify(names[1]) + ']))';
    }
    throw new Error('未知表达式节点');
  }
  function compileExprFn(src, registry, stepIdx) {
    var ast = exprParse(String(src));
    var regNames = Object.keys(registry);
    var js = exprToJs(ast, stepIdx, regNames);
    var P = {};
    regNames.forEach(function (n) { P[n] = registry[n]; });
    var body = 'return ' + js + ';';
    var fn = new Function('P', body);
    return function () { return fn(P); };
  }

  /* 叉积符号：(p2-p1) x (pt-p1)。正/负代表直线两侧，0 在线上 */
  function sideSignOf(lineObj, pt) {
    var a = lineObj.point1, b = lineObj.point2;
    return (b.X() - a.X()) * (pt.Y() - a.Y()) - (b.Y() - a.Y()) * (pt.X() - a.X());
  }

  function renderStepsBody(steps) {
  var registry = {};
  steps.forEach(function (s, i) {
    if (!s || typeof s.type !== 'string') throw new Error('第 ' + (i + 1) + ' 步：缺少 type 字段');
    var id = s.id || nextId('el');
    var el;
    switch (s.type) {
      case 'point':
        if (!Array.isArray(s.coords)) throw new Error('第 ' + (i + 1) + ' 步：point 需要 coords [x,y]');
        if (s.polygon !== undefined) {
          /* 约束在多边形某条边上的点：polygon+edge 定位边（边无独立名称，与 intersection 一致） */
          if (s.e1 !== undefined || s.e2 !== undefined || s.side !== undefined)
            throw new Error('第 ' + (i + 1) + ' 步：point 的 polygon 形式与 e1/e2/side 互斥');
          var gpoly = resolveRef(s.polygon, registry, i);
          var gbd = gpoly.borders && gpoly.borders[s.edge];
          if (!gbd) throw new Error('第 ' + (i + 1) + ' 步：多边形 ' + s.polygon + ' 没有第 ' + s.edge + ' 条边');
          el = board.create('glider', [s.coords[0], s.coords[1], gbd], { name: id });
          el._defKind = 'glider';
          el._onId = gbd.id;
          el._polyEdge = { polyId: gpoly.id, edgeIdx: s.edge };
          gbd._polyBorderOf = { polyId: gpoly.id, edgeIdx: s.edge };
          applyGliderColor(el);
          break;
        }
        if (s.on !== undefined) {
          /* 约束在某对象上的点（描点时点中曲线自动生成） */
          var cv = resolveRef(s.on, registry, i);
          el = board.create('glider', [s.coords[0], s.coords[1], cv], { name: id });
          el._defKind = 'glider';
          el._onId = cv.id;
          applyGliderColor(el);
        } else {
          el = board.create('point', s.coords, { name: id });
        }
        break;
      case 'mirrorpt': {
        if (s.of === undefined || s.axis === undefined)
          throw new Error('第 ' + (i + 1) + ' 步：mirrorpt 需要 of（原点）, axis（对称轴/中心）');
        el = makeMirrorPoint(resolveRef(s.of, registry, i), resolveRef(s.axis, registry, i), s.t, id);
        break;
      }
      case 'segment':
      case 'line': {
        if (s.p1 === undefined || s.p2 === undefined) throw new Error('第 ' + (i + 1) + ' 步：' + s.type + ' 需要 p1, p2');
        el = board.create(s.type,
          [resolveRef(s.p1, registry, i), resolveRef(s.p2, registry, i)], { name: id });
        break;
      }
      case 'ray': {
        if (s.p1 === undefined || s.p2 === undefined) throw new Error('第 ' + (i + 1) + ' 步：ray 需要 p1（起点）, p2（方向点）');
        var rp1 = resolveRef(s.p1, registry, i), rp2 = resolveRef(s.p2, registry, i);
        if (rp1.id === rp2.id) throw new Error('第 ' + (i + 1) + ' 步：ray 的起点和方向点不能相同');
        el = board.create('line', [rp1, rp2], { name: id, straightFirst: false, straightLast: true });
        el._defKind = 'ray';
        break;
      }
      case 'pline':
      case 'pray': {
        /* 过点平行线：point 为过点，ref 为参照线（线段/直线/射线） */
        if (s.point === undefined || s.ref === undefined)
          throw new Error('第 ' + (i + 1) + ' 步：' + s.type + ' 需要 point, ref');
        var pp = resolveRef(s.point, registry, i), pr = resolveRef(s.ref, registry, i);
        var pA = pr.point1, pB = pr.point2;
        if (!pA || !pB) throw new Error('第 ' + (i + 1) + ' 步：参照线 ' + s.ref + ' 无效');
        var pQ = makeParHelper(pp, pA, pB);
        if (s.type === 'pline')
          el = board.create('line', [pp, pQ], { name: id });
        else
          el = board.create('line', [pp, pQ], { name: id, straightFirst: false, straightLast: true });
        el._defKind = s.type;
        el._parIds = [pp.id, pr.id];
        el._helpId = pQ.id;
        break;
      }
      case 'pseg':
      case 'psegfree': {
        /* 过点平行线段：point 为过点（起点），ref 为参照线，end 为远端端点名；
         * psegfree 另有有向长度 len；两种的远端端点都是可见点 */
        if (s.point === undefined || s.ref === undefined)
          throw new Error('第 ' + (i + 1) + ' 步：' + s.type + ' 需要 point, ref');
        var qp = resolveRef(s.point, registry, i), qr = resolveRef(s.ref, registry, i);
        var qA = qr.point1, qB = qr.point2;
        if (!qA || !qB) throw new Error('第 ' + (i + 1) + ' 步：参照线 ' + s.ref + ' 无效');
        var qLen = (s.type === 'psegfree') ? s.len : null;
        if (s.type === 'psegfree' && (qLen === undefined || qLen === null))
          throw new Error('第 ' + (i + 1) + ' 步：psegfree 需要 len');
        var qEName = (s.end !== undefined && s.end !== null) ? s.end : nextId('P');
        var qE, qL = null, qQ = null;
        if (s.type === 'pseg') {
          /* 等长：端点为固定的派生点，不可拖动 */
          qE = board.create('point', [
            function () { return qp.X() + (qB.X() - qA.X()); },
            function () { return qp.Y() + (qB.Y() - qA.Y()); }
          ], { name: qEName, fixed: true });
        } else {
          /* 不等长：端点是约束在隐藏平行线上的动点，可沿方向拖动调长度 */
          qQ = makeParHelper(qp, qA, qB);
          qL = board.create('line', [qp, qQ], { name: '', visible: false, withLabel: false });
          qL._defKind = 'parline';
          var qvx = qB.X() - qA.X(), qvy = qB.Y() - qA.Y(), ql = Math.hypot(qvx, qvy) || 1;
          qE = board.create('glider',
            [qp.X() + qvx / ql * qLen, qp.Y() + qvy / ql * qLen, qL], { name: qEName });
        }
        qE._defKind = 'parend';
        qE._parIds = [qp.id, qr.id];
        applyDrivenGray(qE);
        qE._free = (s.type === 'psegfree');
        if (qL) qE._onId = qL.id;
        registry[qEName] = qE;
        trackId(qE.id);
        el = board.create('segment', [qp, qE], { name: id });
        el._defKind = s.type;
        el._parIds = [qp.id, qr.id];
        el._endId = qE.id;
        if (qL) el._lineId = qL.id;
        if (qQ) el._helpId = qQ.id;
        qE._segId = el.id;
        break;
      }
      case 'arc': {
        if (s.center === undefined || s.p1 === undefined || s.p2 === undefined)
          throw new Error('第 ' + (i + 1) + ' 步：arc 需要 center, p1（起点）, p2（终点）');
        var ac = resolveRef(s.center, registry, i),
            aa1 = resolveRef(s.p1, registry, i),
            aa2 = resolveRef(s.p2, registry, i);
        if (aa1.id === ac.id || aa2.id === ac.id)
          throw new Error('第 ' + (i + 1) + ' 步：arc 的起点/终点不能与圆心重合');
        if (aa1.id === aa2.id)
          throw new Error('第 ' + (i + 1) + ' 步：arc 的起点和终点不能是同一个点');
        el = board.create('arc', [ac, aa1, aa2], { name: id });
        el._defKind = 'arc';
        break;
      }
      case 'arc3': {
        if (!Array.isArray(s.through3) || s.through3.length !== 3)
          throw new Error('第 ' + (i + 1) + ' 步：arc3 需要 through3（3 个点名）');
        var tA = resolveRef(s.through3[0], registry, i),
            tB = resolveRef(s.through3[1], registry, i),
            tC = resolveRef(s.through3[2], registry, i);
        if (tA.id === tB.id || tB.id === tC.id || tA.id === tC.id)
          throw new Error('第 ' + (i + 1) + ' 步：arc3 的三点不能重复');
        if (triArea(tA, tB, tC) < 1e-9)
          throw new Error('第 ' + (i + 1) + ' 步：arc3 的三点共线，无法确定圆弧');
        el = createArc3(tA, tB, tC, id);
        break;
      }
      case 'ellipse':
      case 'hyperbola': {
        if (s.f1 === undefined || s.f2 === undefined || s.p === undefined)
          throw new Error('第 ' + (i + 1) + ' 步：' + s.type + ' 需要 f1, f2, p（两个焦点 + 曲线上一点）');
        var cf1 = resolveRef(s.f1, registry, i),
            cf2 = resolveRef(s.f2, registry, i),
            cp = resolveRef(s.p, registry, i);
        if (cf1.id === cf2.id || cf1.id === cp.id || cf2.id === cp.id)
          throw new Error('第 ' + (i + 1) + ' 步：' + s.type + ' 的三个点不能重复');
        if (triArea(cf1, cf2, cp) < 1e-9)
          throw new Error('第 ' + (i + 1) + ' 步：' + s.type + ' 的三点共线，无法确定曲线');
        el = board.create(s.type, [cf1, cf2, cp], { name: id });
        el._defKind = s.type;
        el._conicIds = [cf1.id, cf2.id, cp.id];
        break;
      }
      case 'parabola': {
        if (s.focus === undefined || s.directrix === undefined)
          throw new Error('第 ' + (i + 1) + ' 步：parabola 需要 focus（焦点）, directrix（准线）');
        var pf = resolveRef(s.focus, registry, i),
            pd = resolveRef(s.directrix, registry, i);
        if (!pd.point1 || !pd.point2)
          throw new Error('第 ' + (i + 1) + ' 步：parabola 的准线必须是直线或线段');
        el = board.create('parabola', [pf, pd], { name: id });
        el._defKind = 'parabola';
        el._conicIds = [pf.id, pd.id];
        break;
      }
      case 'conic': {
        /* 五点确定的二次曲线：类型自动（椭圆/双曲线/抛物线） */
        if (!Array.isArray(s.through5) || s.through5.length !== 5)
          throw new Error('第 ' + (i + 1) + ' 步：conic 需要 through5（五个点）');
        var k5 = s.through5.map(function (r) { return resolveRef(r, registry, i); });
        var kIds = {};
        for (var ki = 0; ki < 5; ki++) {
          if (kIds[k5[ki].id])
            throw new Error('第 ' + (i + 1) + ' 步：conic 的五个点不能重复');
          kIds[k5[ki].id] = 1;
        }
        if (triArea(k5[0], k5[1], k5[2]) < 1e-9 && triArea(k5[2], k5[3], k5[4]) < 1e-9)
          throw new Error('第 ' + (i + 1) + ' 步：conic 的五点接近共线（退化），无法确定二次曲线');
        el = board.create('conic', k5, { name: id });
        el._defKind = 'conic';
        el._conicIds = k5.map(function (p) { return p.id; });
        break;
      }
      case 'circle': {
        if (s.center === undefined && s.through3 === undefined)
          throw new Error('第 ' + (i + 1) + ' 步：circle 需要 center 或 through3');
        if (s.through3 !== undefined) {
          if (!Array.isArray(s.through3) || s.through3.length !== 3)
            throw new Error('第 ' + (i + 1) + ' 步：through3 需要 3 个点');
          var q1 = resolveRef(s.through3[0], registry, i),
              q2 = resolveRef(s.through3[1], registry, i),
              q3 = resolveRef(s.through3[2], registry, i);
          if (triArea(q1, q2, q3) < 1e-9)
            throw new Error('第 ' + (i + 1) + ' 步：through3 的三点共线，无法确定圆');
          el = board.create('circle', [q1, q2, q3], { name: id });
          el._defKind = 'circle3';
          break;
        }
        var c = resolveRef(s.center, registry, i);
        if (s.radius !== undefined) {
          el = board.create('circle', [c, s.radius], { name: id });
          el._radius = s.radius;
          el._defKind = 'circleRadius';
        }
        else if (s.through !== undefined) {
          el = board.create('circle', [c, resolveRef(s.through, registry, i)], { name: id });
          el._defKind = 'circleThrough';
        }
        else throw new Error('第 ' + (i + 1) + ' 步：circle 需要 radius 或 through 之一');
        break;
      }
      case 'polygon': {
        if (!Array.isArray(s.points) || s.points.length < 3)
          throw new Error('第 ' + (i + 1) + ' 步：polygon 需要至少 3 个 points');
        el = board.create('polygon', s.points.map(function (r) { return resolveRef(r, registry, i); }), { name: id });
        tagPolygonBorders(el);
        break;
      }
      case 'regularpolygon': {
        var nS = Math.round(Number(s.n));
        if (!isFinite(nS) || nS < 3 || nS > 60)
          throw new Error('第 ' + (i + 1) + ' 步：regularpolygon 的 n 需要 3～60 的整数');
        var hasCenterForm = (s.center !== undefined || s.vertex !== undefined);
        var hasTwoForm = (s.p1 !== undefined || s.p2 !== undefined);
        if (hasCenterForm === hasTwoForm)
          throw new Error('第 ' + (i + 1) + ' 步：regularpolygon 需要且只能给一种：center+vertex（中心模式）或 p1+p2（两点模式，相邻顶点、逆时针）');
        if (hasCenterForm && (s.center === undefined || s.vertex === undefined))
          throw new Error('第 ' + (i + 1) + ' 步：regularpolygon 的 center 和 vertex 必须同时给出');
        if (hasTwoForm && (s.p1 === undefined || s.p2 === undefined))
          throw new Error('第 ' + (i + 1) + ' 步：regularpolygon 的 p1 和 p2 必须同时给出');
        if (hasCenterForm) {
          el = createRegularPolygon({ id: id, n: nS, byCenter: true,
            v0: resolveRef(s.vertex, registry, i), cen: resolveRef(s.center, registry, i) });
        } else {
          el = createRegularPolygon({ id: id, n: nS, byCenter: false,
            v0: resolveRef(s.p1, registry, i), p2: resolveRef(s.p2, registry, i) });
        }
        break;
      }
      case 'midpoint': {
        if (s.p1 === undefined || s.p2 === undefined) throw new Error('第 ' + (i + 1) + ' 步：midpoint 需要 p1, p2');
        var ra = resolveRef(s.p1, registry, i), rb = resolveRef(s.p2, registry, i);
        el = createMidpoint(ra, rb, id, true);
        break;
      }
      case 'tricenter': {
        if (!s.kind || ['incenter', 'circumcenter', 'orthocenter'].indexOf(s.kind) < 0)
          throw new Error('第 ' + (i + 1) + ' 步：tricenter 的 kind 须为 incenter / circumcenter / orthocenter');
        if (!Array.isArray(s.points) || s.points.length !== 3)
          throw new Error('第 ' + (i + 1) + ' 步：tricenter 需要 points（3 个顶点）');
        var ta = resolveRef(s.points[0], registry, i),
            tb = resolveRef(s.points[1], registry, i),
            tc = resolveRef(s.points[2], registry, i);
        el = createTriCenter(s.kind, ta, tb, tc, id, true);
        break;
      }
      case 'perpseg': {
        if (s.point === undefined || s.p1 === undefined || s.p2 === undefined)
          throw new Error('第 ' + (i + 1) + ' 步：perpseg 需要 point（起点）, p1, p2（对边两端点）');
        el = createPerpSeg(resolveRef(s.point, registry, i),
                           resolveRef(s.p1, registry, i),
                           resolveRef(s.p2, registry, i), id, true);
        break;
      }
      case 'bisector': {
        if (s.vertex === undefined || s.p1 === undefined || s.p2 === undefined)
          throw new Error('第 ' + (i + 1) + ' 步：bisector 需要 vertex（角顶点）, p1, p2');
        var bvv = resolveRef(s.vertex, registry, i),
            bb1 = resolveRef(s.p1, registry, i),
            bb2 = resolveRef(s.p2, registry, i);
          el = createBisector(bvv, bb1, bb2, id, true);
        break;
      }
        case 'perpendicular': {
          if (s.line === undefined || s.point === undefined)
            throw new Error('第 ' + (i + 1) + ' 步：perpendicular 需要 line, point');
          var rl = resolveRef(s.line, registry, i), rp = resolveRef(s.point, registry, i);
          /* JSXGraph 1.13 的 perpendicular 组合元素返回结构不稳定，
           * 改用 perpendicularpoint（垂足）+ 显式垂线，行为等价且可序列化 */
          var foot = board.create('perpendicularpoint', [rp, rl], { name: id });
          var pline = board.create('line', [rp, foot], { name: id + '_line', visible: false, withLabel: false });
          registry[id + '_line'] = pline;   // 垂线本身
          pline._defKind = 'perpline';
          pline._footId = foot.id;          // 关联垂足，便于级联删除
          foot._defKind = 'footpoint';
          foot._perpIds = [rl.id, rp.id];   // 垂足序列化用
          applyDrivenGray(foot);
          el = foot;                        // 垂足（注册为 id）
          break;
        }
        case 'intersection': {
        el = null;
        if (s.polygon !== undefined) {
          /* 交点在多边形的某条边上：e1 是另一条曲线，polygon+edge 定位那条边 */
          if (s.e1 === undefined)
            throw new Error('第 ' + (i + 1) + ' 步：intersection（多边形边）需要 e1, polygon, edge');
          var rpoly = resolveRef(s.polygon, registry, i);
          var bd = rpoly.borders && rpoly.borders[s.edge];
          if (!bd) throw new Error('第 ' + (i + 1) + ' 步：多边形 ' + s.polygon + ' 没有第 ' + s.edge + ' 条边');
          el = board.create('intersection',
            [resolveRef(s.e1, registry, i), bd, s.index || 0], { name: id, fixed: true });
          el._polyEdge = { polyId: rpoly.id, edgeIdx: s.edge };
        } else if (s.side !== undefined) {
          /* 位置约束（同侧/异侧）：两个交点都生成（隐藏），目标点按叉积符号
           * 动态选取位于指定侧的那个——拖动图形时约束依然成立，比固定 index 稳 */
          if (s.e1 === undefined || s.e2 === undefined)
            throw new Error('第 ' + (i + 1) + ' 步：intersection（side 约束）需要 e1, e2');
          var se1 = resolveRef(s.e1, registry, i), se2 = resolveRef(s.e2, registry, i);
          var sdl = resolveRef(s.side.line, registry, i), sdp = resolveRef(s.side.point, registry, i);
          if (!sdl.point1 || !sdl.point2)
            throw new Error('第 ' + (i + 1) + ' 步：side.line 必须是直线/线段/射线');
          var sSame = (s.side.rel === 'same');
          var sc0 = board.create('intersection', [se1, se2, 0], { name: '', visible: false, withLabel: false });
          var sc1 = board.create('intersection', [se1, se2, 1], { name: '', visible: false, withLabel: false });
          sc0._defKind = 'sidecand'; sc1._defKind = 'sidecand';
          var sidePick = function (which) {
            return function () {
              var ref = sideSignOf(sdl, sdp);
              var c0s = sideSignOf(sdl, sc0);
              var good = sSame ? (c0s * ref > 0) : (c0s * ref < 0);
              return (good ? sc0 : sc1)[which]();
            };
          };
          el = board.create('point', [sidePick('X'), sidePick('Y')], { name: id, fixed: true });
          el._defKind = 'sidepick';
          applyDrivenGray(el);
          el._sideE1 = se1.id; el._sideE2 = se2.id;
          el._sideLine = sdl.id; el._sidePoint = sdp.id;
          el._sideRel = sSame ? 'same' : 'opposite';
          el._sideCands = [sc0.id, sc1.id];
          /* 候选交点未登记，删除级联靠显式依赖表 */
          el._sideIds = [se1.id, se2.id, sdl.point1.id, sdl.point2.id, sdp.id];
          break;
        } else {
          if (s.e1 === undefined || s.e2 === undefined)
            throw new Error('第 ' + (i + 1) + ' 步：intersection 需要 e1, e2');
          el = board.create('intersection',
            [resolveRef(s.e1, registry, i), resolveRef(s.e2, registry, i), s.index || 0], { name: id, fixed: true });
        }
          el._interIndex = s.index || 0;
          applyDrivenGray(el);
          break;
        }
        case 'rotate': {
          if (s.of === undefined || s.center === undefined || s.angle === undefined)
            throw new Error('第 ' + (i + 1) + ' 步：rotate 需要 of（原点）, center（旋转中心）, angle（角度，度）');
          var ro = resolveRef(s.of, registry, i), rc = resolveRef(s.center, registry, i);
          var rad = (Number(s.angle) || 0) * Math.PI / 180;
          var cosA = Math.cos(rad), sinA = Math.sin(rad);
          el = board.create('point', [
            function () {
              var dx = ro.X() - rc.X(), dy = ro.Y() - rc.Y();
              return rc.X() + dx * cosA - dy * sinA;
            },
            function () {
              var dx = ro.X() - rc.X(), dy = ro.Y() - rc.Y();
              return rc.Y() + dx * sinA + dy * cosA;
            }
          ], { name: id, fixed: true });
          el._defKind = 'rotate';
          applyDrivenGray(el);
          el._depIds = [ro.id, rc.id];
          el._rotOf = ro.id; el._rotCenter = rc.id; el._rotAngle = Number(s.angle) || 0;
          break;
        }
        case 'dilate': {
          if (s.of === undefined || s.center === undefined || s.ratio === undefined)
            throw new Error('第 ' + (i + 1) + ' 步：dilate 需要 of（原点）, center（位似中心）, ratio（比例）');
          var dO = resolveRef(s.of, registry, i), dC = resolveRef(s.center, registry, i);
          var dR = Number(s.ratio);
          if (!isFinite(dR)) throw new Error('第 ' + (i + 1) + ' 步：dilate 的 ratio 必须是数值');
          el = board.create('point', [
            function () { return dC.X() + (dO.X() - dC.X()) * dR; },
            function () { return dC.Y() + (dO.Y() - dC.Y()) * dR; }
          ], { name: id, fixed: true });
          el._defKind = 'dilate';
          applyDrivenGray(el);
          el._depIds = [dO.id, dC.id];
          el._dilOf = dO.id; el._dilCenter = dC.id; el._dilRatio = dR;
          break;
        }
        case 'exprpoint': {
          if (typeof s.x !== 'string' || typeof s.y !== 'string')
            throw new Error('第 ' + (i + 1) + ' 步：exprpoint 需要 x, y 表达式字符串');
          var exFn = compileExprFn(s.x, registry, i), eyFn = compileExprFn(s.y, registry, i);
          el = board.create('point', [exFn, eyFn], { name: id, fixed: true });
          el._defKind = 'exprpoint';
          applyDrivenGray(el);
          /* 从表达式中提取已注册对象 id，作为闭包依赖（防循环约束检测用） */
          var _exprRefs = [];
          String(s.x + ' ' + s.y).replace(/[A-Za-z_][A-Za-z0-9_]*/g, function (m) {
            if (registry[m] && registry[m].id && _exprRefs.indexOf(registry[m].id) < 0) _exprRefs.push(registry[m].id);
            return m;
          });
          el._depIds = _exprRefs;
          el._exprX = s.x; el._exprY = s.y;
          break;
        }
        case 'measure': {
          if (s.kind === 'length') {
            var mlt = resolveRef(s.of, registry, i);
            if (!isFinite(measureLenOf(mlt)))
              throw new Error('第 ' + (i + 1) + ' 步：measure 的 of 必须是有有限长度的对象（线段/圆/圆弧/多边形）');
            el = makeLengthMeasure(mlt, id, true);
          } else if (s.kind === 'angle') {
            var mq1 = resolveRef(s.p1, registry, i),
                mqv = resolveRef(s.vertex, registry, i),
                mq2 = resolveRef(s.p2, registry, i);
            el = makeAngleMeasure(mq1, mqv, mq2, id, true);
          } else {
            throw new Error('第 ' + (i + 1) + ' 步：measure 的 kind 只能是 length 或 angle');
          }
          break;
        }
        case 'text': {
          if (!Array.isArray(s.at) || s.at.length !== 2 || !s.at.every(function (n) { return Number.isFinite(n); }))
            throw new Error('第 ' + (i + 1) + ' 步：text 需要 at [x,y] 数值坐标');
          if (typeof s.expr !== 'string' || !s.expr.trim())
            throw new Error('第 ' + (i + 1) + ' 步：text 需要 expr 表达式字符串');
          el = makeExprTextEl(s.expr, s.at[0], s.at[1], id, true);
          break;
        }
        case 'angdrive': {
          var adv = resolveRef(s.vertex, registry, i),
              ads = resolveRef(s.side, registry, i);
          var adk = Number(s.k);
          if (!isFinite(adk)) throw new Error('第 ' + (i + 1) + ' 步：angdrive 的 k 需要数值（倍数）');
          var adsrc = registry[s.src];
          if (!adsrc || !adsrc._measure || adsrc._measure.kind !== 'angle')
            throw new Error('第 ' + (i + 1) + ' 步：angdrive 的 src 必须是已定义的角度度量 id');
          el = makeAngleDrivenPoint(adv, ads, adsrc, adk, id, true);
          break;
        }
        default:
          throw new Error('第 ' + (i + 1) + ' 步：不支持的类型 "' + s.type + '"');
      }
    registry[id] = el;
    trackId(el.id);
    /* 单对象样式覆盖 / 轨迹开关 / 主动点周期：随 JSON 恢复 */
    try {
      if (s.style) applyStyle(el, s.style);
      if (s.trace && el.elementClass === JXG.OBJECT_CLASS_POINT) el._traceOn = true;
      if (s.period !== undefined && el._defKind === 'glider') el._period = s.period;
    } catch (e) {}
    if (s.mirror) {
      /* 对称生成的曲线/多边形：恢复镜像引用（用于列表标注、删除级联、改名） */
      var mor = resolveRef(s.mirror.of, registry, i), max = resolveRef(s.mirror.axis, registry, i);
      el._mirrorOf = mor.id; el._axisId = max.id; el._mtype = s.mirror.t;
    }
    if (s.visible === false) { try { el.setAttribute({ visible: false }); } catch (e) {} }
  });
  return Object.keys(registry).length;
}

document.getElementById('btnRender').addEventListener('click', function () {
  var txt = document.getElementById('jsonInput').value.trim();
  if (!txt) { setStatus('请先粘贴或输入 JSON 构造步骤。', false); return; }
  try {
    var steps = JSON.parse(txt);
    pushHistory();   // 先记快照，支持撤销这次渲染
    var n = renderStepsFrozen(steps);   // 盖冻结帧重建，避免闪烁
    setStatus('渲染成功，共创建 ' + n + ' 个对象。', true);
  } catch (err) {
    setStatus('渲染失败：' + err.message, false);
  }
});

document.getElementById('btnCopyJson').addEventListener('click', function () {
  var txt = document.getElementById('jsonInput').value;
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () {
    setStatus('JSON 已复制到剪贴板。', true);
  });
});

function setStatus(msg, ok) {
  var el = document.getElementById('status');
  el.textContent = msg;
  el.className = ok ? 'ok' : 'err';
}

/* ============================================================
 * Mock AI：文字指令 → 生成语句 + JSON
 * 正式版把这个函数换成对大模型 API 的 fetch 调用即可。
 * ============================================================ */
function mockAI(text) {
  text = (text || '').trim();
  var m;

  // 1) 画圆：在(0,0)画一个圆，半径为3
  m = text.match(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)[^)]*?半径[^\d-]*(-?\d+(?:\.\d+)?)/);
  if (m && /圆/.test(text)) {
    var cx = parseFloat(m[1]), cy = parseFloat(m[2]), r = parseFloat(m[3]);
    return {
      sentence: '已根据你的指令创建：圆心 O(' + cx + ', ' + cy + ')，半径为 ' + r + ' 的圆。',
      steps: [
        { type: 'point', id: 'O', coords: [cx, cy] },
        { type: 'circle', id: 'c1', center: 'O', radius: r }
      ]
    };
  }

  // 2) 画三角形
  if (/三角形/.test(text)) {
    return {
      sentence: '已根据你的指令创建：顶点为 A(0, 0)、B(5, 0)、C(2, 4) 的三角形。',
      steps: [
        { type: 'point', id: 'A', coords: [0, 0] },
        { type: 'point', id: 'B', coords: [5, 0] },
        { type: 'point', id: 'C', coords: [2, 4] },
        { type: 'polygon', id: 'tri', points: ['A', 'B', 'C'] }
      ]
    };
  }

  // 3) 画线段：从(-4,-2)到(4,3)的线段
  m = text.match(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)[^\d-]*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/);
  if (m && /线段|直线/.test(text)) {
    var kind = /直线/.test(text) ? 'line' : 'segment';
    var label = kind === 'line' ? '直线' : '线段';
    return {
      sentence: '已根据你的指令创建：从 P1(' + m[1] + ', ' + m[2] + ') 到 P2(' + m[3] + ', ' + m[4] + ') 的' + label + '。',
      steps: [
        { type: kind, id: kind === 'line' ? 'l1' : 's1', p1: [parseFloat(m[1]), parseFloat(m[2])], p2: [parseFloat(m[3]), parseFloat(m[4])] }
      ]
    };
  }

  // 4) 画点：在(2,-1)处画一个点
  m = text.match(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/);
  if (m && /点/.test(text)) {
    return {
      sentence: '已根据你的指令创建：位于 (' + m[1] + ', ' + m[2] + ') 的点 P。',
      steps: [{ type: 'point', id: 'P', coords: [parseFloat(m[1]), parseFloat(m[2])] }]
    };
  }

  return {
    sentence: '抱歉，演示版 AI 只能识别以下几种指令句式：画圆（含圆心坐标与半径）、画三角形、画线段/直线（含起止坐标）、画点（含坐标)。请点击上方的示例按钮试试。',
    steps: null
  };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

document.getElementById('btnAI').addEventListener('click', function () {
  var text = document.getElementById('instruction').value;
  if (!text.trim()) { setStatus('请先输入文字指令。', false); return; }
  var result = mockAI(text);
  var box = document.getElementById('aiReply');
  var html = '<div class="who">你的指令：' + escapeHtml(text) + '</div>' +
             '<div class="sentence">🤖 ' + escapeHtml(result.sentence) + '</div>';
  if (result.steps) {
    var json = JSON.stringify(result.steps, null, 2);
    document.getElementById('jsonInput').value = json;
    html += '<details open><summary>查看生成的 JSON（已填入下方编辑框，可直接渲染）</summary><pre>' +
            escapeHtml(json) + '</pre></details>';
    try {
      var n = renderSteps(result.steps);
      setStatus('AI 生成成功，已渲染 ' + n + ' 个对象。', true);
    } catch (err) {
      setStatus('AI 生成的 JSON 渲染失败：' + err.message, false);
    }
  } else {
    setStatus('AI 未能理解该指令。', false);
  }
  box.innerHTML = html;
});

document.querySelectorAll('.chips button').forEach(function (chip) {
  chip.addEventListener('click', function () {
    document.getElementById('instruction').value = chip.getAttribute('data-demo');
    document.getElementById('btnAI').click();
  });
});

/* ============================================================
 * 嵌入模式：React 外壳经 postMessage 桥控制（新增）
 *  外壳→iframe：jxg:init / jxg:apply-steps / jxg:set-readonly / jxg:ai-result
 *             jxg:export-ggb（导出 .ggb） / jxg:import-ggb（{base64} 导入 .ggb）
 *  iframe→外壳：jxg:ready / jxg:steps-changed（防抖） / jxg:status
 *             jxg:ggb-export（{base64|error, warnings}） / jxg:ggb-import（{ok, steps|error, warnings}）
 * ============================================================ */
var EMBEDDED = (window.parent !== window);
var READ_ONLY = false;
try { window.__jxgRender = renderSteps; window.__jxgBoard = board; } catch (e) {}   // 调试句柄（自动化测试用）
try { window.__jxgOpenProps = openPropPanel; } catch (e) {}

function postToParent(msg) {
  try { window.parent.postMessage(msg, '*'); } catch (e) {}
}
var _notifyTimer = null;
function notifyStepsChanged() {
  if (!EMBEDDED || READ_ONLY) return;
  if (_notifyTimer) clearTimeout(_notifyTimer);
  _notifyTimer = setTimeout(function () {
    try {
      var snap = snapshotState();
      postToParent({ type: 'jxg:steps-changed', steps: snap.steps });
    } catch (e) {}
  }, 300);
}
if (EMBEDDED) {
  document.body.classList.add('embedded');
  /* 按步骤 id（点名）找画板上的点对象，供 GGB 导出的正则多边形顶点计算等使用 */
  function findPtByName(nm) {
    for (var k in board.objects) {
      var o = board.objects[k];
      if (o && o.elementClass === JXG.OBJECT_CLASS_POINT && o.name === nm) return o;
    }
    return null;
  }
  /* 画板任何变更（新建/删除/拖动/显隐/改名）都会触发 update，统一在这里防抖上报，
   * 替代逐个工具埋点；只读态不上报 */
  board.on('update', notifyStepsChanged);
  window.addEventListener('message', function (ev) {
    var d = ev.data || {};
    if (typeof d.type !== 'string' || d.type.indexOf('jxg:') !== 0) return;
    if (d.type === 'jxg:init') {
      if (_readyRetry) { clearInterval(_readyRetry); _readyRetry = null; }   // 握手完成，停止重试
      READ_ONLY = !!d.readOnly;
      document.body.classList.toggle('jxg-readonly', READ_ONLY);
      if (Array.isArray(d.steps) && d.steps.length) {
        try { renderSteps(d.steps); }
        catch (err) { postToParent({ type: 'jxg:status', level: 'error', message: '渲染失败：' + err.message }); }
      }
      try { enforceSquareGrid(); } catch (e) {}   // 校正历史上已失衡的视图
      /* 注意：这里不能回发 jxg:ready —— 外壳收到 ready 会再发 init，
       * init→ready 无限 ping-pong 会让 renderSteps 反复清空重建（更新风暴、标签乱跳） */
    } else if (d.type === 'jxg:apply-steps') {
      if (Array.isArray(d.steps)) {
        try {
          var n = renderSteps(d.steps);
          postToParent({ type: 'jxg:status', level: 'ok', message: '已渲染 ' + n + ' 个对象' });
        } catch (err) {
          postToParent({ type: 'jxg:status', level: 'error', message: '渲染失败：' + err.message });
        }
      }
    } else if (d.type === 'jxg:set-readonly') {
      READ_ONLY = !!d.readOnly;
      document.body.classList.toggle('jxg-readonly', READ_ONLY);
    } else if (d.type === 'jxg:ai-result') {
      if (d.error) setStatus('AI 调整失败：' + d.error, false);
      else if (Array.isArray(d.steps)) {
        try { renderSteps(d.steps); setStatus('AI 调整已渲染。', true); }
        catch (err) { setStatus('AI 结果渲染失败：' + err.message, false); }
      }
    } else if (d.type === 'jxg:export-ggb') {
      /* 步骤 -> geogebra.xml -> .ggb（zip），base64 回传外壳下载 */
      try {
        var curSteps = (snapshotState() || {}).steps || [];
        var gres = window.GgbIo.stepsToXml(curSteps, function (pid) {
          var po = findPtByName(pid);
          return po ? { x: po.X(), y: po.Y() } : null;
        });
        var gzip = new JSZip();
        gzip.file('geogebra.xml', gres.xml);
        gzip.generateAsync({ type: 'base64', compression: 'DEFLATE' }).then(function (b64) {
          postToParent({ type: 'jxg:ggb-export', base64: b64, warnings: gres.warnings });
        }, function (gerr) {
          postToParent({ type: 'jxg:ggb-export', error: '打包失败：' + gerr.message });
        });
      } catch (err) {
        postToParent({ type: 'jxg:ggb-export', error: err.message });
      }
    } else if (d.type === 'jxg:import-ggb') {
      /* .ggb（base64）-> geogebra.xml -> 步骤 -> 校验并整体重绘 */
      try {
        var izip = new JSZip();
        izip.loadAsync(d.base64, { base64: true }).then(function (z) {
          var f = z.file('geogebra.xml');
          if (!f) { postToParent({ type: 'jxg:ggb-import', error: '文件中缺少 geogebra.xml' }); return; }
          f.async('string').then(function (xml) {
            try {
              var ires = window.GgbIo.xmlToSteps(xml);
              var n2 = renderSteps(ires.steps);
              setStatus('已从 GGB 导入 ' + n2 + ' 个对象。', true);
              postToParent({ type: 'jxg:ggb-import', ok: true, steps: ires.steps, warnings: ires.warnings });
            } catch (err2) {
              postToParent({ type: 'jxg:ggb-import', error: err2.message });
            }
          });
        }, function (ierr) {
          postToParent({ type: 'jxg:ggb-import', error: 'GGB 解压失败：' + ierr.message });
        });
      } catch (err) {
        postToParent({ type: 'jxg:ggb-import', error: err.message });
      }
    }
  });
  /* 脚本同步执行期外壳还没法发消息，先报 ready；外壳收到后发 jxg:init。
   * 若外壳监听器挂载较晚错过了，700ms 重试直到收到任何外壳消息（握手完成） */
  postToParent({ type: 'jxg:ready', steps: null });
  var _readyRetry = setInterval(function () {
    postToParent({ type: 'jxg:ready', steps: null });
  }, 700);
}

// 初始演示：独立打开时加载一个三角形；嵌入模式由外壳经 jxg:init 注入步骤
if (!EMBEDDED) {
  document.getElementById('jsonInput').value = JSON.stringify([
    { type: 'point', id: 'A', coords: [0, 0] },
    { type: 'point', id: 'B', coords: [5, 0] },
    { type: 'point', id: 'C', coords: [2, 4] },
    { type: 'polygon', id: 'tri', points: ['A', 'B', 'C'] }
  ], null, 2);

  try {
    var initSteps = JSON.parse(document.getElementById('jsonInput').value);
    var initN = renderSteps(initSteps);
    setStatus('已自动生成初始示例：三角形（' + initN + ' 个对象）。', true);
  } catch (err) {
    setStatus('初始示例渲染失败：' + err.message, false);
  }
}

/* 初始化完成：开始记录历史 */
suppressHistory = false;
_lastHistKey = JSON.stringify(snapshotState().steps);
updateUndoButtons();

