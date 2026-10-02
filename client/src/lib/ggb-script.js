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
      el.src = '/ggb/deployggb.js';
      el.async = true;
      el.onload = resolve;
      el.onerror = reject;
      document.head.appendChild(el);
    });
  }
  return window.__ggbScriptPromise;
}

// 把 applet 的运行时代码指向本地镜像（client/public/ggb/web3d/），
// 不再依赖 geogebra.org 的嵌入服务。需在 inject() 之前调用。
export function useLocalGgbCodebase(applet) {
  if (applet && typeof applet.setHTML5Codebase === 'function') {
    applet.setHTML5Codebase('/ggb/web3d/');
  }
  return applet;
}
