import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createRuntimeTouchServiceConfig,
  ensureTouchService,
  resolveTouchServiceRoot,
  stopManagedTouchService,
  touchServiceUrlFromConfig
} from '../src/desktop/touch-service-manager.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture() {
  const root = fs.mkdtempSync(path.join(ROOT, 'tmp', 'touch-manager-test-'));
  const serviceRoot = path.join(root, 'service');
  fs.mkdirSync(path.join(serviceRoot, 'venues'), { recursive: true });
  fs.mkdirSync(path.join(serviceRoot, 'publish', 'win-x64'), { recursive: true });
  const sourceConfig = {
    venueProfile: 'venues/default.json',
    webSocketOutput: { enabled: true, port: 20111 },
    log: { dir: 'logs', console: true },
    ui: { autoLaunch: true, trayEnabled: true }
  };
  fs.writeFileSync(path.join(serviceRoot, 'config.json'), JSON.stringify(sourceConfig));
  fs.writeFileSync(path.join(serviceRoot, 'venues', '704.json'), '{}');
  fs.writeFileSync(path.join(serviceRoot, 'publish', 'win-x64', 'TouchService.exe'), 'test fixture');
  return { root, serviceRoot, sourceConfig, profile: { venue: '704' }, userDataPath: path.join(root, 'user-data') };
}

const settingsFor = (values = {}) => ({
  sourceConfigRelativePath: 'config.json',
  executableRelativePath: 'publish/win-x64/TouchService.exe',
  venueProfileRelativePath: 'venues/704.json',
  webSocketUrl: 'ws://127.0.0.1:20111/',
  autoStart: true,
  probeTimeoutMs: 5,
  startupTimeoutMs: 100,
  ...values
});

