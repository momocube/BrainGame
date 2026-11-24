import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeTouchService } from '../src/desktop/touch-service-manager.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serviceRoot = path.resolve(process.argv[2] ?? path.join(projectRoot, 'runtime', 'touch-service'));
const profilePath = path.resolve(process.argv[3] ?? path.join(projectRoot, 'config', 'venue-704.json'));
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

async function freeTcpPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function freeUdpPort() {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

const executable = path.join(serviceRoot, 'publish', 'win-x64', 'TouchService.exe');
if (process.platform !== 'win32') throw new Error('TouchService runtime smoke test requires Windows.');
if (!fs.existsSync(executable)) throw new Error(`Missing TouchService executable: ${executable}`);
if (!fs.existsSync(path.join(serviceRoot, 'config.json')) || !fs.existsSync(path.join(serviceRoot, 'venues', '704.json'))) {
  throw new Error('TouchService runtime is missing its config or 704 venue profile.');
}

const tempRoot = fs.mkdtempSync(path.join(projectRoot, 'tmp', 'touchservice-runtime-check-'));
const tempResolved = path.resolve(tempRoot);
const tmpParent = `${path.resolve(projectRoot, 'tmp')}${path.sep}`;
if (!tempResolved.startsWith(tmpParent)) throw new Error(`Refusing to use a non-project temporary folder: ${tempResolved}`);
let child;
let lastError = 'no WebSocket hello received';
try {
  const config = JSON.parse(fs.readFileSync(path.join(serviceRoot, 'config.json'), 'utf8'));
  const port = await freeTcpPort();
  config.listenPort = await freeUdpPort();
  config.venueProfile = path.join(serviceRoot, 'venues', '704.json');
  config.webSocketOutput = { ...(config.webSocketOutput ?? {}), enabled: true, port };
  config.interactionEnabled = false;
  config.autoLock = { ...(config.autoLock ?? {}), enabled: false };
  config.ui = { ...(config.ui ?? {}), autoLaunch: false, trayEnabled: false };
  config.log = { ...(config.log ?? {}), dir: path.join(tempRoot, 'logs'), console: false };
  const configPath = path.join(tempRoot, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  child = spawn(executable, ['--config', configPath], {
    cwd: serviceRoot, windowsHide: true, detached: false, stdio: 'ignore'
  });
  let spawnError = null;
  child.once('error', (error) => { spawnError = error; });
  const url = `ws://127.0.0.1:${port}/`;
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`TouchService exited before hello (${child.exitCode}): ${lastError}`);
    const result = await probeTouchService(url, profile, 1_000);
    if (result.ok) {
      console.log(`TouchService runtime verified: hello matched venue ${profile.venue} at ${url}`);
      break;
    }
    lastError = result.error;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (Date.now() >= deadline) throw new Error(`TouchService runtime startup timed out: ${lastError}`);
} finally {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    try { child.kill(); } catch { /* already stopped */ }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch { /* already stopped */ } }
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
