import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// A single portable ZIP for venue testing; no Setup/nupkg duplicates.
// Deliberately does not change PowerShell execution policy.
if (process.platform !== 'win32') throw new Error('現場測試包需要在 Windows 製作。');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(fs.readFileSync(path.join(root, 'config/game-rules.v1.json'), 'utf8'));
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const staging = fs.mkdtempSync(path.join(os.tmpdir(), '704bg-field-'));
const junction = path.join(staging, 'node_modules');
const run = (args, cwd = staging) => {
  const result = spawnSync(process.execPath, args, { cwd, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`建置失敗 (${result.status}): ${args.join(' ')}`);
};
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
try {
  for (const name of ['config', 'public', 'src', 'assets', 'resources', 'runtime', 'scripts', 'package.json', 'package-lock.json', 'forge.config.js', 'LICENSE']) {
    const source = path.join(root, name);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(staging, name), { recursive: true });
  }
  const manual = path.join(root, 'docs/704現場操作手冊_v1.md');
  fs.mkdirSync(path.join(staging, 'docs'));
  fs.copyFileSync(manual, path.join(staging, 'docs/704-operation-manual.md'));
  fs.symlinkSync(path.join(root, 'node_modules'), junction, 'junction');
  const cli = path.join(junction, '@electron-forge/cli/dist/electron-forge.js');
  run([cli, 'package']);
  const portable = path.join(staging, 'out/704 腦力競賽-win32-x64');
  fs.copyFileSync(path.join(root, 'docs/現場測試包說明.md'), path.join(portable, '開始測試.md'));
  fs.writeFileSync(path.join(portable, 'VERSION.txt'), `704 BrainGame\nRules: ${rules.rulesVersion}\nBuild date: ${date}\nPortable Windows x64 field-test build\n`);
  run([path.join(root, 'scripts/verify-desktop-package.mjs'), path.join(portable, 'resources/app.asar'), path.join(portable, 'resources/touch-service'), manual], root);
  run([cli, 'make', '--from-package', '--targets', '@electron-forge/maker-zip']);
  const archives = walk(path.join(staging, 'out/make')).filter(p => p.endsWith('.zip'));
  if (archives.length !== 1) throw new Error('預期只有一個可攜 ZIP');
  const { extract } = await import('@electron-internal/extract-zip');
  const extracted = path.join(staging, 'zip-check');
  fs.mkdirSync(extracted);
  await extract(archives[0], { dir: extracted });
  for (const file of walk(portable)) {
    const relative = path.relative(portable, file), copy = path.join(extracted, relative);
    if (!fs.existsSync(copy) || hash(file) !== hash(copy)) throw new Error(`ZIP 檔案缺少或雜湊不符：${relative}`);
  }
  const output = path.join(root, 'out/field-test');
  fs.mkdirSync(output, { recursive: true });
  let revision = 1, filename;
  do { filename = path.join(output, `704-現場測試-${date}-rules-${rules.rulesVersion}-${revision++}.zip`); } while (fs.existsSync(filename));
  fs.copyFileSync(archives[0], filename, fs.constants.COPYFILE_EXCL);
  console.log(`FIELD_TEST_ZIP: ${filename}`);
  console.log(`SHA256: ${hash(filename)}`);
  console.log('ZIP 全部檔案雜湊通過；僅交付此 ZIP，解壓後雙擊 704-Brain-Game.exe。');
} finally {
  // Remove our junction first. Never recursively remove the user's node_modules.
  if (fs.existsSync(junction)) fs.unlinkSync(junction);
  fs.rmSync(staging, { recursive: true, force: true });
}
