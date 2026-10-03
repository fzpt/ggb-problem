/* ============================================================
 * GGB <-> JSXGraph 步骤 双向转换（GeoGebra Geometry 互通）
 *   window.GgbIo.stepsToXml(steps, resolvePt) -> geogebra.xml 字符串
 *   window.GgbIo.xmlToSteps(xml) -> { steps, warnings[] }
 *
 * stepsToXml 的 resolvePt(id) 由画板页提供，返回该点当前用户坐标 {x, y}
 * （正则多边形顶点计算等需要实际坐标；纯引用类步骤不需要）。
 * 导出原则：能映射为 GeoGebra 命令的保持联动；无对应命令的
 * （平行射线/平行线段/同侧约束交点）用表达式点降级并记入 warnings。
 * ============================================================ */
(function () {
  'use strict';

  var SAFE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function fmt(n) {
    if (!isFinite(n)) return '0';
    var v = Math.round(n * 1e9) / 1e9;
    return String(v);
  }

  /* ---------------- 导出：steps -> geogebra.xml ---------------- */

  function stepsToXml(steps, resolvePt) {
    var body = [];          // <construction> 内部片段
    var warnings = [];
    var autoN = 0;
    function auxId(prefix) { autoN += 1; return (prefix || 'aux') + '_' + autoN; }
    /* 步骤 id -> 步骤对象，供"参照线取定义点 / 多边形取顶点"等反查 */
    var byId = {};
    (steps || []).forEach(function (s) { if (s && s.id) byId[s.id] = s; });

    function elPoint(id, x, y, hidden) {
      body.push('<element type="point" label="' + esc(id) + '">' +
        '<coords x="' + fmt(x) + '" y="' + fmt(y) + '" z="1"/>' +
        (hidden ? '<show object="false" label="false"/>' : '') +
        '</element>');
    }
    function elExpr(id, exp, hidden) {
      body.push('<expression label="' + esc(id) + '" exp="' + esc(exp) + '"/>' +
        (hidden ? '<element type="point" label="' + esc(id) + '"><show object="false" label="false"/></element>' : ''));
    }
    function elCmd(name, inputs, outputs, outType, hidden) {
      var s = '<command name="' + name + '">';
      inputs.forEach(function (v, i) { s += '<input a' + i + '="' + esc(v) + '"/>'; });
      outputs.forEach(function (v, i) { s += '<output a' + i + '="' + esc(v) + '"/>'; });
      s += '</command>';
      body.push(s);
      if (hidden && outType) {
        body.push('<element type="' + outType + '" label="' + esc(outputs[0]) + '">' +
          '<show object="false" label="false"/></element>');
      }
    }
    /* 参照线（segment/line/ray/pline/pray…）的两个定义点 id */
    function lineEnds(refId) {
      var s = byId[refId];
      if (!s) return null;
      if (s.p1 !== undefined && s.p2 !== undefined) return [s.p1, s.p2];
      if (s.point !== undefined && s.ref !== undefined) {   // pline/pray/pseg：point + 递归参照
        var e = lineEnds(s.ref);
        return e;
      }
      return null;
    }
    function hideEl(id) {
      body.push('<element type="point" label="' + esc(id) + '"><show object="false" label="false"/></element>');
    }

    (steps || []).forEach(function (s) {
      if (!s || !s.type) return;
      var hid = (s.visible === false);
      switch (s.type) {
        case 'point':
          if (s.on !== undefined) elCmd('Point', [s.on], [s.id], 'point', hid);
          else if (Array.isArray(s.coords)) elPoint(s.id, s.coords[0], s.coords[1], hid);
          break;
        case 'segment': elCmd('Segment', [s.p1, s.p2], [s.id], 'segment', hid); break;
        case 'line': elCmd('Line', [s.p1, s.p2], [s.id], 'line', hid); break;
        case 'ray': elCmd('Ray', [s.p1, s.p2], [s.id], 'line', hid); break;
        case 'circle':
          if (s.through3) elCmd('Circle', s.through3.slice(), [s.id], 'conic', hid);
          else if (s.radius !== undefined) elCmd('Circle', [s.center, fmt(s.radius)], [s.id], 'conic', hid);
          else elCmd('Circle', [s.center, s.through], [s.id], 'conic', hid);
          break;
        case 'arc': elCmd('CircularArc', [s.center, s.p1, s.p2], [s.id], 'conic', hid); break;
        case 'arc3': elCmd('CircumcircularArc', s.through3.slice(), [s.id], 'conic', hid); break;
        case 'ellipse': elCmd('Ellipse', [s.f1, s.f2, s.p], [s.id], 'conic', hid); break;
        case 'hyperbola': elCmd('Hyperbola', [s.f1, s.f2, s.p], [s.id], 'conic', hid); break;
        case 'parabola': elCmd('Parabola', [s.focus, s.directrix], [s.id], 'conic', hid); break;
        case 'polygon': elCmd('Polygon', s.points.slice(), [s.id], 'polygon', hid); break;
        case 'regularpolygon': {
          /* 需要实际坐标：算出 n 个顶点，导出为点 + Polygon 命令 */
          var getPt = function (ref) {
            if (Array.isArray(ref)) return { x: ref[0], y: ref[1] };
            var c = resolvePt && resolvePt(ref);
            if (!c) throw new Error('正则多边形顶点计算需要点 ' + ref + ' 的坐标');
            return c;
          };
          var n = Math.round(Number(s.n)), verts = [];
          if (s.center !== undefined) {
            var cen = getPt(s.center), v0 = getPt(s.vertex);
            var R = Math.hypot(v0.x - cen.x, v0.y - cen.y);
            var th0 = Math.atan2(v0.y - cen.y, v0.x - cen.x);
            for (var k = 0; k < n; k++) {
              var th = th0 + 2 * Math.PI * k / n;
              verts.push([cen.x + R * Math.cos(th), cen.y + R * Math.sin(th)]);
            }
          } else {
            var A = getPt(s.p1), B = getPt(s.p2);
            var mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
            var dx = B.x - A.x, dy = B.y - A.y;
            var len = Math.hypot(dx, dy) || 1;
            var off = len / 2 / Math.tan(Math.PI / n);   /* 边心距方向（逆时针） */
            var cx2 = mx - dy / len * off, cy2 = my + dx / len * off;
            var thA = Math.atan2(A.y - cy2, A.x - cx2);
            var R2 = Math.hypot(A.x - cx2, A.y - cy2);
            for (var k2 = 0; k2 < n; k2++) {
              var th2 = thA + 2 * Math.PI * k2 / n;
              verts.push([cx2 + R2 * Math.cos(th2), cy2 + R2 * Math.sin(th2)]);
            }
          }
          var vids = verts.map(function (v, i) {
            var vid = (i === 0 && SAFE_ID.test(String(s.vertex || s.p1 || ''))) ? String(s.vertex || s.p1) : auxId('v');
            elPoint(vid, v[0], v[1], false);
            return vid;
          });
          elCmd('Polygon', vids, [s.id], 'polygon', hid);
          warnings.push('正则多边形 ' + s.id + ' 已展开为 ' + n + ' 个顶点（GeoGebra 无对应命令）');
          break;
        }
        case 'midpoint': elCmd('Midpoint', [s.p1, s.p2], [s.id], 'point', hid); break;
        case 'tricenter': {
          var a = s.points[0], b = s.points[1], c = s.points[2];
          var l1 = auxId('pb'), l2 = auxId('pb');
          if (s.kind === 'circumcenter') {
            elCmd('PerpendicularBisector', [a, b], [l1], 'line', true);
            elCmd('PerpendicularBisector', [b, c], [l2], 'line', true);
          } else if (s.kind === 'incenter') {
            elCmd('AngleBisector', [a, b, c], [l1], 'line', true);
            elCmd('AngleBisector', [c, b, a], [l2], 'line', true);
          } else {   /* orthocenter */
            var e1 = auxId('ln'), e2 = auxId('ln');
            elCmd('Line', [b, c], [e1], 'line', true);
            elCmd('Line', [a, c], [e2], 'line', true);
            elCmd('PerpendicularLine', [a, e1], [l1], 'line', true);
            elCmd('PerpendicularLine', [b, e2], [l2], 'line', true);
          }
          elCmd('Intersect', [l1, l2], [s.id], 'point', hid);
          break;
        }
        case 'perpendicular': {
          var aux = auxId('pl');
          elCmd('PerpendicularLine', [s.point, s.line], [aux], 'line', true);
          elCmd('Intersect', [aux, s.line], [s.id], 'point', hid);
          break;
        }
        case 'intersection': {
          if (s.side !== undefined) {
            /* 同侧/异侧约束无法表达：降级为固定第一个交点 */
            elCmd('Intersect', [s.e1, s.e2, '1'], [s.id], 'point', hid);
            warnings.push('交点 ' + s.id + ' 的同侧/异侧约束已降级为固定交点');
          } else if (s.polygon !== undefined) {
            var poly = byId[s.polygon];
            var pts2 = poly && poly.points;
            if (!pts2 || !pts2.length) {
              warnings.push('交点 ' + s.id + ' 引用的多边形 ' + s.polygon + ' 未找到，已跳过');
              break;
            }
            var eIdx = Math.min(s.edge || 0, pts2.length - 1);
            var el2 = auxId('el');
            elCmd('Line', [pts2[eIdx], pts2[(eIdx + 1) % pts2.length]], [el2], 'line', true);
            var ins = [s.e1, el2];
            if (s.index) ins.push(String(s.index + 1));
            elCmd('Intersect', ins, [s.id], 'point', hid);
          } else {
            var ins2 = [s.e1, s.e2];
            if (s.index) ins2.push(String(s.index + 1));
            elCmd('Intersect', ins2, [s.id], 'point', hid);
          }
          break;
        }
        case 'pline': elCmd('Parallel', [s.ref, s.point], [s.id], 'line', hid); break;
        case 'pray': {
          var ends = lineEnds(s.ref);
          if (!ends) { warnings.push('平行射线 ' + s.id + ' 的参照线无法解析，已跳过'); break; }
          var q = auxId('pq');
          elExpr(q, '(x(' + s.point + ')+(x(' + ends[1] + ')-x(' + ends[0] + ')),' +
                    'y(' + s.point + ')+(y(' + ends[1] + ')-y(' + ends[0] + ')))', true);
          elCmd('Ray', [s.point, q], [s.id], 'line', hid);
          break;
        }
        case 'pseg':
        case 'psegfree': {
          var ends2 = lineEnds(s.ref);
          if (!ends2) { warnings.push('平行线段 ' + s.id + ' 的参照线无法解析，已跳过'); break; }
          var end = (s.end !== undefined && s.end !== null) ? s.end : auxId('pe');
          var ex;
          if (s.type === 'pseg') {
            ex = '(x(' + s.point + ')+(x(' + ends2[1] + ')-x(' + ends2[0] + ')),' +
                 'y(' + s.point + ')+(y(' + ends2[1] + ')-y(' + ends2[0] + ')))';
          } else {
            ex = '(x(' + s.point + ')+(' + fmt(s.len) + '/Distance(' + ends2[0] + ',' + ends2[1] + '))*(x(' + ends2[1] + ')-x(' + ends2[0] + ')),' +
                 'y(' + s.point + ')+(' + fmt(s.len) + '/Distance(' + ends2[0] + ',' + ends2[1] + '))*(y(' + ends2[1] + ')-y(' + ends2[0] + ')))';
          }
          elExpr(end, ex, end !== s.end);
          elCmd('Segment', [s.point, end], [s.id], 'segment', hid);
          if (s.type === 'psegfree') warnings.push('平行线段 ' + s.id + ' 的端点已固化为表达式（原可沿线调长度）');
          break;
        }
        case 'mirrorpt': elCmd('Reflect', [s.of, s.axis], [s.id], 'point', hid); break;
        case 'bisector': elCmd('AngleBisector', [s.p1, s.vertex, s.p2], [s.id], 'line', hid); break;
        case 'perpseg': {
          var ln = auxId('ln'), cp = auxId('cp');
          elCmd('Line', [s.p1, s.p2], [ln], 'line', true);
          elCmd('ClosestPoint', [s.point, ln], [cp], 'point', true);
          elCmd('Segment', [s.point, cp], [s.id], 'segment', hid);
          break;
        }
        case 'rotate': elCmd('Rotate', [s.of, fmt(s.angle) + '°', s.center], [s.id], 'point', hid); break;
        case 'dilate': elCmd('Dilate', [s.of, fmt(s.ratio), s.center], [s.id], 'point', hid); break;
        case 'exprpoint': elExpr(s.id, '(' + s.x + ',' + s.y + ')', hid); break;
        default:
          warnings.push('步骤 ' + (s.id || '?') + '（' + s.type + '）无 GeoGebra 对应，已跳过');
      }
    });

    return {
      xml: '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<geogebra format="5.0" version="5.0.697.0" app="classic" platform="w" xsi:noNamespaceSchemaLocation="http://www.geogebra.org/apps/xsd/app.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
        '<construction>\n' + body.join('\n') + '\n</construction>\n</geogebra>\n',
      warnings: warnings
    };
  }

  /* ---------------- 导入：geogebra.xml -> steps ---------------- */

  function xmlToSteps(xml) {
    var warnings = [];
    var doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length)
      throw new Error('XML 解析失败：不是合法的 geogebra.xml');
    var cons = doc.getElementsByTagName('construction')[0];
    if (!cons) throw new Error('文件中没有 <construction> 节点');

    /* GeoGebra 标签可能含 unicode/数字开头，统一改名成安全 id 并维护映射 */
    var rename = {};
    var autoI = 0;
    function safeId(label) {
      if (rename[label]) return rename[label];
      var id = SAFE_ID.test(label) ? label : null;
      if (!id || rename['*used*' + id]) {
        autoI += 1;
        id = 'g' + autoI;
        while (rename['*used*' + id]) { autoI += 1; id = 'g' + autoI; }
      }
      rename[label] = id;
      rename['*used*' + id] = true;
      return id;
    }
    function rid(label) { return rename[label] !== undefined ? rename[label] : safeId(label); }

    /* 可见性：element 节点的 <show object="false"> */
    var hidden = {};
    var elems = doc.getElementsByTagName('element');
    for (var i = 0; i < elems.length; i++) {
      var lb = elems[i].getAttribute('label');
      var show = elems[i].getElementsByTagName('show')[0];
      if (lb && show && show.getAttribute('object') === 'false') hidden[lb] = true;
    }

    /* 命令输出标签集合（这些 label 不应再当成自由点） */
    var cmdOut = {};
    /* label -> 元素类型（element type 或命令推断），供参数类型判定（如 Line[线,点]=平行线） */
    var typeMap = {};
    var cmds = doc.getElementsByTagName('command');
    for (var j = 0; j < cmds.length; j++) {
      var outs = cmds[j].getElementsByTagName('output');
      for (var k = 0; k < outs.length; k++) {
        var ol = outs[k].getAttribute('a0') || outs[k].getAttribute('a');
        if (ol) {
          cmdOut[ol] = true;
          typeMap[ol] = cmdOutType(cmds[j].getAttribute('name') || '');
        }
      }
    }
    for (var ei = 0; ei < elems.length; ei++) {
      var et = elems[ei].getAttribute('type');
      var elb = elems[ei].getAttribute('label');
      if (et && elb && !typeMap[elb]) typeMap[elb] = et;
    }
    function cmdOutType(name) {
      switch (name) {
        case 'Segment': return 'segment';
        case 'Line': case 'Ray': case 'PerpendicularLine': case 'Parallel':
        case 'AngleBisector': case 'PerpendicularBisector': case 'FitLine': return 'line';
        case 'Circle': case 'CircularArc': case 'CircumcircularArc': case 'Semicircle':
        case 'Ellipse': case 'Hyperbola': case 'Parabola': return 'conic';
        case 'Polygon': case 'RegularPolygon': case 'Triangle': return 'polygon';
        case 'Midpoint': case 'Intersect': case 'Point': case 'ClosestPoint':
        case 'Incenter': case 'Circumcenter': case 'Orthocenter': case 'Centroid': return 'point';
        default: return '';
      }
    }

    var steps = [];
    function pushStep(st, label) {
      if (label) st.id = safeId(label);
      if (st.id === undefined || st.id === null) {
        autoI += 1; st.id = 'g' + autoI;
      }
      var srcLabel = label || st.id;
      if (hidden[srcLabel]) st.visible = false;
      steps.push(st);
    }
    function vis(label) { return hidden[label] ? { visible: false } : {}; }

    function num(v) {
      if (v === null || v === undefined) return NaN;
      var t = String(v).replace(/°/g, '').replace(/\\deg/g, '').trim();
      if (t.charAt(0) === '(' && t.charAt(t.length - 1) === ')') t = t.slice(1, -1);
      return parseFloat(t);
    }
    function inAttrs(cmd) {
      var arr = [];
      var ins = cmd.getElementsByTagName('input');
      for (var m = 0; m < ins.length; m++) {
        /* GeoGebra 实作：第 m 个参数属性名为 a{m}（a0/a1/a2…），单参数也见 a */
        var v = ins[m].getAttribute('a' + m);
        if (v === null) v = ins[m].getAttribute('a0');
        if (v === null) v = ins[m].getAttribute('a');
        arr.push(v || '');
      }
      return arr;
    }
    function outLabels(cmd) {
      var arr = [];
      var outs = cmd.getElementsByTagName('output');
      for (var m = 0; m < outs.length; m++) {
        var v = outs[m].getAttribute('a' + m);
        if (v === null) v = outs[m].getAttribute('a0');
        if (v === null) v = outs[m].getAttribute('a');
        arr.push(v || '');
      }
      return arr;
    }
    /* exp 顶层逗号切分（括号感知） */
    function splitTopComma(s) {
      var depth = 0;
      for (var i2 = 0; i2 < s.length; i2++) {
        if (s[i2] === '(') depth++;
        else if (s[i2] === ')') depth--;
        else if (s[i2] === ',' && depth === 1) return [s.slice(0, i2), s.slice(i2 + 1)];
      }
      return null;
    }

    var kids = cons.children;
    for (var ci = 0; ci < kids.length; ci++) {
      var node = kids[ci];
      if (node.tagName === 'element') {
        var label = node.getAttribute('label');
        if (!label || cmdOut[label]) continue;
        if (node.getAttribute('type') !== 'point') continue;   // 非点的裸 element 暂不处理
        var coords = node.getElementsByTagName('coords')[0];
        if (!coords) continue;
        var x = parseFloat(coords.getAttribute('x'));
        var y = parseFloat(coords.getAttribute('y'));
        if (!isFinite(x) || !isFinite(y)) continue;
        pushStep({ type: 'point', coords: [x, y] }, label);
      } else if (node.tagName === 'expression') {
        var el2 = node.getAttribute('label');
        var exp = node.getAttribute('exp') || '';
        if (!el2) continue;
        var inner = /^\(([\s\S]*)\)$/.exec(exp.trim());
        var parts = inner ? splitTopComma(inner[1]) : null;
        if (parts) {
          var nx = num(parts[0]), ny = num(parts[1]);
          if (isFinite(nx) && isFinite(ny)) {
            pushStep({ type: 'point', coords: [nx, ny] }, el2);
          } else if (/[A-Za-z_(]/.test(parts[0])) {
            /* 点表达式：x(A)/y(A)/Distance(A,B) 语法与 GeoGebra 一致，直接转 exprpoint */
            pushStep({ type: 'exprpoint', x: parts[0].trim(), y: parts[1].trim() }, el2);
          } else {
            warnings.push('表达式 ' + el2 + ' 无法识别为点，已跳过');
          }
        } else {
          warnings.push('表达式 ' + (el2 || '?') + '（' + exp + '）不是点，已跳过');
        }
      } else if (node.tagName === 'command') {
        var name = node.getAttribute('name') || '';
        var inp = inAttrs(node);
        var outs2 = outLabels(node);
        var out0 = outs2[0];
        if (!out0) continue;
        switch (name) {
          case 'Segment':
            if (inp.length >= 2) pushStep({ type: 'segment', p1: rid(inp[0]), p2: rid(inp[1]) }, out0);
            break;
          case 'Line':
            if (inp.length >= 2 && typeMap[inp[0]] !== 'line')
              pushStep({ type: 'line', p1: rid(inp[0]), p2: rid(inp[1]) }, out0);
            else if (inp.length >= 2)
              pushStep({ type: 'pline', point: rid(inp[1]), ref: rid(inp[0]) }, out0);
            break;
          case 'Ray':
            if (inp.length >= 2) pushStep({ type: 'ray', p1: rid(inp[0]), p2: rid(inp[1]) }, out0);
            break;
          case 'Circle':
            if (inp.length === 3) pushStep({ type: 'circle', through3: [rid(inp[0]), rid(inp[1]), rid(inp[2])] }, out0);
            else if (inp.length === 2) {
              var r = num(inp[1]);
              if (isFinite(r)) pushStep({ type: 'circle', center: rid(inp[0]), radius: r }, out0);
              else pushStep({ type: 'circle', center: rid(inp[0]), through: rid(inp[1]) }, out0);
            }
            break;
          case 'CircularArc':
            if (inp.length >= 3) pushStep({ type: 'arc', center: rid(inp[0]), p1: rid(inp[1]), p2: rid(inp[2]) }, out0);
            break;
          case 'CircumcircularArc':
            if (inp.length >= 3) pushStep({ type: 'arc3', through3: [rid(inp[0]), rid(inp[1]), rid(inp[2])] }, out0);
            break;
          case 'Ellipse':
          case 'Hyperbola':
            if (inp.length >= 3)
              pushStep({ type: name === 'Ellipse' ? 'ellipse' : 'hyperbola',
                         f1: rid(inp[0]), f2: rid(inp[1]), p: rid(inp[2]) }, out0);
            break;
          case 'Parabola':
            if (inp.length >= 2)
              pushStep({ type: 'parabola', focus: rid(inp[0]), directrix: rid(inp[1]) }, out0);
            break;
          case 'Polygon':
            if (inp.length >= 3) pushStep({ type: 'polygon', points: inp.map(rid) }, out0);
            break;
          case 'RegularPolygon': {
            var nV = Math.round(num(inp[2]));
            if (inp.length >= 3 && isFinite(nV) && nV >= 3)
              pushStep({ type: 'regularpolygon', n: nV, p1: rid(inp[0]), p2: rid(inp[1]) }, out0);
            else warnings.push('RegularPolygon 参数不足，已跳过');
            break;
          }
          case 'Midpoint':
            if (inp.length >= 2) pushStep({ type: 'midpoint', p1: rid(inp[0]), p2: rid(inp[1]) }, out0);
            break;
          case 'PerpendicularLine':
            if (inp.length >= 2) {
              /* 参数顺序可能是 (点,线) 或 (线,点)，按类型判定 */
              if (typeMap[inp[0]] === 'line')
                pushStep({ type: 'perpendicular', line: rid(inp[0]), point: rid(inp[1]) }, out0);
              else
                pushStep({ type: 'perpendicular', line: rid(inp[1]), point: rid(inp[0]) }, out0);
            }
            break;
          case 'Parallel':
            if (inp.length >= 2) pushStep({ type: 'pline', point: rid(inp[1]), ref: rid(inp[0]) }, out0);
            break;
          case 'AngleBisector':
            if (inp.length >= 3) pushStep({ type: 'bisector', p1: rid(inp[0]), vertex: rid(inp[1]), p2: rid(inp[2]) }, out0);
            break;
          case 'Intersect': {
            if (outs2.length > 1) {
              /* 多个交点输出：每个输出一个带序号的 intersection 步骤 */
              for (var oi = 0; oi < outs2.length; oi++) {
                pushStep({ type: 'intersection', e1: rid(inp[0]), e2: rid(inp[1]), index: oi }, outs2[oi]);
              }
            } else {
              var idx = (inp.length >= 3 && isFinite(num(inp[2]))) ? Math.max(0, Math.round(num(inp[2])) - 1) : 0;
              pushStep({ type: 'intersection', e1: rid(inp[0]), e2: rid(inp[1]), index: idx }, out0);
            }
            break;
          }
          case 'Reflect': case 'Mirror': {
            /* 轴：第二个输入是点 → 中心对称，否则（线）→ 轴对称 */
            var t = (typeMap[inp[1]] === 'point') ? 'central' : 'axial';
            pushStep({ type: 'mirrorpt', of: rid(inp[0]), axis: rid(inp[1]), t: t }, out0);
            break;
          }
          case 'Rotate':
            if (inp.length >= 3) pushStep({ type: 'rotate', of: rid(inp[0]), center: rid(inp[2]), angle: num(inp[1]) }, out0);
            break;
          case 'Dilate':
            if (inp.length >= 3) pushStep({ type: 'dilate', of: rid(inp[0]), center: rid(inp[2]), ratio: num(inp[1]) }, out0);
            break;
          case 'Point':
            if (inp.length === 1) {
              /* Point[曲线]：约束点（落在我们支持的线/圆上才可渲染） */
              pushStep({ type: 'point', coords: [0, 0], on: rid(inp[0]) }, out0);
              warnings.push('点 ' + out0 + ' 为曲线约束点，导入后位置可能需要微调');
            } else if (inp.length >= 2 && isFinite(num(inp[0])) && isFinite(num(inp[1]))) {
              pushStep({ type: 'point', coords: [num(inp[0]), num(inp[1])] }, out0);
            }
            break;
          case 'Incenter': case 'Circumcenter': case 'Orthocenter':
            if (inp.length >= 3)
              pushStep({ type: 'tricenter', kind: name.toLowerCase(), points: [rid(inp[0]), rid(inp[1]), rid(inp[2])] }, out0);
            else warnings.push(name + ' 需要三个点参数，已跳过');
            break;
          case 'PerpendicularBisector':
            warnings.push('中垂线 ' + out0 + ' 暂无对应步骤类型，已跳过');
            break;
          default:
            warnings.push('命令 ' + name + '（输出 ' + out0 + '）暂不支持，已跳过');
        }
      }
    }
    return { steps: steps, warnings: warnings };
  }

  window.GgbIo = { stepsToXml: stepsToXml, xmlToSteps: xmlToSteps };
})();
