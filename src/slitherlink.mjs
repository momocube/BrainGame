// 數迴（Slitherlink）核心：棋盤幾何、題目生成、推理解題、唯一解檢查與觸控命中。
//
// 邊的編號（cols × rows 個格子，(cols + 1) × (rows + 1) 個點）：
//   橫邊 (r, c)：r = 0..rows、c = 0..cols-1 → r * cols + c
//   直邊 (r, c)：r = 0..rows-1、c = 0..cols → (rows + 1) * cols + r * (cols + 1) + c
// 玩家每條邊的狀態：0 空白、1 線段、2 叉叉。

export const EDGE_BLANK = 0;
export const EDGE_LINE = 1;
export const EDGE_CROSS = 2;

const topologyCache = new Map();

export function edgeCount(cols, rows) {
  return (rows + 1) * cols + rows * (cols + 1);
}

export function horizontalEdge(r, c, cols) {
  return r * cols + c;
}

export function verticalEdge(r, c, cols, rows) {
  return (rows + 1) * cols + r * (cols + 1) + c;
}

/** Dot coordinates [x, y] of both ends of an edge; x is the dot column, y the dot row. */
export function edgeEndpoints(index, cols, rows) {
  const horizontalCount = (rows + 1) * cols;
  if (index < horizontalCount) {
    const r = Math.floor(index / cols), c = index % cols;
    return [[c, r], [c + 1, r]];
  }
  const offset = index - horizontalCount;
  const r = Math.floor(offset / (cols + 1)), c = offset % (cols + 1);
  return [[c, r], [c, r + 1]];
}

/** Top, bottom, left and right edges of a cell. */
export function cellEdges(cell, cols, rows) {
  const r = Math.floor(cell / cols), c = cell % cols;
  return [
    horizontalEdge(r, c, cols), horizontalEdge(r + 1, c, cols),
    verticalEdge(r, c, cols, rows), verticalEdge(r, c + 1, cols, rows)
  ];
}

function topology(cols, rows) {
  const key = `${cols}x${rows}`;
  if (topologyCache.has(key)) return topologyCache.get(key);
  const edges = edgeCount(cols, rows);
  const dot = (x, y) => y * (cols + 1) + x;
  const edgeVertices = Array.from({ length: edges }, (_, index) => {
    const [[x1, y1], [x2, y2]] = edgeEndpoints(index, cols, rows);
    return [dot(x1, y1), dot(x2, y2)];
  });
  const vertexEdges = Array.from({ length: (cols + 1) * (rows + 1) }, () => []);
  edgeVertices.forEach(([a, b], index) => { vertexEdges[a].push(index); vertexEdges[b].push(index); });
  const cells = Array.from({ length: cols * rows }, (_, cell) => cellEdges(cell, cols, rows));
  const result = { cols, rows, edges, edgeVertices, vertexEdges, cells };
  topologyCache.set(key, result);
  return result;
}

/** Loop edges that outline a set of cells (the region boundary). */
export function loopEdgesForRegion(inside, cols, rows) {
  const at = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols && Boolean(inside[r * cols + c]);
  const edges = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) {
    if (at(r - 1, c) !== at(r, c)) edges.push(horizontalEdge(r, c, cols));
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) {
    if (at(r, c - 1) !== at(r, c)) edges.push(verticalEdge(r, c, cols, rows));
  }
  return edges.sort((a, b) => a - b);
}

/** Number of loop edges around every cell. */
export function clueCountsForLoop(lineEdges, cols, rows) {
  const lines = new Set(lineEdges);
  return topology(cols, rows).cells.map((edges) => edges.filter((edge) => lines.has(edge)).length);
}

