// Helpers for extracting and manipulating the GeoGebra applet state.

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
          const ok = applet.evalCommand(op.cmd);
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
