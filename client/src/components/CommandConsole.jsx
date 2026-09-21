import { useEffect, useRef, useState } from 'react';
import { loadGgbScript } from '../lib/ggb-script';

const LS_KEY = 'ggb-console-script';

// GeoGebra 会把拼写的希腊字母名（如 beta）转成符号（β）作为对象名，
// 但 evalCommand 不会把 beta 解析回 β，这里统一转换，避免"未定义变量"
const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω',
};
const GREEK_RE = new RegExp(`\\b(${Object.keys(GREEK).join('|')})\\b`, 'g');

function normalizeLine(line) {
  return line.replace(GREEK_RE, (m) => GREEK[m]);
}

export default function CommandConsole() {
  const stageRef = useRef(null);
  const apiRef = useRef(null);
  const emptyXmlRef = useRef('');
  const [ready, setReady] = useState(false);
  const [script, setScript] = useState(() => localStorage.getItem(LS_KEY) || '');
  const [status, setStatus] = useState('GeoGebra 加载中…');
  const [output, setOutput] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadGgbScript()
      .then(() => {
        if (cancelled || !stageRef.current || !window.GGBApplet) return;
        const rect = stageRef.current.getBoundingClientRect();
        const params = {
          id: 'ggbConsoleApplet',
          appName: 'geometry',
          width: Math.max(320, Math.floor(rect.width)),
          height: Math.max(320, Math.floor(rect.height)),
          showToolBar: true,
          showAlgebraInput: true,
          showMenuBar: false,
          enableLabelDrags: true,
          enableShiftDragZoom: true,
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
        applet.inject(stageRef.current.id);
      })
      .catch(() => setStatus('GeoGebra 脚本加载失败，请检查网络'));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const doResize = () => {
      requestAnimationFrame(() => {
        const api = apiRef.current;
        const stage = stageRef.current;
        if (!api || !stage) return;
        const xmin = api.getXmin?.();
        const xmax = api.getXmax?.();
        const ymin = api.getYmin?.();
        const ymax = api.getYmax?.();
        const rect = stage.getBoundingClientRect();
        const w = Math.max(320, Math.floor(rect.width));
        const h = Math.max(320, Math.floor(rect.height));
        api.setSize(w, h);
        if (xmin != null && xmax != null && ymin != null && ymax != null) {
          api.setCoordSystem(xmin, xmax, ymin, ymax);
        }
      });
    };
    doResize();
    const timers = [100, 300, 600].map((ms) => setTimeout(doResize, ms));
    let ro = null;
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(doResize);
      ro.observe(stageRef.current);
    }
    const onResize = () => {
      doResize();
      timers.forEach(clearTimeout);
      [100, 300, 600].forEach((ms) => setTimeout(doResize, ms));
    };
    window.addEventListener('resize', onResize);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', onResize);
      timers.forEach(clearTimeout);
    };
  }, [ready]);

  const run = () => {
    const api = apiRef.current;
    if (!api) {
      setOutput('GeoGebra 尚未就绪，请稍候。');
      return;
    }
    localStorage.setItem(LS_KEY, script);
    const lines = script.split(/\r?\n/);
    const failures = [];
    let ok = 0;
    lines.forEach((raw, i) => {
      // GeoGebra 中分号用于参数式输入（如 (1+t; 2)），行尾分号会导致变量未定义
      const line = raw.trim().replace(/;+\s*$/, '');
      if (!line || line.startsWith('//') || line.startsWith('#')) return;
      try {
        if (api.evalCommand(normalizeLine(line))) {
          ok += 1;
        } else {
          failures.push(`第 ${i + 1} 行执行失败: ${line}`);
        }
      } catch (e) {
        failures.push(`第 ${i + 1} 行异常: ${line} (${e.message})`);
      }
    });
    setOutput(
      failures.length
        ? `成功 ${ok} 条，失败 ${failures.length} 条\n${failures.join('\n')}`
        : `执行完成，共执行 ${ok} 条指令。`
    );
  };

  const resetCanvas = () => {
    const api = apiRef.current;
    if (!api || !emptyXmlRef.current) return;
    api.setXML(emptyXmlRef.current);
    setOutput('画布已清空。');
  };

  return (
    <div className="console-shell">
      <div className="console-toolbar">
        <a className="console-back text-muted" href="#/">&larr; 返回首页</a>
        <span className="text-muted">{status}</span>
      </div>
      <div className="console-body">
        <div className="console-editor">
          <textarea
            className="console-textarea"
            placeholder={'每行一条 GeoGebra Geometry 指令，例如：\nA = (0, 0)\nB = (4, 0)\nC = (1, 3)\nPolygon(A, B, C)'}
            value={script}
            onChange={(e) => setScript(e.target.value)}
            spellCheck={false}
          />
          <div className="console-actions">
            <button className="button primary" onClick={run} disabled={!ready}>
              执行
            </button>
            <button className="button" onClick={resetCanvas} disabled={!ready}>
              清空画布
            </button>
          </div>
          <pre className="console-output">{output}</pre>
        </div>
        <div className="console-stage" id="ggb-console-stage" ref={stageRef} />
      </div>
    </div>
  );
}
