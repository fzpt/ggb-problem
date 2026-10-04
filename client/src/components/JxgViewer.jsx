import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { saveProblemVersion } from '../services/api';

function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

const formatTime = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// 步骤集合签名： id+type+visible 的集合相同 → 纯拖动/移动（静默保存，不刷新修改时间）
function stepsSignature(steps) {
  return (steps || [])
    .map((s) => `${s.id}:${s.type}:${s.visible === false ? 'h' : 'v'}`)
    .sort()
    .join('|');
}

// JSXGraph 引擎查看器：iframe 嵌入本地 /jxg/index.html，经 postMessage 桥交互。
//  外壳→iframe：jxg:init / jxg:apply-steps / jxg:set-readonly
//  iframe→外壳：jxg:ready / jxg:steps-changed（防抖） / jxg:status
export default function JxgViewer() {
  const iframeRef = useRef(null);
  const fileInputRef = useRef(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const { activeProblem, updateProblem, setLog, editingIds, setDrawnProblemId } = useApp();
  // 最近一次从 iframe 上报/下发的步骤：用于区分"画板自身变更"与"AI 调整等外部变更"
  const lastIframeStepsRef = useRef(null);
  // init 握手守卫：同一道题只下发一次 jxg:init（iframe 的 ready 重试会多次到达）
  const initedForRef = useRef(null);
  const editableRef = useRef(false);
  const activeProblemRef = useRef(activeProblem);

  const { name, jxgSteps } = activeProblem || {};
  const editable = activeProblem?.id != null && editingIds.includes(activeProblem.id);
  editableRef.current = editable;
  // 切题时重置 init 守卫（iframe 不重载，靠新的 init 注入新题步骤）
  useEffect(() => { initedForRef.current = null; }, [activeProblem?.id]);

  const showToast = (msg) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  };

  const sendToIframe = (msg) => {
    try { iframeRef.current?.contentWindow?.postMessage(msg, '*'); } catch { /* iframe 未就绪 */ }
  };

  const sendInit = (steps, readOnly) => {
    sendToIframe({ type: 'jxg:init', steps: steps || [], readOnly: !!readOnly });
  };

  // postMessage 桥：收 iframe 消息
  useEffect(() => {
    const onMessage = (ev) => {
      const d = ev.data || {};
      if (typeof d.type !== 'string' || d.type.indexOf('jxg:') !== 0) return;
      const prob = activeProblemRef.current;
      if (d.type === 'jxg:ready') {
        setIframeReady(true);
        if (prob && initedForRef.current !== prob.id) {
          initedForRef.current = prob.id;
          sendInit(prob.jxgSteps || [], !editableRef.current);
        }
      } else if (d.type === 'jxg:steps-changed') {
        if (!prob) return;
        // 只缓存画板最新步骤用于手动保存/回环判断，不再自动落库；保存走「保存」按钮。
        lastIframeStepsRef.current = Array.isArray(d.steps) ? d.steps : [];
      } else if (d.type === 'jxg:status') {
        if (d.level === 'error') setLog(d.message || '画板渲染失败');
      } else if (d.type === 'jxg:ggb-export') {
        if (d.error) {
          setLog('导出 GGB 失败：' + d.error);
        } else if (d.base64) {
          const blob = base64ToBlob(d.base64, 'application/vnd.geogebra.file');
          const suggested = `${(activeProblemRef.current?.name || '图形').replace(/[\\/:*?"<>|]/g, '_')}.ggb`;
          const fallbackDownload = () => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = suggested;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
          };
          // 支持 File System Access API 的浏览器弹出"另存为"对话框，用户可选目录；
          // 不支持或用户取消时回退为普通下载
          if (window.showSaveFilePicker) {
            (async () => {
              try {
                const handle = await window.showSaveFilePicker({
                  suggestedName: suggested,
                  types: [{ description: 'GeoGebra 文件', accept: { 'application/vnd.geogebra.file': ['.ggb'] } }],
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
              } catch (err) {
                if (err && err.name === 'AbortError') { setLog('已取消导出。'); return; }
                fallbackDownload();
              }
            })();
          } else {
            fallbackDownload();
          }
          if (d.warnings?.length) setLog('GGB 已导出，注意：' + d.warnings.join('；'));
          else setLog('GGB 已导出。');
        }
      } else if (d.type === 'jxg:ggb-import') {
        if (d.error) {
          setLog('导入 GGB 失败：' + d.error);
        } else if (d.ok) {
          // iframe 已渲染成功，直接落库为最新数据（导入是显式操作）
          const prob = activeProblemRef.current;
          if (prob) updateProblem(prob.id, { jxgSteps: d.steps });
          showToast(`已导入 ${d.steps.length} 个图形对象${d.warnings?.length ? `（${d.warnings.length} 条提示）` : ''}`);
          if (d.warnings?.length) setLog('GGB 导入提示：' + d.warnings.join('；'));
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setLog, updateProblem]);

  // activeProblem 的 ref 版，避免 message effect 频繁重建
  activeProblemRef.current = activeProblem;

  // 切题 / 外部变更（AI 调整、版本回写）时把步骤下发 iframe
  useEffect(() => {
    if (!iframeReady || !activeProblem) return;
    const steps = activeProblem.jxgSteps || [];
    // 画板自己刚上报过同样的步骤，不重复下发（避免抖动/回环）
    if (lastIframeStepsRef.current && stepsSignature(lastIframeStepsRef.current) === stepsSignature(steps)) {
      return;
    }
    lastIframeStepsRef.current = steps;
    sendToIframe({ type: 'jxg:apply-steps', steps });
    setDrawnProblemId(activeProblem.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeReady, activeProblem?.id, activeProblem?.jxgSteps]);

  // 编辑态变化 → 只读开关下发
  useEffect(() => {
    if (!iframeReady) return;
    sendToIframe({ type: 'jxg:set-readonly', readOnly: !editable });
  }, [iframeReady, editable]);

  // 存档：把当前步骤包成信封存版本快照（与 ggbState 同表，自由文本）
  const saveCurrentVersion = async () => {
    if (!activeProblem) return;
    const envelope = JSON.stringify({ engine: 'jxg', steps: activeProblem.jxgSteps || [] });
    try {
      let res = await saveProblemVersion(activeProblem.id, envelope, false);
      if (res.limited) {
        const ok = window.confirm(
          `该题目已有 ${res.count} 个版本（最多保留 ${res.limit} 个）。继续保存将删除最旧的版本，是否继续？`
        );
        if (!ok) {
          setLog('已取消保存版本。');
          return;
        }
        res = await saveProblemVersion(activeProblem.id, envelope, true);
      }
      showToast(`已保存当前版本（${formatTime(res.created_at)}）`);
    } catch (e) {
      showToast('保存版本失败：' + e.message);
    }
  };

  // 保存当前画板内容为最新数据（手动落库，不生成版本）
  const saveNow = () => {
    if (!activeProblem || !editable) return;
    const steps = lastIframeStepsRef.current || activeProblem.jxgSteps || [];
    updateProblem(activeProblem.id, { jxgSteps: steps });
    showToast('已保存当前图形。');
  };

  // GGB 导入/导出：压缩解压都在 iframe 内完成（JSZip 已随画板页本地加载）
  const exportGgb = () => {
    if (!iframeReady) return;
    setLog('正在导出 GGB…');
    sendToIframe({ type: 'jxg:export-ggb' });
  };
  const onGgbFilePicked = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !activeProblem) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      setLog('正在导入 GGB…');
      sendToIframe({ type: 'jxg:import-ggb', base64 });
    };
    reader.onerror = () => setLog('读取文件失败。');
    reader.readAsDataURL(file);
  };

  const prettySteps = JSON.stringify(lastIframeStepsRef.current || activeProblem?.jxgSteps || [], null, 2);

  return (
    <div className="geo-viewer card">
      <div className="geo-viewer-head">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-bold text-ink truncate">{name || '未命名题目'}</span>
          <span className="edit-badge engine" title="该题使用 JSXGraph 引擎">JSXGraph</span>
          {activeProblem && (
            editable
              ? <span className="edit-badge editing" title="你正在编辑此题，改动需点「保存」落库">编辑中</span>
              : <span className="edit-badge readonly" title="只读查看：点击题目旁的「编辑」按钮后可修改">只读</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCommands(v => !v)} title="查看当前建图步骤 JSON">
            {showCommands ? '收起指令' : '查看指令'}
          </button>
          <button onClick={() => { window.location.hash = '#/versions'; }} title="管理该题目保存过的图形版本">
            版本管理
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={!editable} title={editable ? '导入 GeoGebra .ggb 文件替换当前图形' : '只读状态，进入编辑后可导入'}>
            导入 GGB
          </button>
          <button onClick={exportGgb} title="把当前图形导出为 GeoGebra .ggb 文件">
            导出 GGB
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ggb,application/vnd.geogebra.file"
            style={{ display: 'none' }}
            onChange={onGgbFilePicked}
          />
          <button onClick={saveNow} disabled={!editable} title={editable ? '把当前画板内容保存为最新数据' : '只读状态，进入编辑后可保存'}>
            保存
          </button>
          <button onClick={saveCurrentVersion} disabled={!editable} title={editable ? '把当前画板内容保存为一个版本' : '只读状态，进入编辑后可存档'}>
            存档
          </button>
        </div>
      </div>
      {showCommands && (
        <div className="commands-viewer">
          <div className="commands-viewer-head">
            <span className="text-sm text-muted">当前建图步骤（{(activeProblem?.jxgSteps || []).length} 步，JSON）</span>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(prettySteps).then(
                  () => setLog('已复制建图步骤到剪贴板。'),
                  () => setLog('复制失败。')
                );
              }}
            >
              复制
            </button>
          </div>
          <pre className="commands-viewer-body">{prettySteps || '（画布为空）'}</pre>
        </div>
      )}
      <div className="geo-viewer-body">
        <iframe
          ref={iframeRef}
          src="/jxg/index.html"
          title="JSXGraph 画板"
          className="jxg-frame"
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        />
      </div>
      {toast && <div className="geo-toast">{toast}</div>}
    </div>
  );
}
