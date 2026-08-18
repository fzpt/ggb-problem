// Convert a structured geometry description into GeoGebra Geometry commands.

function isValidNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function ensurePoints(commands, used, geometry) {
  const pointNames = new Set((geometry.points || []).map(p => p.name));
  const allRefs = [];

  (geometry.segments || []).forEach(s => { allRefs.push(s.from, s.to); });
  (geometry.lines || []).forEach(l => { if (l.points) l.points.forEach(p => allRefs.push(p)); });
  (geometry.circles || []).forEach(c => { allRefs.push(c.center, c.radiusPoint); });
  (geometry.polygons || []).forEach(p => { if (p.vertices) p.vertices.forEach(v => allRefs.push(v)); });
  (geometry.angles || []).forEach(a => {
    if (a.sides) {
      a.sides.forEach(side => {
        if (side && side.length >= 2) {
          allRefs.push(side[0], side[1], a.vertex);
        }
      });
    }
  });

  allRefs.forEach(name => {
    if (!name || pointNames.has(name)) return;
    pointNames.add(name);
    commands.push(`// 创建缺失点 ${name}`);
    commands.push(`${name} = (0, 0)`);
  });
}

function pointCommand(point) {
  if (!point.name) return null;
  if (isValidNumber(point.x) && isValidNumber(point.y)) {
    return `${point.name} = (${point.x}, ${point.y})`;
  }
  if (point.construction) {
    return `// ${point.name}: ${point.construction}`;
  }
  return `${point.name} = (0, 0)`;
}

function segmentCommand(segment) {
  if (!segment.from || !segment.to) return null;
  const name = segment.name ? `${segment.name} = ` : '';
  return `${name}Segment(${segment.from}, ${segment.to})`;
}

function lineCommand(line) {
  if (!line.points || line.points.length < 2) return null;
  const name = line.name ? `${line.name} = ` : '';
  return `${name}Line(${line.points[0]}, ${line.points[1]})`;
}

function circleCommand(circle) {
  if (!circle.center) return null;
  if (circle.radiusPoint) {
    const name = circle.name ? `${circle.name} = ` : '';
    return `${name}Circle(${circle.center}, ${circle.radiusPoint})`;
  }
  if (isValidNumber(circle.radius)) {
    const name = circle.name ? `${circle.name} = ` : '';
    return `${name}Circle(${circle.center}, ${circle.radius})`;
  }
  return null;
}

function parseSide(sideName, vertex) {
  if (!sideName || sideName.length < 2 || !vertex) return null;
  // side like "AB" means endpoints A and B. Vertex is one of them.
  if (sideName[0] === vertex) return sideName[1];
  if (sideName[1] === vertex) return sideName[0];
  // Try removing the vertex letter from longer names (less common)
  const stripped = sideName.replace(vertex, '');
  if (stripped.length === 1) return stripped;
  return null;
}

function angleCommand(angle) {
  if (!angle.vertex || !Array.isArray(angle.sides) || angle.sides.length < 2) return null;
  const p1 = parseSide(angle.sides[0], angle.vertex);
  const p2 = parseSide(angle.sides[1], angle.vertex);
  if (!p1 || !p2) return null;
  const name = angle.name ? `${angle.name} = ` : '';
  return `${name}Angle(${p1}, ${angle.vertex}, ${p2})`;
}

function polygonCommand(polygon) {
  if (!polygon.vertices || polygon.vertices.length < 3) return null;
  const name = polygon.name ? `${polygon.name} = ` : '';
  return `${name}Polygon(${polygon.vertices.join(', ')})`;
}

function constraintCommand(constraint) {
  if (!constraint || !constraint.type) return null;
  switch (constraint.type) {
    case 'perpendicular':
      return constraint.line1 && constraint.line2
        ? `// Constraint: ${constraint.line1} ⟂ ${constraint.line2}`
        : null;
    case 'parallel':
      return constraint.line1 && constraint.line2
        ? `// Constraint: ${constraint.line1} ∥ ${constraint.line2}`
        : null;
    case 'equalLength':
      return constraint.objects && constraint.objects.length >= 2
        ? `// Constraint: ${constraint.objects.join(' = ')}`
        : null;
    case 'tangent':
      return constraint.line && constraint.circle
        ? `// Constraint: ${constraint.line} tangent to ${constraint.circle}`
        : null;
    case 'collinear':
      return constraint.points && constraint.points.length >= 3
        ? `// Constraint: ${constraint.points.join(', ')} are collinear`
        : null;
    default:
      return `// Constraint: ${JSON.stringify(constraint)}`;
  }
}

function generateCommands(geometry = {}) {
  const commands = [];
  const used = new Set();

  function add(cmd) {
    if (!cmd) return;
    const key = cmd.trim();
    if (used.has(key)) return;
    used.add(key);
    commands.push(cmd);
  }

  // Emit placeholder points for any referenced names missing from the explicit points array.
  ensurePoints(commands, used, geometry);

  // 1. Explicit points.
  (geometry.points || []).forEach(point => add(pointCommand(point)));

  // 2. Lines and circles.
  (geometry.lines || []).forEach(line => add(lineCommand(line)));
  (geometry.circles || []).forEach(circle => add(circleCommand(circle)));

  // 3. Segments and polygons.
  (geometry.segments || []).forEach(segment => add(segmentCommand(segment)));
  (geometry.polygons || []).forEach(polygon => add(polygonCommand(polygon)));

  // 4. Angles and labels.
  (geometry.angles || []).forEach(angle => add(angleCommand(angle)));

  // 5. Constraints as comments (GeoGebra constraints are usually constructed, not declared).
  (geometry.constraints || []).forEach(constraint => add(constraintCommand(constraint)));

  return commands;
}

module.exports = { generateCommands };