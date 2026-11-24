import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform === 'win32') {
  const scriptPath = path.join(projectRoot, 'scripts', 'make-desktop.ps1');
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  const forgeCli = path.join(projectRoot, 'node_modules', '@electron-forge', 'cli', 'dist', 'electron-forge.js');
  const result = spawnSync(process.execPath, [forgeCli, 'make'], { cwd: projectRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
