// Helpers for extracting and manipulating the GeoGebra applet state.

// 每个题目"已保存图形版本"的基线 XML，用于切换题目时检测未保存的增删修改
const baselines = new Map();

export function setBaseline(id, xml) {
  if (id) baselines.set(id, xml || '');
}

export function getBaseline(id) {
  return baselines.has(id) ? baselines.get(id) : null;
}

export function clearBaseline(id) {
  baselines.delete(id);
}

// SetVisibleInView 是脚本专用命令，在 Geometry 应用里通过 evalCommand 执行会返回
// false（对象并未隐藏）。注意不能用 getXML(name)+setXML 的方式替代：单对象 XML
// 片段传给 setXML 会清空整个构图。实测可行做法：直接用 applet.setVisible()。
const SVIV_RE = /^(?:[\w\u0370-\u03ff]+\s*=\s*)?SetVisibleInView\(\s*([^,]+?)\s*,\s*\d+\s*,\s*(true|false)\s*\)$/i;

function setObjectVisible(applet, name, visible) {
  applet.setVisible(name, visible ? 1 : 0);
}

// 执行单条指令；SetVisibleInView 走 XML 拦截。返回 true 表示生效。
export function runCommandLine(applet, cmd) {
  const m = cmd.match(SVIV_RE);
  if (m) {
    setObjectVisible(applet, m[1].trim(), m[2].toLowerCase() === 'true');
    return true;
  }
  return applet.evalCommand(cmd);
}

// 逐行执行 GeoGebra 指令，返回执行失败的指令列表
export function runCommands(applet, commands) {
  const failed = [];
  const lines = (commands || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//'));
  for (const cmd of lines) {
    try {
      const ok = runCommandLine(applet, cmd);
      if (!ok) failed.push(cmd);
    } catch {
      failed.push(cmd);
    }
  }
  return failed;
}

export function getCurrentObjects() {
  const applet = window.ggbApplet;
  if (!applet) return [];

  const names = applet.getAllObjectNames ? applet.getAllObjectNames() : [];
  const objects = [];
  for (const name of names) {
    try {
      const type = applet.getObjectType ? applet.getObjectType(name) : 'unknown';
      if (!type) continue;

      const entry = { name, type };

      if (applet.getCoords) {
        const coords = applet.getCoords(name);
        if (coords) entry.coords = { x: coords[0], y: coords[1], z: coords[2] };
      }

      if (applet.getValue) {
        const value = applet.getValue(name);
        if (typeof value === 'number') entry.value = value;
      }

      if (applet.getCommandString) {
        const cmd = applet.getCommandString(name, true);
        if (cmd) entry.command = cmd;
      }

      if (applet.getVisible) {
        entry.visible = !!applet.getVisible(name);
      }

      objects.push(entry);
    } catch (e) {
      // ignore objects that cannot be introspected
    }
  }
  return objects;
}

export function applyOperations(operations = []) {
  const applet = window.ggbApplet;
  if (!applet) {
    return { applied: 0, failed: [{ reason: 'GeoGebra applet not loaded' }] };
  }

  const failed = [];
  let applied = 0;

  for (const op of operations) {
    try {
      switch (op.op) {
        case 'setCoords': {
          if (op.name == null || op.x == null || op.y == null) {
            throw new Error('setCoords requires name, x, y');
          }
          applet.setCoords(op.name, op.x, op.y);
          break;
        }
        case 'evalCommand': {
          if (!op.cmd) throw new Error('evalCommand requires cmd');
          const ok = runCommandLine(applet, op.cmd);
          if (!ok) throw new Error(`evalCommand failed: ${op.cmd}`);
          break;
        }
        case 'deleteObject': {
          if (!op.name) throw new Error('deleteObject requires name');
          applet.deleteObject(op.name);
          break;
        }
        case 'setVisible': {
          if (!op.name) throw new Error('setVisible requires name');
          applet.setVisible(op.name, op.visible ? 1 : 0);
          break;
        }
        default:
          throw new Error(`unknown operation: ${op.op}`);
      }
      applied++;
    } catch (e) {
      failed.push({ op, reason: e.message });
    }
  }

  return { applied, failed };
}
