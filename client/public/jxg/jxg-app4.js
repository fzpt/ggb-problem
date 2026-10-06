/* ============================================================
 * jxg-app4.js —— 画板事件（down/move/up）、删除、JSON 重建、外壳桥接、初始化
 * 与其它 jxg-app*.js 以普通 <script> 顺序加载，共享全局作用域。
 * ============================================================ */
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
  try { deselectWidget(); } catch (eDW) {}   // 点画布空白处：取消文本框选中态
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
    var amDir = (document.getElementById('angDir') || {}).value || 'minor';
    var am = makeAngleMeasure(mpa, mpv, mpb, nextSeqId('a'), amDir);
    document.getElementById('hint').textContent = HINTS.mang;
    setStatus('已创建' + describeDef(am) + '。', true);
    return;
  }
  /* 度量：表达式文本 — 工具栏输入表达式，点击空白处放置 */
  /* 文本框：点击空白处放置，弹出对话框输入文本（仿 GeoGebra）；取消则不创建 */
  if (mode === 'ptext') {
    openWidgetDialog('ptext', function (ok, val) {
      if (!ok || !String(val).trim()) return;
      var ptx = makeTextBox(val, sx, sy);
      setStatus('已创建' + describeWidget(ptx) + '。', true);
    });
    return;
  }
  /* 复选框：点击空白处放置，弹出对话框输入标题；脚本在属性面板中设置 */
  if (mode === 'checkbox') {
    openWidgetDialog('checkbox', function (ok, val) {
      if (!ok) return;
      var cbx = makeCheckbox(String(val).trim() || '复选框', sx, sy, false, '');
      setStatus('已创建' + describeWidget(cbx) + '。在属性面板中可设置切换脚本。', true);
    });
    return;
  }
  /* 按钮：点击空白处放置，弹出对话框输入标题；脚本在属性面板中设置 */
  if (mode === 'button') {
    openWidgetDialog('button', function (ok, val) {
      if (!ok) return;
      var btx = makeButton(String(val).trim() || '按钮', sx, sy, '');
      setStatus('已创建' + describeWidget(btx) + '。在属性面板中可设置点击脚本。', true);
    });
    return;
  }
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
    /* 纯数字直接用，否则按数表达式求值（度量变量 + Distance/Length 等函数） */
    var ak = 1;
    if (kEl && String(kEl.value).trim() !== '') {
      var kRaw = String(kEl.value).trim();
      try {
        ak = /^\d*\.?\d+$/.test(kRaw) ? parseFloat(kRaw) : evalMsrExpr(kRaw);
      } catch (e) {
        setStatus('倍数无效：' + e.message, false);
        document.getElementById('hint').textContent = HINTS.adrive;
        return;
      }
      if (!isFinite(ak)) { setStatus('倍数必须是数字或数表达式。', false); return; }
    }
    /* 复用同三点的已有角度度量作为基准；没有则顺手新建 */
    var srcCarrier = null;
    for (var ci = 0; ci < createdIds.length; ci++) {
      var cc = board.objects[createdIds[ci]];
      if (cc && cc._measure && cc._measure.kind === 'angle') {
        var cpts = cc._measure.pts;
        if (cpts[0] === bp1.id && cpts[1] === bv.id && cpts[2] === bp2.id) { srcCarrier = cc; break; }
      }
    }
    if (!srcCarrier) srcCarrier = makeAngleMeasure(bp1, bv, bp2, nextSeqId('a'), 'ccw');
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
  } else if (mode === 'segment' || mode === 'line' || mode === 'ray' || mode === 'circle' || mode === 'vector') {
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
      else if (mode === 'vector') {
        el = board.create('arrow', [a, b], { name: nextId('v') });
        el._defKind = 'vector';
      }
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
    /* 单位向量被删时，其隐藏辅助点一并清掉（未登记在 createdIds 里） */
    if (t && t._defKind === 'vhelp' && doomed[t._vOwner]) {
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
    clearWidgets();
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
          if (Number.isFinite(s.pos)) {
            el.position = Math.max(0, Math.min(1, s.pos));
            el.needsUpdateFromParent = true;
          }
          break;
        }
        if (s.on !== undefined) {
          /* 约束在某对象上的点（描点时点中曲线自动生成） */
          var cv = resolveRef(s.on, registry, i);
          el = board.create('glider', [s.coords[0], s.coords[1], cv], { name: id });
          el._defKind = 'glider';
          el._onId = cv.id;
          applyGliderColor(el);
          if (Number.isFinite(s.pos)) {
            el.position = Math.max(0, Math.min(1, s.pos));
            el.needsUpdateFromParent = true;
          }
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
        qE._free = (s.type === 'psegfree');
        applyDrivenGray(qE);
        /* 自由端是有约束的可动点（glider）：蓝色区别于完全从动点 */
        if (qE._free) applyGliderColor(qE);
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
          /* 完整数表达式（与表达式文本同一套函数表/度量变量），每次更新动态求值 */
          var exFn = function () { try { return evalMsrExpr(s.x); } catch (e) { return NaN; } };
          var eyFn = function () { try { return evalMsrExpr(s.y); } catch (e) { return NaN; } };
          el = board.create('point', [exFn, eyFn], { name: id, fixed: true });
          el._defKind = 'exprpoint';
          if (s.def) el._defRaw = s.def;
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
        case 'vector': {
          if (s.p1 === undefined || s.p2 === undefined)
            throw new Error('第 ' + (i + 1) + ' 步：vector 需要 p1（起点）, p2（终点）');
          var vq1 = resolveRef(s.p1, registry, i), vq2 = resolveRef(s.p2, registry, i);
          el = board.create('arrow', [vq1, vq2], { name: id });
          el._defKind = 'vector';
          break;
        }
        case 'vunit': {
          if (s.of === undefined)
            throw new Error('第 ' + (i + 1) + ' 步：vunit 需要 of（向量/线段/直线 id）');
          var vus = resolveRef(s.of, registry, i);
          if (vus.elType !== 'arrow' && vus.elType !== 'segment' && vus.elType !== 'line')
            throw new Error('第 ' + (i + 1) + ' 步：vunit 的 of 必须是向量/线段/直线');
          var vup = vus.parents || [];
          var vua = board.objects[vup[0]], vub = board.objects[vup[1]];
          if (!vua || !vub)
            throw new Error('第 ' + (i + 1) + ' 步：vunit 的 of 缺少端点引用');
          /* 隐藏辅助点：起点锚定在 of 的点1，终点 = 起点 + 单位方向 */
          var vh1 = board.create('point', [function () { return vua.X(); }, function () { return vua.Y(); }],
            { visible: false, fixed: true });
          var vh2 = board.create('point', [
            function () {
              var dx = vub.X() - vua.X(), dy = vub.Y() - vua.Y();
              var L = Math.hypot(dx, dy);
              return L > 1e-12 ? vua.X() + dx / L : vua.X();
            },
            function () {
              var dx = vub.X() - vua.X(), dy = vub.Y() - vua.Y();
              var L = Math.hypot(dx, dy);
              return L > 1e-12 ? vua.Y() + dy / L : vua.Y();
            }
          ], { visible: false, fixed: true });
          vh1._defKind = 'vhelp';
          vh2._defKind = 'vhelp';
          el = board.create('arrow', [vh1, vh2], { name: id });
          vh1._vOwner = el.id; vh2._vOwner = el.id;
          el._defKind = 'vunit';
          el._vOf = vus.id;
          el._vhelpIds = [vh1.id, vh2.id];
          /* 源对象被删时级联删除（函数引用 ancestors 覆盖不到） */
          el._depIds = [vus.id];
          break;
        }
        case 'vpoint': {
          if (s.of === undefined || s.by === undefined || s.k === undefined)
            throw new Error('第 ' + (i + 1) + ' 步：vpoint 需要 of（起点）, by（向量）, k（倍数）');
          var vpo = resolveRef(s.of, registry, i);
          var vpb = resolveRef(s.by, registry, i);
          if (vpb.elType !== 'arrow')
            throw new Error('第 ' + (i + 1) + ' 步：vpoint 的 by 必须是向量（vector/vunit）');
          var vpbp = vpb.parents || [];
          var vpb1 = board.objects[vpbp[0]], vpb2 = board.objects[vpbp[1]];
          if (!vpb1 || !vpb2)
            throw new Error('第 ' + (i + 1) + ' 步：vpoint 的 by 缺少端点引用');
          var vk = Number(s.k);
          if (!isFinite(vk)) throw new Error('第 ' + (i + 1) + ' 步：vpoint 的 k 需要数值（倍数）');
          el = board.create('point', [
            function () { return vpo.X() + vk * (vpb2.X() - vpb1.X()); },
            function () { return vpo.Y() + vk * (vpb2.Y() - vpb1.Y()); }
          ], { name: id, fixed: true });
          el._defKind = 'vpoint';
          applyDrivenGray(el);
          el._depIds = [vpo.id, vpb.id];
          el._vOf = vpo.id; el._vBy = vpb.id; el._vK = vk;
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
            el = makeAngleMeasure(mq1, mqv, mq2, id, s.dir, true);
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
        case 'ptext': {
          if (!Array.isArray(s.at) || s.at.length !== 2 || !s.at.every(function (n) { return Number.isFinite(n); }))
            throw new Error('第 ' + (i + 1) + ' 步：ptext 需要 at [sx,sy] 屏幕像素坐标');
          makeTextBox(typeof s.content === 'string' ? s.content : '', s.at[0], s.at[1], true, id);
          return;   // 控件走 widgets 注册表，不进 board.objects
        }
        case 'checkbox': {
          if (!Array.isArray(s.at) || s.at.length !== 2 || !s.at.every(function (n) { return Number.isFinite(n); }))
            throw new Error('第 ' + (i + 1) + ' 步：checkbox 需要 at [sx,sy] 屏幕像素坐标');
          makeCheckbox(s.caption, s.at[0], s.at[1], !!s.checked,
                       typeof s.script === 'string' ? s.script : '', true, id);
          return;   // 控件走 widgets 注册表，不进 board.objects
        }
        case 'button': {
          if (!Array.isArray(s.at) || s.at.length !== 2 || !s.at.every(function (n) { return Number.isFinite(n); }))
            throw new Error('第 ' + (i + 1) + ' 步：button 需要 at [sx,sy] 屏幕像素坐标');
          makeButton(s.caption, s.at[0], s.at[1],
                     typeof s.script === 'string' ? s.script : '', true, id);
          return;   // 控件走 widgets 注册表，不进 board.objects
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
      /* 点的颜色带状态语义（灰=完全从动，蓝=有约束可动）：优先于记录样式，
       * 兼容旧数据里从动点带着自由橙样式保存的情况 */
      if (el.elementClass === JXG.OBJECT_CLASS_POINT) {
        if (isDrivenPoint(el)) applyDrivenGray(el);
        else if (el._defKind === 'glider') applyGliderColor(el);
      }
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

