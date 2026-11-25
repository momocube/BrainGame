import { listPackage } from '@electron/asar';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const archive = process.argv[2];
const touchServiceRoot = process.argv[3];
const sourceManual = process.argv[4];
if (!archive || !touchServiceRoot || !sourceManual) {
  throw new Error('請提供 app.asar、TouchService 資源目錄與來源操作手冊路徑。');
}
const entries = listPackage(archive).map((entry) => entry.replace(/\\/g, '/'));
const included = (name) => entries.some((entry) => entry.replace(/^\//, '') === name);
const forbidden = entries.filter((entry) => /^\/(?:docs|tests|tmp|data|scripts)(?:\/|$)/.test(entry) || entry === '/README.md');
if (forbidden.length) throw new Error(`桌面 package 混入非執行資源：${forbidden.slice(0, 5).join(', ')}`);
for (const required of [
  'src/mouse-input.mjs', 'public/mouse-input.mjs',
  'public/exit-control.mjs',
  'src/server.mjs', 'src/game-engine.mjs', 'src/cube-visibility.mjs', 'src/player-layouts.mjs', 'src/player-zone-geometry.mjs',
  'src/touch-protocol.mjs', 'src/desktop/main.mjs', 'src/desktop/display-layout.mjs', 'src/desktop/instance-handoff.mjs',
  'src/desktop/operation-manual.mjs', 'src/desktop/touch-service-manager.mjs', 'src/desktop/preload.cjs', 'src/touch-service-status.mjs',
  'public/stage.html', 'public/stage.js', 'public/stage.css', 'public/map-scene.mjs', 'public/tutorial-content.mjs', 'public/projection-layout.mjs', 'public/staff.js',
  'config/venue-704.json', 'config/player-zones.704.json', 'config/player-layouts.704.json',
  'config/game-rules.v1.json', 'node_modules/ws/package.json'
]) {
  if (!included(required)) throw new Error(`桌面 package 缺少執行所需檔案：${required}`);
}
for (const relativePath of ['config.json', 'PROVENANCE.json', 'publish/win-x64/TouchService.exe', 'venues/704.json']) {
  const file = path.join(touchServiceRoot, relativePath);
  if (!fs.existsSync(file)) throw new Error(`桌面 package 缺少隨附 TouchService 資源：${relativePath}`);
}
const serviceExecutable = path.join(touchServiceRoot, 'publish/win-x64/TouchService.exe');
if (fs.statSync(serviceExecutable).size < 30_000_000) {
  throw new Error('隨附 TouchService.exe 小於 30 MB；預期為不需另裝 .NET 的自包含版本。');
}
const provenanceText = fs.readFileSync(path.join(touchServiceRoot, 'PROVENANCE.json'), 'utf8').replace(/^\uFEFF/, '');
const provenance = JSON.parse(provenanceText);
const actualSha256 = createHash('sha256').update(fs.readFileSync(serviceExecutable)).digest('hex');
if (provenance.runtime !== 'win-x64 self-contained single-file' || provenance.sha256 !== actualSha256) {
  throw new Error('隨附 TouchService 執行檔與自包含版本／來源雜湊紀錄不符。');
}
const operationManual = path.join(path.dirname(archive), '704-operation-manual.md');
  if (!fs.existsSync(operationManual)) throw new Error('桌面 package 缺少隨附現場操作手冊。');
const manualText = fs.readFileSync(operationManual, 'utf8').replace(/^\uFEFF/, '');
for (const heading of ['# 704 腦力競賽｜現場操作手冊 v1', '## 3. 開始場次與玩家流程', '## 5. 異常處理']) {
  if (!manualText.includes(heading)) throw new Error(`現場操作手冊缺少必要章節：${heading}`);
}
const packagedManualSha256 = createHash('sha256').update(fs.readFileSync(operationManual)).digest('hex');
const sourceManualSha256 = createHash('sha256').update(fs.readFileSync(sourceManual)).digest('hex');
if (packagedManualSha256 !== sourceManualSha256) throw new Error('桌面 package 內手冊與專案來源版本不一致。');
console.log(`package 驗證完成：${entries.length} 個 app.asar 項目；另含自包含 TouchService、704 profile、來源雜湊與現場操作手冊。`);
