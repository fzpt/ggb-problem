import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { runCommands } from '../lib/ggb';
import { loadGgbScript, useLocalGgbCodebase } from '../lib/ggb-script';
import { saveProblemVersion } from '../services/api';

const formatTime = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// 从当前画布 getXML() 反推最新建图语句与属性。
// 直接解析 <construction>：command/expression 节点给出英文命令（不受界面语言影响），
// element 节点给出坐标、可见性、颜色、线宽等完整属性；
// 手动调整/调整指令执行后的最新状态都包含在内，区别于历史保存的 commands。
function readCurrentCanvas() {
  const api = window.ggbApplet;
  if (!api || typeof api.getXML !== 'function') return { commands: '', attributes: '' };
  let xml;
  try { xml = api.getXML(); } catch { return { commands: '', attributes: '' }; }
  const construction = new DOMParser().parseFromString(xml, 'text/xml').querySelector('construction');
  if (!construction) return { commands: '', attributes: '' };

  const elemByLabel = new Map();
  for (const el of construction.children) {
    if (el.tagName === 'element') elemByLabel.set(el.getAttribute('label'), el);
  }

  const attrLine = (label) => {
    const el = elemByLabel.get(label);
    if (!el) return '';
    const parts = [];
    const type = el.getAttribute('type');
    if (type) parts.push(`类型:${type}`);
    const coords = el.querySelector(':scope > coords');
    if (coords && type === 'point') {
      const x = Number(coords.getAttribute('x'));
      const y = Number(coords.getAttribute('y'));
      const z = Number(coords.getAttribute('z') || 1);
      if (z) parts.push(`坐标:(${(x / z).toFixed(4).replace(/\.?0+$/, '')}, ${(y / z).toFixed(4).replace(/\.?0+$/, '')})`);
    }
    const show = el.querySelector(':scope > show');
    if (show) {
      if (show.getAttribute('object') === 'false') parts.push('隐藏');
      if (show.getAttribute('label') === 'false') parts.push('标签隐藏');
    }
    const color = el.querySelector(':scope > objColor');
    if (color) {
      const hex = [color.getAttribute('r'), color.getAttribute('g'), color.getAttribute('b')]
        .map((v) => Number(v).toString(16).padStart(2, '0')).join('');
      parts.push(`颜色:#${hex}`);
    }
    const lineStyle = el.querySelector(':scope > lineStyle');
    if (lineStyle) parts.push(`线宽:${lineStyle.getAttribute('thickness')}`);
    const pointSize = el.querySelector(':scope > pointSize');
    if (pointSize) parts.push(`点大小:${pointSize.getAttribute('val')}`);
    const layer = el.querySelector(':scope > layer');
    if (layer && layer.getAttribute('val') !== '0') parts.push(`图层:${layer.getAttribute('val')}`);
    return parts.join(' | ');
  };

  const cmdLines = [];
  const attrLines = [];
  const emitted = new Set();
  for (const node of construction.children) {
    if (node.tagName === 'expression') {
      const label = node.getAttribute('label');
      cmdLines.push(`${label} = ${node.getAttribute('exp')}`);
      const a = attrLine(label);
      if (a) attrLines.push(`${label}: ${a}`);
      emitted.add(label);
    } else if (node.tagName === 'command') {
      const name = node.getAttribute('name');
      const inputNode = node.querySelector('input');
      const outputNode = node.querySelector('output');
      const inputs = inputNode ? [...inputNode.attributes].map((at) => at.value) : [];
      const outputs = outputNode ? [...outputNode.attributes].map((at) => at.value) : [];
      cmdLines.push(`${outputs.join(', ')} = ${name}(${inputs.join(', ')})`);
      for (const o of outputs) {
        const a = attrLine(o);
        if (a) attrLines.push(`${o}: ${a}`);
        emitted.add(o);
      }
    }
  }
  // 既无 expression 也无 command 的对象（工具绘制等），退化为代数定义串
  for (const [label] of elemByLabel) {
    if (emitted.has(label)) continue;
    let def = '';
    try { def = api.getDefinitionString(label); } catch { def = ''; }
    if (def) cmdLines.push(`${label} = ${def}`);
    const a = attrLine(label);
    if (a) attrLines.push(`${label}: ${a}`);
  }
  return { commands: cmdLines.join('\n'), attributes: attrLines.join('\n') };
}

