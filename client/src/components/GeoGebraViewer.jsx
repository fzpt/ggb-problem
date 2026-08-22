import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';

export default function GeoGebraViewer() {
const containerRef = useRef(null);
const [ready, setReady] = useState(false);
 const { activeProblem, updateProblem, setStatus, setLog, setDrawnProblemId } = useApp();
  const prevIdRef = useRef(null);

  const commands = activeProblem?.commands || '';

 useEffect(() => {
   if (window.__ggbScriptLoaded || window.ggbApplet) return;
   window.__ggbScriptLoaded = true;

    const script = document.createElement('script');
    script.src = 'https://www.geogebra.org/apps/deployggb.js';
    script.async = true;
    script.onload = () => {
      if (!containerRef.current || !window.GGBApplet) return;
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
        },
      };
      const applet = new window.GGBApplet(params, true);
      applet.inject(containerRef.current.id);
      containerRef.current.dataset.loaded = 'true';
    };
    script.onerror = () => {
      setStatus({ text: 'GeoGebra 加载失败', color: '#555555' });
      setLog('GeoGebra 脚本加载失败，请检查网络。');
    };
    document.head.appendChild(script);
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
    const currentId = activeProblem?.id || null;
    const currentGgbState = activeProblem?.ggbState || '';

    // 切换题目时，先保存当前图的状态到上一个题目
    if (prevIdRef.current && prevIdRef.current !== currentId) {
      try {
        const xml = window.ggbApplet.getXML();
        if (xml) {
          updateProblem(prevIdRef.current, { ggbState: xml });
        }
      } catch (e) {
        console.error('save ggb state on switch failed', e);
      }
    }

    window.ggbApplet.reset();
    window.ggbApplet.setAxesVisible(true, true);
    window.ggbApplet.setGridVisible(true);

    if (currentId && currentId !== prevIdRef.current && currentGgbState.trim()) {
      try {
        window.ggbApplet.setXML(currentGgbState);
        setLog('已恢复上次手动调整的图形');
        setDrawnProblemId(currentId);
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
        const failed = [];
        lines.forEach((cmd) => {
          try {
            const ok = window.ggbApplet.evalCommand(cmd);
            if (!ok) failed.push(cmd);
          } catch {
            failed.push(cmd);
          }
        });
        if (failed.length) {
          setLog(`以下 ${failed.length} 条指令未成功执行：\n${failed.join('\n')}`);
        } else {
          setLog('指令执行成功。');
        }
      }
      setDrawnProblemId(currentId);
    }

   prevIdRef.current = currentId;
  }, [commands, ready, setLog, activeProblem?.id, updateProblem]);

  // 每 3 秒自动保存一次当前 GeoGebra 状态
  useEffect(() => {
    if (!ready || !window.ggbApplet || !activeProblem) return;
    const id = setInterval(() => {
      try {
        const xml = window.ggbApplet.getXML();
        if (xml && xml !== activeProblem.ggbState) {
          updateProblem(activeProblem.id, { ggbState: xml });
        }
      } catch (e) {
        console.error('auto save ggb state failed', e);
      }
    }, 3000);
    return () => clearInterval(id);
  }, [ready, activeProblem?.id]);

  return (
    <div className="geo-viewer card">
      <div className="geo-viewer-head">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full border border-black/10 bg-[#e5e5e5] shadow-inner" />
          <span className="text-sm font-bold tracking-widest text-ink uppercase">Geometry View</span>
        </div>
        <button
          onClick={() => window.ggbApplet?.setCoordSystem(-6, 8, -4, 6)}
          className="px-3 py-1.5 text-sm border border-black/15 rounded-full hover:bg-white/60 transition"
        >
          重置视图
        </button>
      </div>
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
              <p className="text-sm opacity-70">首次打开需要从 geogebra.org 加载嵌入脚本</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