test('desktop resolves a bundled TouchService before the machine-specific fallback', () => {
  const data = fixture();
  try {
    const appRoot = path.join(data.root, 'app');
    const bundledRoot = path.join(appRoot, 'runtime', 'touch-service');
    fs.mkdirSync(path.join(bundledRoot, 'publish', 'win-x64'), { recursive: true });
    fs.mkdirSync(path.join(bundledRoot, 'venues'), { recursive: true });
    fs.writeFileSync(path.join(bundledRoot, 'config.json'), '{}');
    fs.writeFileSync(path.join(bundledRoot, 'publish', 'win-x64', 'TouchService.exe'), 'bundled');
    fs.writeFileSync(path.join(bundledRoot, 'venues', '704.json'), '{}');
    const settings = settingsFor({ ...{
      bundledResourceName: 'touch-service', bundledDevelopmentRelativePath: 'runtime/touch-service'
    }, serviceRoot: data.serviceRoot });

    assert.equal(resolveTouchServiceRoot(settings, { appRoot }), bundledRoot);
    assert.equal(resolveTouchServiceRoot({ ...settings, serviceRoot: '' }, { appRoot }), bundledRoot,
      'a repository clone without a machine-specific service path still uses the bundled development runtime');
    assert.equal(resolveTouchServiceRoot(settings, {
      appRoot, overrideRoot: path.join(data.root, 'operator-override')
    }), path.join(data.root, 'operator-override'));
    assert.equal(resolveTouchServiceRoot(settings, {
      appRoot: path.join(data.root, 'missing-app')
    }), data.serviceRoot);
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test('packaged desktop resolves the TouchService resource outside app.asar', () => {
  const data = fixture();
  try {
    const resourcesPath = path.join(data.root, 'resources');
    const bundledRoot = path.join(resourcesPath, 'touch-service');
    fs.mkdirSync(path.join(bundledRoot, 'publish', 'win-x64'), { recursive: true });
    fs.mkdirSync(path.join(bundledRoot, 'venues'), { recursive: true });
    fs.writeFileSync(path.join(bundledRoot, 'config.json'), '{}');
    fs.writeFileSync(path.join(bundledRoot, 'publish', 'win-x64', 'TouchService.exe'), 'bundled');
    fs.writeFileSync(path.join(bundledRoot, 'venues', '704.json'), '{}');

    assert.equal(resolveTouchServiceRoot(settingsFor({
      bundledResourceName: 'touch-service', serviceRoot: data.serviceRoot
    }), { isPackaged: true, resourcesPath }), bundledRoot);
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test('TouchService URL requires WebSocket output and uses its configured port', () => {
  assert.equal(touchServiceUrlFromConfig({ webSocketOutput: { enabled: true, port: 20111 } }), 'ws://127.0.0.1:20111/');
  assert.throws(() => touchServiceUrlFromConfig({ webSocketOutput: { enabled: false, port: 20111 } }), /未啟用/);
});

test('runtime TouchService config redirects venue and logs without mutating the source', () => {
  const source = { venueProfile: 'venues/old.json', log: { dir: 'logs' }, ui: { autoLaunch: true, trayEnabled: true } };
  const runtime = createRuntimeTouchServiceConfig(source, {
    serviceRoot: 'C:/TouchService', userDataPath: 'C:/GameData', venueProfileRelativePath: 'venues/704.json'
  });

  assert.equal(runtime.venueProfile, path.resolve('C:/TouchService', 'venues/704.json'));
  assert.equal(runtime.log.dir, path.join('C:/GameData', 'touch-service', 'logs'));
  assert.equal(runtime.ui.autoLaunch, false);
  assert.equal(runtime.ui.trayEnabled, false);
  assert.deepEqual(source, { venueProfile: 'venues/old.json', log: { dir: 'logs' }, ui: { autoLaunch: true, trayEnabled: true } });
});

test('a compatible existing TouchService is reused without launching another process', async () => {
  const data = fixture();
  try {
    const result = await ensureTouchService({
      settings: settingsFor(), profile: data.profile, userDataPath: data.userDataPath,
      serviceRoot: data.serviceRoot, platform: 'win32',
      probe: async () => ({ ok: true }),
      processExists: async () => { throw new Error('must not query processes after a successful probe'); },
      spawnProcess: () => { throw new Error('must not spawn a duplicate service'); },
      logger: { warn() {} }
    });
    assert.equal(result.status, 'connected-existing');
    assert.equal(result.process, null);
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test('an existing but unverified TouchService process prevents a duplicate launch', async () => {
  const data = fixture();
  try {
    let spawned = false;
    const result = await ensureTouchService({
      settings: settingsFor(), profile: data.profile, userDataPath: data.userDataPath,
      serviceRoot: data.serviceRoot, platform: 'win32',
      probe: async () => ({ ok: false, error: 'venue mismatch' }),
      processExists: async () => true,
      spawnProcess: () => { spawned = true; },
      logger: { warn() {} }
    });
    assert.equal(result.status, 'existing-process-unverified');
    assert.equal(spawned, false);
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test('a missing compatible service starts from an isolated runtime config and verifies its hello', async () => {
  const data = fixture();
  try {
    let clock = 0;
    let probes = 0;
    let spawnArguments;
    const child = new EventEmitter();
    child.exitCode = null;
    child.kill = () => { child.exitCode = 0; };
    const result = await ensureTouchService({
      settings: settingsFor(), profile: data.profile, userDataPath: data.userDataPath,
      serviceRoot: data.serviceRoot, platform: 'win32',
      probe: async () => ({ ok: ++probes > 1 }),
      processExists: async () => false,
      spawnProcess: (...args) => { spawnArguments = args; return child; },
      now: () => clock,
      wait: async (milliseconds) => { clock += milliseconds; },
      logger: { warn() {} }
    });

    assert.equal(result.status, 'started');
    assert.equal(result.process, child);
    assert.equal(spawnArguments[0], path.join(data.serviceRoot, 'publish', 'win-x64', 'TouchService.exe'));
    assert.deepEqual(spawnArguments[1], ['--config', path.join(data.userDataPath, 'touch-service', 'config.json')]);
    assert.equal(spawnArguments[2].windowsHide, true);
    assert.equal(spawnArguments[2].detached, false);
    const runtime = JSON.parse(fs.readFileSync(spawnArguments[1][1], 'utf8'));
    assert.equal(runtime.venueProfile, path.join(data.serviceRoot, 'venues', '704.json'));
    assert.equal(runtime.ui.autoLaunch, false);
    assert.equal(runtime.log.dir, path.join(data.userDataPath, 'touch-service', 'logs'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(data.serviceRoot, 'config.json'), 'utf8')).ui.autoLaunch, true);
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test('a TouchService startup timeout waits for the managed process to exit', async () => {
  const data = fixture();
  try {
    const child = new EventEmitter();
    child.exitCode = null;
    let killCount = 0;
    child.kill = () => {
      killCount++;
      child.exitCode = 0;
      queueMicrotask(() => child.emit('exit', 0, null));
      return true;
    };
    const result = await ensureTouchService({
      settings: settingsFor({ startupTimeoutMs: 0, stopTimeoutMs: 0 }),
      profile: data.profile, userDataPath: data.userDataPath,
      serviceRoot: data.serviceRoot, platform: 'win32',
      probe: async () => ({ ok: false, error: 'hello unavailable' }),
      processExists: async () => false,
      spawnProcess: () => child,
      logger: { warn() {} }
    });

    assert.equal(result.status, 'startup-timeout');
    assert.equal(killCount, 1);
    assert.equal(child.exitCode, 0);
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});

test('a startup probe error also stops the managed TouchService process', async () => {
  const data = fixture();
  try {
    const child = new EventEmitter();
    child.exitCode = null;
    let killCount = 0;
    child.kill = () => {
      killCount++;
      child.exitCode = 0;
      queueMicrotask(() => child.emit('exit', 0, null));
      return true;
    };
    let probeCount = 0;
    const result = await ensureTouchService({
      settings: settingsFor({ stopTimeoutMs: 0 }),
      profile: data.profile, userDataPath: data.userDataPath,
      serviceRoot: data.serviceRoot, platform: 'win32',
      probe: async () => {
        if (++probeCount === 1) return { ok: false, error: 'not listening yet' };
        throw new Error('probe failed');
      },
      processExists: async () => false,
      spawnProcess: () => child,
      logger: { warn() {} }
    });

    assert.equal(result.status, 'startup-failed');
    assert.equal(result.error, 'probe failed');
    assert.equal(killCount, 1);
    assert.equal(child.exitCode, 0);
  } finally { fs.rmSync(data.root, { recursive: true, force: true }); }
});
