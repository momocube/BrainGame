function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character]);
}

function polygon(points, fill, stroke = '#a9c0d4') {
  return `<polygon points="${points.map(([x, y]) => `${x},${y}`).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
}

function line(x1, y1, x2, y2, opacity) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#b2c2d0" stroke-width="2" stroke-opacity="${opacity}"/>`;
}

/** Create an output-only SVG corridor scene from the map game's visible clues. */
export function renderPerspectiveSceneSvg(clues = []) {
  const shapes = [
    '<rect width="1000" height="600" fill="#0b1421"/>',
    polygon([[0, 0], [1000, 0], [610, 170], [390, 170]], '#263951', '#405b76'),
    polygon([[0, 0], [390, 170], [390, 440], [0, 600]], '#263f58', '#6b879e'),
    polygon([[1000, 0], [610, 170], [610, 440], [1000, 600]], '#1c334b', '#607b94'),
    polygon([[390, 170], [610, 170], [610, 440], [390, 440]], '#101c2a', '#71859a'),
    polygon([[0, 600], [1000, 600], [610, 440], [390, 440]], '#31475b', '#91a9bd')
  ];

  for (const y of [205, 255, 315, 385]) {
    const t = (y - 170) / 270;
    const left = 390 * (1 - t);
    const right = 1000 - left;
    shapes.push(`<line x1="0" y1="${y}" x2="${left}" y2="${y}" stroke="#91a9bd" stroke-width="2" stroke-opacity="0.42"/>`);
    shapes.push(`<line x1="${right}" y1="${y}" x2="1000" y2="${y}" stroke="#91a9bd" stroke-width="2" stroke-opacity="0.32"/>`);
  }
  for (const bottomX of [0, 180, 340, 500, 660, 820, 1000]) shapes.push(line(500, 440, bottomX, 600, 0.42));
  for (const y of [465, 492, 526, 568]) {
    const t = (y - 440) / 160;
    const left = 500 * (1 - t);
    const right = 1000 - left;
    shapes.push(line(left, y, right, y, 0.38));
  }

  for (const clue of Array.isArray(clues) ? clues : []) {
    const near = clue.depth === 'near';
    const sideOffset = near ? 245 : 125;
    const x = clue.side === 'left' ? 500 - sideOffset : clue.side === 'right' ? 500 + sideOffset : 500;
    const y = near ? 380 : 286;
    const radius = near ? 30 : 20;
    const label = escapeXml(clue.label ?? '•');
    shapes.push(`<circle cx="${x}" cy="${y}" r="${radius + 9}" fill="#f4cc68" fill-opacity="0.16" stroke="#f4cc68" stroke-width="${near ? 3 : 2}"/>`);
    shapes.push(`<text x="${x}" y="${y + radius * 0.34}" text-anchor="middle" font-weight="900" font-size="${radius * 1.55}" fill="#fff1c7" stroke="#172536" stroke-width="2" paint-order="stroke">${label}</text>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet" role="img" aria-label="第一人稱走廊場景與可辨識地標">${shapes.join('')}</svg>`;
}
