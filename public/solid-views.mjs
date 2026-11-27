/** Orthographic silhouettes: front x/z, right side y/z, top x/y. */
export function orthographicViews(cells, bounds = null) {
  const mins = [0, 1, 2].map(axis => cells.length ? Math.min(...cells.map(c => c[axis])) : 0);
  const points = bounds ? cells : cells.map(c => c.map((n, axis) => n - mins[axis]));
  const size = bounds ?? [0, 1, 2].map(axis => Math.max(1, ...points.map(c => c[axis] + 1)));
  return [
    { label: '前', axes: [0, 2], flip: true },
    { label: '側', axes: [1, 2], flip: true },
    { label: '上', axes: [0, 1], flip: true }
  ].map(({ label, axes: [a, b], flip }) => ({
    label, cols: size[a], rows: size[b],
    cells: [...new Set(points.map(c => `${c[a]},${flip ? size[b] - 1 - c[b] : c[b]}`))]
      .map(key => key.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0])
  }));
}

export function orthographicSignature(cells, bounds = null) {
  return JSON.stringify(orthographicViews(cells, bounds).map(({ cols, rows, cells }) => [cols, rows, cells]));
}

/** Preserve target coordinates: the question shows the solid, not the missing piece. */
export function remainingSolidCells(target, missing) {
  const removed = new Set(missing.map(cell => cell.join(',')));
  const cells = [];
  for (let x = 0; x < target[0]; x++) for (let y = 0; y < target[1]; y++) for (let z = 0; z < target[2]; z++) {
    if (!removed.has(`${x},${y},${z}`)) cells.push([x, y, z]);
  }
  return cells;
}

/** Trace only exposed edges; shared voxel edges never enter the SVG. */
function silhouettePath(cells) {
  const occupied = new Set(cells.map(cell => cell.join(',')));
  const edges = new Map();
  const add = (a, b, direction) => {
    const key = a.join(',');
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push({ a, b, direction });
  };
  for (const [x, y] of cells) {
    if (!occupied.has(`${x},${y - 1}`)) add([x, y], [x + 1, y], 0);
    if (!occupied.has(`${x + 1},${y}`)) add([x + 1, y], [x + 1, y + 1], 1);
    if (!occupied.has(`${x},${y + 1}`)) add([x + 1, y + 1], [x, y + 1], 2);
    if (!occupied.has(`${x - 1},${y}`)) add([x, y + 1], [x, y], 3);
  }
  const paths = [];
  while (edges.size) {
    let edge = edges.values().next().value[0];
    const start = edge.a.join(','), loop = [];
    do {
      loop.push(edge.a);
      const key = edge.a.join(','), outgoing = edges.get(key);
      outgoing.splice(outgoing.indexOf(edge), 1);
      if (!outgoing.length) edges.delete(key);
      if (edge.b.join(',') === start) break;
      // At diagonal contacts, keep occupied cells on the right of the contour.
      const next = edges.get(edge.b.join(','));
      const priority = [1, 0, 3, 2].map(turn => (edge.direction + turn) % 4);
      edge = [...next].sort((a, b) => priority.indexOf(a.direction) - priority.indexOf(b.direction))[0];
    } while (edge);
    const corners = loop.filter((point, index) => {
      const before = loop[(index + loop.length - 1) % loop.length], after = loop[(index + 1) % loop.length];
      return (point[0] - before[0]) * (after[1] - point[1]) !== (point[1] - before[1]) * (after[0] - point[0]);
    });
    paths.push(`M${corners.map(point => point.join(',')).join('L')}Z`);
  }
  return paths.join('');
}

/** Shared unit scale and aligned third-angle L layout: top above front, right beside front. */
export function orthographicLayout(views) {
  const [front, side, top] = views;
  const gap = 64, margin = 24, labelHeight = 38;
  const size = Math.min((640 - margin * 2 - gap) / (front.cols + side.cols),
    (520 - margin * 2 - gap - labelHeight) / (top.rows + front.rows));
  const x = (640 - (front.cols + side.cols) * size - gap) / 2;
  const topY = labelHeight;
  const frontY = topY + top.rows * size + gap;
  return [
    { x, y: frontY, size, title: '正視圖' },
    { x: x + front.cols * size + gap, y: frontY, size, title: '右側視圖' },
    { x, y: topY, size, title: '上視圖' }
  ];
}

/** Three labelled flat views, with no perspective or hidden-depth shading. */
export function orthographicSvg(cells, { bounds = null, target = false } = {}) {
  const views = orthographicViews(cells, bounds);
  const layout = orthographicLayout(views);
  const body = views.map(({ label, cols, cells }, index) => {
    const { x, y, size, title } = layout[index];
    const outline = `<path d="${silhouettePath(cells)}" transform="translate(${x} ${y}) scale(${size})" fill="${target ? '#ffdc67' : '#70dcca'}" fill-rule="evenodd" stroke="#a6bad4" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    return `<g aria-label="${label}視圖" data-view="${index}" data-origin="${x},${y}"><text x="${x + cols * size / 2}" y="${y - 12}" text-anchor="middle" fill="#f5f8ff" font-size="28" font-weight="800">${title}</text>${outline}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 520" role="img" aria-label="L 型三視圖：正視圖上方為上視圖，右方為右側視圖">${body}</svg>`;
}
