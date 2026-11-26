/** Orthographic silhouettes: front x/z, right side y/z, top x/y. */
export function orthographicViews(cells, bounds = null) {
  const mins = [0, 1, 2].map(axis => cells.length ? Math.min(...cells.map(c => c[axis])) : 0);
  const points = bounds ? cells : cells.map(c => c.map((n, axis) => n - mins[axis]));
  const size = bounds ?? [0, 1, 2].map(axis => Math.max(1, ...points.map(c => c[axis] + 1)));
  return [
    { label: '前', axes: [0, 2], flip: true },
    { label: '側', axes: [1, 2], flip: true },
    { label: '上', axes: [0, 1], flip: false }
  ].map(({ label, axes: [a, b], flip }) => ({
    label, cols: size[a], rows: size[b],
    cells: [...new Set(points.map(c => `${c[a]},${flip ? size[b] - 1 - c[b] : c[b]}`))]
      .map(key => key.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0])
  }));
}

export function orthographicSignature(cells) {
  return JSON.stringify(orthographicViews(cells).map(({ cols, rows, cells }) => [cols, rows, cells]));
}

/** Three labelled flat views, with no perspective or hidden-depth shading. */
export function orthographicSvg(cells, { bounds = null, target = false } = {}) {
  const views = orthographicViews(cells, bounds);
  const body = views.map(({ label, cols, rows, cells }, index) => {
    const size = Math.min(170 / cols, 180 / rows);
    const x = index * 210 + (210 - cols * size) / 2;
    const y = 44 + (180 - rows * size) / 2;
    const occupied = new Set(cells.map(c => c.join(',')));
    let grid = '';
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const filled = occupied.has(`${col},${row}`);
      grid += `<rect x="${x + col * size}" y="${y + row * size}" width="${size}" height="${size}" fill="${filled ? target ? '#ffdc67' : '#70dcca' : target ? '#244a72' : '#142137'}" stroke="#a6bad4" stroke-width="2"/>`;
    }
    return `<g aria-label="${label}視圖"><text x="${index * 210 + 105}" y="29" text-anchor="middle" fill="#f5f8ff" font-size="28" font-weight="800">${label}</text>${grid}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 630 236" role="img" aria-label="前、右側、上三視圖">${body}</svg>`;
}