export default function GeoGebraViewer() {
const containerRef = useRef(null);
const [ready, setReady] = useState(false);
const [showCommands, setShowCommands] = useState(false);
const [currentCommands, setCurrentCommands] = useState('');
const [currentAttrs, setCurrentAttrs] = useState('');
const [showAttrs, setShowAttrs] = useState(true);
const [toast, setToast] = useState(null);
const toastTimerRef = useRef(null);
  const { activeProblem, updateProblem, setStatus, setLog, setDrawnProblemId, editingIds } = useApp();
  const prevIdRef = useRef(null);
  // 上一题是否是编辑态：切题时只为编辑态的题目 flush 画布改动
  const prevEditableRef = useRef(false);
  // 只读保护：加载/切题期间禁止回滚（此刻 XML 变化来自题目切换本身）
  const loadingRef = useRef(false);
  // 最新数据基准：手动「保存」/存档时读取画布 XML 写入 ggbState（已取消自动保存）
  const lastXmlRef = useRef('');
  const activeIdRef = useRef(null);
  const editableRef = useRef(false);

  const commands = activeProblem?.commands || '';
  const { name, ggbState } = activeProblem || {};
  const editable = activeProblem?.id != null && editingIds.includes(activeProblem.id);

  activeIdRef.current = activeProblem?.id || null;
  editableRef.current = editable;

  // 自动消失的浮层提示
  const showToast = (msg) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  };

  // "查看指令"面板：展示从画布实时反推的最新指令，打开期间每 2.5s 刷新
  useEffect(() => {
    if (!showCommands || !ready) return undefined;
    const update = () => {
      const { commands, attributes } = readCurrentCanvas();
      setCurrentCommands(commands);
      setCurrentAttrs(attributes);
    };
    update();
    const timer = setInterval(update, 2500);
    return () => clearInterval(timer);
  }, [showCommands, ready]);

  // 保存当前画布为一个版本快照；达到上限（5 个）时询问是否删除最旧版本
  const saveCurrentVersion = async () => {
    if (!activeProblem) {
      setLog('请先选择一道题目。');
      return;
    }
    if (!window.ggbApplet) {
      setLog('GeoGebra 尚未加载完成，无法保存。');
      return;
    }
    let xml;
    try {
      xml = window.ggbApplet.getXML();
    } catch (e) {
      setLog('保存失败：' + e.message);
      return;
    }
    try {
      let res = await saveProblemVersion(activeProblem.id, xml, false);
      if (res.limited) {
        const ok = window.confirm(
          `该题目已有 ${res.count} 个版本（最多保留 ${res.limit} 个）。继续保存将删除最旧的版本，是否继续？`
        );
        if (!ok) {
          setLog('已取消保存版本。');
          return;
        }
        res = await saveProblemVersion(activeProblem.id, xml, true);
      }
      updateProblem(activeProblem.id, { ggbState: xml });
      lastXmlRef.current = xml;
      showToast(`已保存当前版本（${formatTime(res.created_at)}）`);
    } catch (e) {
      showToast('保存版本失败：' + e.message);
    }
  };

  // 保存当前画布为最新数据（手动落库，不生成版本）
  const saveNow = () => {
    if (!activeProblem || !editable) return;
    const api = window.ggbApplet;
    if (!api) {
      setLog('GeoGebra 尚未加载完成，无法保存。');
      return;
    }
    let xml;
    try {
      xml = api.getXML();
    } catch (e) {
      setLog('保存失败：' + e.message);
      return;
    }
    updateProblem(activeProblem.id, { ggbState: xml });
    lastXmlRef.current = xml;
    showToast('已保存当前图形。');
  };

  // 只读模式：允许拖动对象与背景平移，禁止新增/删除/改属性。
  // 手段：对象可拖动但不可选中（挡键盘删除与选中类属性操作）、
  // 隐藏工具栏与代数输入（CSS 类 .readonly）、拦截右键菜单（下方 effect）、
  // 新增对象立即删除（registerAddListener 兜底，见 init effect）
  useEffect(() => {
    if (!ready || !window.ggbApplet) return undefined;
    const api = window.ggbApplet;
    const ro = !editable;
    let labels = [];
    try {
      labels = (typeof api.getAllObjectNames === 'function' && api.getAllObjectNames()) || [];
    } catch {
      labels = [];
    }
    for (const label of labels) {
      try {
        api.setFixed(label, false, !ro);
      } catch {
        // 对象可能正在重建，忽略
      }
    }
    containerRef.current?.classList.toggle('readonly', ro);
    return undefined;
  }, [ready, editable, activeProblem?.id]);

  // 只读态拦截右键菜单（Settings/删除入口都在右键菜单里）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onCtx = (e) => {
      if (!editableRef.current) e.preventDefault();
    };
    el.addEventListener('contextmenu', onCtx);
    return () => el.removeEventListener('contextmenu', onCtx);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadGgbScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.GGBApplet) return;
        // 已有一个可用的 applet 注入在本容器时不再重复注入
        if (containerRef.current.dataset.loaded === 'true') return;
        const rect = containerRef.current.getBoundingClientRect();
        const params = {
          id: 'ggbApplet',
          appName: 'geometry',
          width: Math.max(320, Math.floor(rect.width)),
          height: Math.max(320, Math.floor(rect.height)),
          showToolBar: true,
          showAlgebraInput: true,
          showMenuBar: false,
          enableLabelDrags: true,
          enableShiftDragZoom: true,
          useBrowserForJS: false,
          appletOnLoad: () => {
            setReady(true);
            setStatus({ text: 'GeoGebra 已就绪', color: '#333333' });
            setLog('GeoGebra 加载完成，可以执行指令。');
            // 只读兜底：任何新增对象（指令/工具栏）立即删除
            try {
              window.ggbApplet.registerAddListener((name) => {
                if (!editableRef.current && !loadingRef.current) {
                  try { window.ggbApplet.deleteObject(name); } catch { /* 画布重建中忽略 */ }
                }
              });
            } catch { /* 老版本 API 没有 registerAddListener 时忽略 */ }
          },
        };
        const applet = new window.GGBApplet(params, true);
        useLocalGgbCodebase(applet);
        applet.inject(containerRef.current.id);
        containerRef.current.dataset.loaded = 'true';
      })
      .catch(() => {
        if (cancelled) return;
        setStatus({ text: 'GeoGebra 加载失败', color: '#555555' });
        setLog('GeoGebra 脚本加载失败，请检查网络。');
      });
    return () => {
      cancelled = true;
    };
  }, [setStatus, setLog]);

  useEffect(() => {
    if (!ready || !window.ggbApplet || !containerRef.current) return;

    const applet = window.ggbApplet;
    const wrapper = containerRef.current.parentElement; // .geo-viewer-body

   const doResize = () => {
     requestAnimationFrame(() => {
        if (!window.ggbApplet) return;
        if (!wrapper || !containerRef.current) return;
        const xmin = window.ggbApplet.getXmin?.();
        const xmax = window.ggbApplet.getXmax?.();
        const ymin = window.ggbApplet.getYmin?.();
        const ymax = window.ggbApplet.getYmax?.();
        const style = getComputedStyle(wrapper);
        const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const rect = wrapper.getBoundingClientRect();
        const w = Math.max(320, Math.floor(rect.width - padX));
        const h = Math.max(320, Math.floor(rect.height - padY));
        // GeoGebra 注入时会给 #ggb-element 写死内联尺寸，setSize 只改内部帧、
        // 不同步外层容器（overflow:hidden 会把放大后的画布裁掉），这里手动同步
        if (containerRef.current) {
          containerRef.current.style.width = `${w}px`;
          containerRef.current.style.height = `${h}px`;
        }
        window.ggbApplet.setSize(w, h);
        if (xmin != null && xmax != null && ymin != null && ymax != null) {
          window.ggbApplet.setCoordSystem(xmin, xmax, ymin, ymax);
        }
      });
    };

    doResize();
    // 最大化/最小化后 layout 可能延迟，多补几次
    const scheduleResizes = () => [100, 300, 600].map(ms => setTimeout(doResize, ms));
    let timers = [];

    let ro = null;
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(() => doResize());
      ro.observe(wrapper);
    }
    const onWindowResize = () => {
      doResize();
      timers.forEach(clearTimeout);
      timers = scheduleResizes();
    };
    window.addEventListener('resize', onWindowResize);
    const onViewportResize = () => {
      doResize();
      timers.forEach(clearTimeout);
      timers = scheduleResizes();
    };
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onViewportResize);
    }
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', onWindowResize);
      timers.forEach(clearTimeout);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', onViewportResize);
      }
    };
  }, [ready]);

  useEffect(() => {
    if (!ready || !window.ggbApplet) return;
    loadingRef.current = true;
    const currentId = activeProblem?.id || null;
    const currentGgbState = activeProblem?.ggbState || '';

    window.ggbApplet.reset();
    window.ggbApplet.setAxesVisible(true, true);
    window.ggbApplet.setGridVisible(true);

    if (currentId && currentId !== prevIdRef.current && currentGgbState.trim()) {
      try {
        window.ggbApplet.setXML(currentGgbState);
        setLog('已恢复上次手动调整的图形');
        setDrawnProblemId(currentId);
        lastXmlRef.current = window.ggbApplet.getXML();
      } catch (e) {
        setLog('恢复图形失败：' + e.message);
      }
    } else {
      const lines = commands
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('//'));

      if (lines.length === 0) {
        setLog('画布已清空');
      } else {
        const failed = runCommands(window.ggbApplet, commands);
        if (failed.length) {
          setLog(`以下 ${failed.length} 条指令未成功执行：\n${failed.join('\n')}`);
        } else {
          setLog('指令执行成功。');
        }
      }
      setDrawnProblemId(currentId);
      try {
        lastXmlRef.current = window.ggbApplet.getXML();
      } catch {
        lastXmlRef.current = '';
      }
    }

   prevIdRef.current = currentId;
    // 通过 ref 读取当前编辑态，避免 editable 变化触发整题重建（拿到编辑锁不应重置画布）
    prevEditableRef.current = editableRef.current;
    // 加载完成后放开只读回滚（setXML 期间画布 XML 的短暂变化不应被回滚）
    setTimeout(() => { loadingRef.current = false; }, 300);
  }, [commands, ready, setLog, activeProblem?.id, updateProblem]);

  return (
    <div className="geo-viewer card">
      <div className="geo-viewer-head">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-bold text-ink truncate">{name || '未命名题目'}</span>
          {activeProblem && (
            editable
              ? <span className="edit-badge editing" title="你正在编辑此题，改动需点「保存」落库">编辑中</span>
              : <span className="edit-badge readonly" title="只读查看：点击题目旁的「编辑」按钮后可修改">只读</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCommands(v => !v)} title="查看当前建图语句">
            {showCommands ? '收起指令' : '查看指令'}
          </button>
          <button onClick={() => { window.location.hash = '#/versions'; }} title="管理该题目保存过的图形版本">
            版本管理
          </button>
          <button onClick={saveNow} disabled={!editable} title={editable ? '把当前画布内容保存为最新数据' : '只读状态，进入编辑后可保存'}>
            保存
          </button>
          <button onClick={saveCurrentVersion} disabled={!editable} title={editable ? '把当前画布内容保存为一个版本' : '只读状态，进入编辑后可存档'}>
            存档
          </button>
        </div>
      </div>
      {showCommands && (
        <div className="commands-viewer">
          <div className="commands-viewer-head">
            <span className="text-sm text-muted">当前建图语句（{currentCommands ? currentCommands.split('\n').length : 0} 条，随画布实时刷新）</span>
            <div className="flex items-center gap-2">
              <button
                className={showAttrs ? 'primary' : ''}
                onClick={() => setShowAttrs((v) => !v)}
                title="切换属性信息显示"
              >
                属性
              </button>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(currentCommands).then(
                    () => setLog('已复制建图语句到剪贴板。'),
                    () => setLog('复制失败。')
                  );
                }}
              >
                复制
              </button>
            </div>
          </div>
          <pre className="commands-viewer-body">{currentCommands || '（画布为空）'}</pre>
          {showAttrs && currentAttrs && (
            <>
              <div className="commands-viewer-head">
                <span className="text-sm text-muted">属性信息</span>
              </div>
              <pre className="commands-viewer-body">{currentAttrs}</pre>
            </>
          )}
        </div>
      )}
      <div className="geo-viewer-body">
        <div
          ref={containerRef}
          id="ggb-element"
          className="geo-applet"
        />
        {!ready && (
          <div className="geo-loading">
            <div className="text-center text-muted">
              <p>正在加载 GeoGebra Geometry</p>
              <p className="text-sm opacity-70">首次打开需要加载本地 GeoGebra 运行库</p>
            </div>
          </div>
        )}
      </div>
      {toast && <div className="geo-toast">{toast}</div>}
    </div>
  );
}