/** True when the edges form exactly one closed loop without branches or crossings. */
export function isSingleLoop(lineEdges, cols, rows) {
  const topo = topology(cols, rows);
  const lines = [...new Set(lineEdges)];
  if (lines.length < 4 || lines.some((edge) => !Number.isInteger(edge) || edge < 0 || edge >= topo.edges)) return false;
  const degree = new Map();
  for (const edge of lines) for (const vertex of topo.edgeVertices[edge]) degree.set(vertex, (degree.get(vertex) ?? 0) + 1);
  if ([...degree.values()].some((value) => value !== 2)) return false;
  const lineSet = new Set(lines);
  const seen = new Set([lines[0]]);
  const queue = [lines[0]];
  while (queue.length) {
    const edge = queue.pop();
    for (const vertex of topo.edgeVertices[edge]) for (const next of topo.vertexEdges[vertex]) {
      if (lineSet.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen.size === lines.length;
}

function cluesSatisfied(lineEdges, clues, cols, rows) {
  const counts = clueCountsForLoop(lineEdges, cols, rows);
  return clues.every((clue, cell) => clue == null || clue === counts[cell]);
}

/** A region is usable when its boundary is one simple loop: connected, no holes, no diagonal pinch. */
export function regionIsValid(inside, cols, rows) {
  const at = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols && Boolean(inside[r * cols + c]);
  const cells = inside.map((value, index) => value ? index : -1).filter((index) => index >= 0);
  if (!cells.length || cells.length === cols * rows) return false;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    const tl = at(r - 1, c - 1), tr = at(r - 1, c), bl = at(r, c - 1), br = at(r, c);
    if (tl === br && tr === bl && tl !== tr) return false;
  }
  const neighbors = (index) => {
    const r = Math.floor(index / cols), c = index % cols;
    return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
  };
  const reached = new Set([cells[0]]);
  const queue = [cells[0]];
  while (queue.length) {
    for (const [r, c] of neighbors(queue.pop())) {
      const next = r * cols + c;
      if (at(r, c) && !reached.has(next)) { reached.add(next); queue.push(next); }
    }
  }
  if (reached.size !== cells.length) return false;
  // Every outside cell must connect to the board edge; otherwise the region has a hole.
  const outside = new Set();
  const outsideQueue = [];
  for (let index = 0; index < cols * rows; index++) {
    const r = Math.floor(index / cols), c = index % cols;
    if (!inside[index] && (r === 0 || c === 0 || r === rows - 1 || c === cols - 1)) {
      outside.add(index); outsideQueue.push(index);
    }
  }
  while (outsideQueue.length) {
    for (const [r, c] of neighbors(outsideQueue.pop())) {
      const next = r * cols + c;
      if (r >= 0 && r < rows && c >= 0 && c < cols && !inside[next] && !outside.has(next)) {
        outside.add(next); outsideQueue.push(next);
      }
    }
  }
  return outside.size + cells.length === cols * rows;
}

function shuffle(items, randomInt) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function randomRegion(cols, rows, size, randomInt) {
  const inside = Array(cols * rows).fill(false);
  inside[randomInt(cols * rows)] = true;
  for (let count = 1; count < size; count++) {
    const frontier = [];
    for (let index = 0; index < inside.length; index++) {
      if (inside[index]) continue;
      const r = Math.floor(index / cols), c = index % cols;
      if ([[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(([nr, nc]) =>
        nr >= 0 && nr < rows && nc >= 0 && nc < cols && inside[nr * cols + nc])) frontier.push(index);
    }
    let added = false;
    for (const index of shuffle(frontier, randomInt)) {
      inside[index] = true;
      if (regionIsValid(inside, cols, rows)) { added = true; break; }
      inside[index] = false;
    }
    if (!added) return null;
  }
  return inside;
}

/**
 * Apply forced deductions in place. Returns false on contradiction.
 * Rules: clue counts, vertex degree 0/2, and never closing a loop early.
 */
function propagate(topo, clues, edges) {
  let changed = true;
  let contradiction = false;
  const set = (edge, value) => {
    if (edges[edge] === EDGE_BLANK) { edges[edge] = value; changed = true; }
    else if (edges[edge] !== value) contradiction = true;
  };
  while (changed && !contradiction) {
    changed = false;
    for (let cell = 0; cell < topo.cells.length && !contradiction; cell++) {
      const clue = clues[cell];
      if (clue == null) continue;
      const around = topo.cells[cell];
      const lines = around.filter((edge) => edges[edge] === EDGE_LINE).length;
      const unknown = around.filter((edge) => edges[edge] === EDGE_BLANK);
      if (lines > clue || lines + unknown.length < clue) { contradiction = true; break; }
      if (!unknown.length) continue;
      if (lines === clue) unknown.forEach((edge) => set(edge, EDGE_CROSS));
      else if (lines + unknown.length === clue) unknown.forEach((edge) => set(edge, EDGE_LINE));
    }
    for (let vertex = 0; vertex < topo.vertexEdges.length && !contradiction; vertex++) {
      const around = topo.vertexEdges[vertex];
      const lines = around.filter((edge) => edges[edge] === EDGE_LINE).length;
      const unknown = around.filter((edge) => edges[edge] === EDGE_BLANK);
      if (lines > 2 || (lines === 1 && !unknown.length)) { contradiction = true; break; }
      if (!unknown.length) continue;
      if (lines === 2) unknown.forEach((edge) => set(edge, EDGE_CROSS));
      else if (lines === 1 && unknown.length === 1) set(unknown[0], EDGE_LINE);
      else if (lines === 0 && unknown.length === 1) set(unknown[0], EDGE_CROSS);
    }
    if (contradiction || changed) continue;

    // Loop rule: work on chains of drawn lines.
    const parent = topo.vertexEdges.map((_, index) => index);
    const find = (v) => { while (parent[v] !== v) { parent[v] = parent[parent[v]]; v = parent[v]; } return v; };
    const degree = Array(topo.vertexEdges.length).fill(0);
    const lineEdges = [];
    edges.forEach((state, edge) => {
      if (state !== EDGE_LINE) return;
      lineEdges.push(edge);
      const [a, b] = topo.edgeVertices[edge];
      degree[a]++; degree[b]++;
      parent[find(a)] = find(b);
    });
    if (!lineEdges.length) continue;
    const componentLines = new Map();
    const componentOpen = new Map();
    for (const edge of lineEdges) {
      const root = find(topo.edgeVertices[edge][0]);
      componentLines.set(root, (componentLines.get(root) ?? 0) + 1);
    }
    degree.forEach((value, vertex) => { if (value === 1) componentOpen.set(find(vertex), true); });
    for (const [root, count] of componentLines) {
      if (componentOpen.get(root)) continue;
      // A closed loop exists: it must be the whole answer.
      if (count < lineEdges.length) { contradiction = true; break; }
      edges.forEach((state, edge) => { if (state === EDGE_BLANK) set(edge, EDGE_CROSS); });
    }
    if (contradiction || changed) continue;
    for (let edge = 0; edge < edges.length; edge++) {
      if (edges[edge] !== EDGE_BLANK) continue;
      const [a, b] = topo.edgeVertices[edge];
      if (degree[a] !== 1 || degree[b] !== 1 || find(a) !== find(b)) continue;
      const closesEverything = componentLines.get(find(a)) === lineEdges.length;
      if (!closesEverything || !cluesSatisfied([...lineEdges, edge], clues, topo.cols, topo.rows)) {
        set(edge, EDGE_CROSS);
      }
    }
  }
  if (contradiction) return false;
  if (!edges.includes(EDGE_BLANK)) {
    const lines = edges.flatMap((state, edge) => state === EDGE_LINE ? [edge] : []);
    return isSingleLoop(lines, topo.cols, topo.rows) && cluesSatisfied(lines, clues, topo.cols, topo.rows);
  }
  return true;
}

/**
 * Solve with forced deductions only. trialDepth 1 also allows "assume one edge, see a contradiction".
 * Every step is forced, so a full solve proves the solution is unique.
 */
export function solveByDeduction(cols, rows, clues, { trialDepth = 0 } = {}) {
  const topo = topology(cols, rows);
  const edges = Array(topo.edges).fill(EDGE_BLANK);
  if (!propagate(topo, clues, edges)) return { status: 'contradiction', edges };
  let progress = true;
  while (trialDepth > 0 && progress && edges.includes(EDGE_BLANK)) {
    progress = false;
    for (let edge = 0; edge < edges.length; edge++) {
      if (edges[edge] !== EDGE_BLANK) continue;
      for (const [guess, forced] of [[EDGE_LINE, EDGE_CROSS], [EDGE_CROSS, EDGE_LINE]]) {
        const trial = edges.slice();
        trial[edge] = guess;
        if (propagate(topo, clues, trial)) continue;
        edges[edge] = forced;
        if (!propagate(topo, clues, edges)) return { status: 'contradiction', edges };
        progress = true;
        break;
      }
    }
  }
  return { status: edges.includes(EDGE_BLANK) ? 'stuck' : 'solved', edges };
}

/** Count complete solutions up to the limit with propagation and branching. */
export function countSolutions(cols, rows, clues, limit = 2) {
  const topo = topology(cols, rows);
  let count = 0;
  const search = (edges) => {
    if (count >= limit || !propagate(topo, clues, edges)) return;
    const next = edges.indexOf(EDGE_BLANK);
    if (next < 0) { count++; return; }
    for (const value of [EDGE_LINE, EDGE_CROSS]) {
      const branch = edges.slice();
      branch[next] = value;
      search(branch);
    }
  };
  search(Array(topo.edges).fill(EDGE_BLANK));
  return count;
}

/**
 * Build a puzzle: random simple loop, all clues, then hide clues while the puzzle stays
 * solvable by deduction (which also guarantees a unique solution).
 */
export function generateSlitherlinkPuzzle({ cols, rows, cluesMin, cluesMax, regionCellsMin, regionCellsMax, trialDepth = 0 }, randomInt, { attempts = 400 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const region = randomRegion(cols, rows, randomInt(regionCellsMin, regionCellsMax + 1), randomInt);
    if (!region) continue;
    const solution = loopEdgesForRegion(region, cols, rows);
    if (!isSingleLoop(solution, cols, rows)) continue;
    const clues = clueCountsForLoop(solution, cols, rows);
    const target = randomInt(cluesMin, cluesMax + 1);
    let shown = clues.length;
    for (const cell of shuffle(clues.map((_, index) => index), randomInt)) {
      if (shown <= target) break;
      const hidden = clues[cell];
      clues[cell] = null;
      if (solveByDeduction(cols, rows, clues, { trialDepth }).status === 'solved') shown--;
      else clues[cell] = hidden;
    }
    if (shown < cluesMin || shown > cluesMax) continue;
    return { cols, rows, clues, solution, clueCount: shown, loopLength: solution.length, trialDepth };
  }
  throw new Error(`無法產生 ${cols}×${rows} 數迴題目`);
}

/** Next state for one tap: blank → line → cross → blank. */
export function nextEdgeState(state) {
  return state === EDGE_BLANK ? EDGE_LINE : state === EDGE_LINE ? EDGE_CROSS : EDGE_BLANK;
}

/** Completion check: the drawn lines are exactly the solution; crosses are only notes. */
export function linesMatchSolution(edgeStates, solution) {
  const solutionSet = new Set(solution);
  let lines = 0;
  for (let edge = 0; edge < edgeStates.length; edge++) {
    if (edgeStates[edge] !== EDGE_LINE) continue;
    if (!solutionSet.has(edge)) return false;
    lines++;
  }
  return lines === solutionSet.size;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Map a tap in local design pixels to the nearest edge. Taps in a cell centre (where the clue is),
 * right on a dot, or far outside the board are ignored instead of guessing.
 */
export function slitherlinkEdgeAt(x, y, rect, cols, rows, {
  marginCells = 0.35, maxDistanceCells = 0.4, tieToleranceCells = 0.08
} = {}) {
  const gx = (x - rect.x) / (rect.width / cols);
  const gy = (y - rect.y) / (rect.height / rows);
  if (!Number.isFinite(gx) || !Number.isFinite(gy) ||
      gx < -marginCells || gy < -marginCells || gx > cols + marginCells || gy > rows + marginCells) return null;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const hr = clamp(Math.round(gy), 0, rows), hc = clamp(Math.floor(gx), 0, cols - 1);
  const vr = clamp(Math.floor(gy), 0, rows - 1), vc = clamp(Math.round(gx), 0, cols);
  const dh = distanceToSegment(gx, gy, hc, hr, hc + 1, hr);
  const dv = distanceToSegment(gx, gy, vc, vr, vc, vr + 1);
  if (Math.min(dh, dv) > maxDistanceCells || Math.abs(dh - dv) < tieToleranceCells) return null;
  return dh < dv ? horizontalEdge(hr, hc, cols) : verticalEdge(vr, vc, cols, rows);
}
