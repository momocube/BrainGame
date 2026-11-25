// 數迴棋盤 SVG：玩家牆面、地板題目與結算共用。座標與 src/slitherlink.mjs 的邊編號一致。
const EDGE_LINE = 1;
const EDGE_CROSS = 2;

export function slitherlinkEdgeEndpoints(index, cols, rows) {
  const horizontalCount = (rows + 1) * cols;
  if (index < horizontalCount) {
    const r = Math.floor(index / cols), c = index % cols;
    return [[c, r], [c + 1, r]];
  }
  const offset = index - horizontalCount;
  const r = Math.floor(offset / (cols + 1)), c = offset % (cols + 1);
  return [[c, r], [c, r + 1]];
}

const round = (value) => Math.round(value * 10) / 10;

/**
 * Render a board inside `rect` (local design pixels). `edges` are the player's states
 * (0 blank, 1 line, 2 cross); `solution` (results only) is drawn underneath in gold, and
 * player lines outside the solution are dashed red.
 */
export function slitherlinkBoardSvg({
  cols = 5, rows = 5, clues = [], edges = [], solution = null,
  rect = { x: 0, y: 0, width: 480, height: 480 }, viewBox = null, className = 'slither-svg', label = '數迴棋盤'
} = {}) {
  const cols_ = Number.isInteger(cols) && cols > 0 ? cols : 5;
  const rows_ = Number.isInteger(rows) && rows > 0 ? rows : 5;
  const cellW = rect.width / cols_, cellH = rect.height / rows_;
  const cell = Math.min(cellW, cellH);
  const point = ([x, y]) => [round(rect.x + x * cellW), round(rect.y + y * cellH)];
  const margin = cell * 0.4;
  const box = viewBox ?? `${round(rect.x - margin)} ${round(rect.y - margin)} ${round(rect.width + margin * 2)} ${round(rect.height + margin * 2)}`;
  const safeClass = String(className).replace(/[^a-z0-9 _-]/gi, '');
  const safeLabel = String(label).replace(/[<>&"]/g, '');
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" class="${safeClass}" role="img" aria-label="${safeLabel}">`];
  parts.push(`<rect x="${round(rect.x)}" y="${round(rect.y)}" width="${round(rect.width)}" height="${round(rect.height)}" rx="${round(cell * 0.08)}" fill="#13233a" stroke="#2c4462" stroke-width="2"/>`);

  const segment = (index, stroke, width, extra = '') => {
    const [a, b] = slitherlinkEdgeEndpoints(index, cols_, rows_).map(point);
    return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${stroke}" stroke-width="${round(width)}" stroke-linecap="round"${extra}/>`;
  };
  const solutionSet = Array.isArray(solution) ? new Set(solution) : null;
  if (solutionSet) for (const index of solutionSet) parts.push(segment(index, '#f4ca62', cell * 0.13, ' class="slither-solution"'));

  edges.forEach((state, index) => {
    if (state === EDGE_LINE) {
      const wrong = solutionSet && !solutionSet.has(index);
      parts.push(segment(index, wrong ? '#ff6b7d' : '#74f0dd', cell * (solutionSet ? 0.06 : 0.11),
        wrong ? ` stroke-dasharray="${round(cell * 0.12)} ${round(cell * 0.1)}" class="slither-line slither-wrong"` : ' class="slither-line"'));
    } else if (state === EDGE_CROSS) {
      const [a, b] = slitherlinkEdgeEndpoints(index, cols_, rows_).map(point);
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, s = cell * 0.11;
      parts.push(`<g class="slither-cross" stroke="#ff7b8a" stroke-width="${round(cell * 0.045)}" stroke-linecap="round">` +
        `<line x1="${round(cx - s)}" y1="${round(cy - s)}" x2="${round(cx + s)}" y2="${round(cy + s)}"/>` +
        `<line x1="${round(cx - s)}" y1="${round(cy + s)}" x2="${round(cx + s)}" y2="${round(cy - s)}"/></g>`);
    }
  });

  clues.forEach((clue, index) => {
    if (!Number.isInteger(clue) || clue < 0 || clue > 4) return;
    const [x, y] = point([index % cols_ + 0.5, Math.floor(index / cols_) + 0.5]);
    parts.push(`<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="${round(cell * 0.56)}" font-weight="900" fill="#f5f8ff" class="slither-clue">${clue}</text>`);
  });

  for (let y = 0; y <= rows_; y++) for (let x = 0; x <= cols_; x++) {
    const [px, py] = point([x, y]);
    parts.push(`<circle cx="${px}" cy="${py}" r="${round(cell * 0.075)}" fill="#e9f4ff"/>`);
  }
  parts.push('</svg>');
  return parts.join('');
}
