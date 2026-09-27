import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { loadGgbScript } from '../lib/ggb-script';
import { listProblemVersions, getProblemVersion, saveProblemVersion, deleteProblemVersion } from '../services/api';

const formatTime = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// 对画布上全部对象设置/解除固定。固定后无法拖动，用于只读预览。
function applyFixed(api, fixed) {
  if (!api || typeof api.getAllObjectNames !== 'function') return;
  try {
    api.getAllObjectNames().forEach((n) => {
      try {
        api.setFixed(n, fixed);
      } catch {
        // 个别对象不支持固定，忽略
      }
    });
  } catch {
    // ignore
  }
}

export default function VersionManager() {
  const containerRef = useRef(null);
  const apiRef = useRef(null);
  const emptyXmlRef = useRef('');
  const didInitRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('GeoGebra 加载中…');
  const [versions, setVersions] = useState([]);
  // 'current' 表示当前最新版（ggbState），其余为版本快照 id
  const [selectedKey, setSelectedKey] = useState('current');
  const [manageMode, setManageMode] = useState(false);
  const { activeProblem, updateProblem, setLog } = useApp();

  useEffect(() => {
    let cancelled = false;
    loadGgbScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.GGBApplet) return;
        if (containerRef.current.dataset.loaded === 'true') return;
        const rect = containerRef.current.getBoundingClientRect();
        const params = {
          id: 'ggbVersionApplet',
          appName: 'geometry',
          width: Math.max(320, Math.floor(rect.width)),
          height: Math.max(320, Math.floor(rect.height)),
          showToolBar: false,
          showAlgebraInput: false,
          showMenuBar: false,
          enableLabelDrags: false,
          enableShiftDragZoom: false,
          useBrowserForJS: false,
          appletOnLoad: (api) => {
            apiRef.current = api;
            try {
              emptyXmlRef.current = api.getXML();
            } catch {
              emptyXmlRef.current = '';
            }
            setReady(true);
            setStatus('GeoGebra 已就绪');
          },
        };
        const applet = new window.GGBApplet(params, true);
        applet.inject(containerRef.current.id);
        containerRef.current.dataset.loaded = 'true';
      })
      .catch(() => setStatus('GeoGebra 脚本加载失败，请检查网络'));
    return () => {
      cancelled = true;
    };
  }, []);

  // 窗口尺寸变化时同步画布大小
  useEffect(() => {
    if (!ready) return undefined;
    const doResize = () => {
      requestAnimationFrame(() => {
        const api = apiRef.current;
        const stage = containerRef.current;
        if (!api || !stage) return;
        const xmin = api.getXmin?.();
        const xmax = api.getXmax?.();
        const ymin = api.getYmin?.();
        const ymax = api.getYmax?.();
        // GeoGebra 注入时会给容器写死内联尺寸，getBoundingClientRect 会拿到
        // 过期的内联值；先清空内联样式让 CSS flex 布局生效，再测量、再写回
        stage.style.width = '';
        stage.style.height = '';
        const rect = stage.getBoundingClientRect();
        const w = Math.max(320, Math.floor(rect.width));
        const h = Math.max(320, Math.floor(rect.height));
        stage.style.width = `${w}px`;
        stage.style.height = `${h}px`;
        api.setSize(w, h);
        if (xmin != null && xmax != null && ymin != null && ymax != null) {
          api.setCoordSystem(xmin, xmax, ymin, ymax);
        }
      });
    };
    doResize();
    const timers = [100, 300, 600].map((ms) => setTimeout(doResize, ms));
    window.addEventListener('resize', doResize);
    return () => {
      window.removeEventListener('resize', doResize);
      timers.forEach(clearTimeout);
    };
  }, [ready]);

  const refreshVersions = async () => {
    const id = activeProblem?.id;
    if (!id) {
      setVersions([]);
      return;
    }
    try {
      const data = await listProblemVersions(id);
      setVersions(data.versions || []);
    } catch {
      setVersions([]);
    }
  };

  // 加载当前题目的版本列表
  useEffect(() => {
    refreshVersions();
    setSelectedKey('current');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProblem?.id]);

  const loadXmlIntoCanvas = (xml) => {
    const api = apiRef.current;
    if (!api) return;
    try {
      api.setXML(xml && xml.trim() ? xml : emptyXmlRef.current || '<geogebra format="5.0"></geogebra>');
    } catch {
      setStatus('载入图形失败');
    }
  };

  // 选中"当前版"：加载题目的最新图形（ggbState）
  const selectCurrent = () => {
    setSelectedKey('current');
    loadXmlIntoCanvas(activeProblem?.ggbState || '');
  };

  const selectVersion = async (v) => {
    setSelectedKey(v.id);
    const api = apiRef.current;
    if (!api || !activeProblem) return;
    try {
      const data = await getProblemVersion(activeProblem.id, v.id);
      loadXmlIntoCanvas(data.ggbState);
    } catch {
      setStatus('载入版本失败');
    }
  };

  // 首次就绪后默认展示当前版
  useEffect(() => {
    if (ready && activeProblem && !didInitRef.current) {
      didInitRef.current = true;
      selectCurrent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, activeProblem?.id]);

  // 管理模式切换：关闭=全部固定（只读），开启=可拖动但不保存
  useEffect(() => {
    if (ready && selectedKey) applyFixed(apiRef.current, !manageMode);
  }, [manageMode, ready, selectedKey]);

  // 把"当前版"（最新图形）保存为一个版本快照
  const saveCurrent = async () => {
    if (!activeProblem) return;
    const xml = activeProblem.ggbState || '';
    if (!xml.trim()) {
      window.alert('当前还没有可保存的图形。');
      return;
    }
    try {
      let res = await saveProblemVersion(activeProblem.id, xml, false);
      if (res.limited) {
        const ok = window.confirm(
          `该题目已有 ${res.count} 个版本（最多保留 ${res.limit} 个）。继续保存将删除最旧的版本，是否继续？`
        );
        if (!ok) return;
        res = await saveProblemVersion(activeProblem.id, xml, true);
      }
      setStatus(`已保存当前版（${formatTime(res.created_at)}）。`);
      refreshVersions();
    } catch (e) {
      window.alert('保存失败：' + (e.message || '未知错误'));
    }
  };

  // 把选中的历史版本设为最新版：覆盖题目当前的最新图形，确认后返回题目页
  const makeLatest = async () => {
    if (!selectedKey || selectedKey === 'current' || !activeProblem) return;
    const ok = window.confirm(
      '将该版本设为最新版？当前画板的最新图形将被此版本直接覆盖，且不可恢复。是否继续？'
    );
    if (!ok) return;
    try {
      const data = await getProblemVersion(activeProblem.id, selectedKey);
      updateProblem(activeProblem.id, { ggbState: data.ggbState });
      setLog(`已将 ${formatTime(data.created_at)} 保存的版本设为最新版。`);
      window.location.hash = '#/app';
    } catch (e) {
      window.alert('设为最新版失败：' + (e.message || '未知错误'));
    }
  };

  // 删除一个历史版本快照
  const removeVersion = async (v) => {
    if (!activeProblem) return;
    const ok = window.confirm(`确定删除“版本”快照（${formatTime(v.created_at)}）吗？删除后不可恢复。`);
    if (!ok) return;
    try {
      await deleteProblemVersion(activeProblem.id, v.id);
      if (selectedKey === v.id) {
        selectCurrent();
      }
      refreshVersions();
    } catch (e) {
      window.alert('删除失败：' + (e.message || '未知错误'));
    }
  };

  if (!activeProblem) {
    return (
      <div className="vm-shell">
        <div className="vm-toolbar">
          <a className="text-muted" href="#/app">&larr; 返回</a>
          <span className="font-bold">版本管理</span>
        </div>
        <div className="vm-empty">请先在题目页选择一道题目。</div>
      </div>
    );
  }

  return (
    <div className="vm-shell">
      <div className="vm-toolbar">
        <a className="text-muted" href="#/app">&larr; 返回</a>
        <span className="font-bold truncate">{activeProblem.name || '未命名题目'} · 版本管理</span>
        <span className="text-muted">{status}</span>
      </div>
      <div className="vm-body">
        <aside className="vm-list">
          <button
            className="primary"
            disabled={!selectedKey || selectedKey === 'current'}
            onClick={makeLatest}
            title="把选中的历史版本覆盖为最新图形并返回题目页"
          >
            设为最新版
          </button>

          {/* 当前最新版条目 */}
          <div
            className={`vm-item vm-current ${selectedKey === 'current' ? 'active' : ''}`}
            onClick={selectCurrent}
          >
            <div className="vm-item-main">
              <span className="vm-item-label">当前版</span>
              <span className="vm-item-time">{formatTime(activeProblem.updated_at || Date.now())}</span>
            </div>
            <button
              className="vm-save-btn"
              onClick={(e) => {
                e.stopPropagation();
                saveCurrent();
              }}
              title="把当前最新图形保存为一个版本快照"
            >
              保存
            </button>
          </div>

          {versions.map((v, i) => (
            <div
              key={v.id}
              className={`vm-item vm-version ${selectedKey === v.id ? 'active' : ''}`}
              onClick={() => selectVersion(v)}
            >
              <div className="vm-item-main">
                <span className="vm-item-label">版本 {versions.length - i}</span>
                <span className="vm-item-time">{formatTime(v.created_at)}</span>
              </div>
              <button
                className="vm-save-btn vm-delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  removeVersion(v);
                }}
                title="删除该版本快照"
              >
                删除
              </button>
            </div>
          ))}
          {versions.length === 0 && <div className="text-muted vm-list-empty">暂无历史版本</div>}
        </aside>
        <div className="vm-stage">
          <div className="vm-stage-bar">
            <label className="vm-mode" title="开启后可以拖动图形查看，修改不会保存">
              <input
                type="checkbox"
                checked={manageMode}
                onChange={(e) => setManageMode(e.target.checked)}
              />
              管理模式
            </label>
          </div>
          <div className="vm-applet" id="ggb-version-stage" ref={containerRef} />
        </div>
      </div>
    </div>
  );
}
