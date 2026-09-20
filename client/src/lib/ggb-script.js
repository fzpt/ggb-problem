// 加载 GeoGebra deployggb.js，避免多个组件重复注入
export function loadGgbScript() {
  if (window.GGBApplet) return Promise.resolve();
  if (!window.__ggbScriptPromise) {
    window.__ggbScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="deployggb.js"]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const el = document.createElement('script');
      el.src = 'https://www.geogebra.org/apps/deployggb.js';
      el.async = true;
      el.onload = resolve;
      el.onerror = reject;
      document.head.appendChild(el);
    });
  }
  return window.__ggbScriptPromise;
}
