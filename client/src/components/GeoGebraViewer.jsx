import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';

export default function GeoGebraViewer() {
  const containerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const { activeProblem, setStatus, setLog } = useApp();

  const commands = activeProblem?.commands || '';

  useEffect(() => {
    if (window.ggbApplet || document.getElementById('ggb-element')?.dataset.loaded) return;

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
    const resize = () => {
      const rect = containerRef.current.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(320, Math.floor(rect.height));
      applet.setSize(w, h);
    };

    resize();
    let observer;
    if ('ResizeObserver' in window) {
      observer = new ResizeObserver(() => resize());
      observer.observe(containerRef.current);
    } else {
      window.addEventListener('resize', resize);
    }
    return () => {
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', resize);
    };
  }, [ready]);

  useEffect(() => {
    if (!ready || !window.ggbApplet) return;
    const lines = commands
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('//'));
    if (lines.length === 0) return;

    window.ggbApplet.reset();
    window.ggbApplet.setAxesVisible(true, true);
    window.ggbApplet.setGridVisible(true);
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
  }, [commands, ready, setLog]);

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
