import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDefaultDisplaySettings, createDisplaySettings, resolveDisplayPlan } from '../src/desktop/display-layout.mjs';
import { createInstanceHandoff, validateInstanceHandoff } from '../src/desktop/instance-handoff.mjs';
import { resolveOperationManualPath } from '../src/desktop/operation-manual.mjs';
import { calculateProjectionFit } from '../public/projection-layout.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const displays = [
  { id: 31, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, rotation: 0, scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { id: 74, bounds: { x: 1920, y: -240, width: 3840, height: 2160 }, rotation: 0, scaleFactor: 1.5, workArea: { x: 1920, y: -240, width: 3840, height: 2120 } }
];

test('new desktop launch hands off only to an existing executable with the same product filename', () => {
  const request = createInstanceHandoff('C:\\704-new\\704-Brain-Game.exe', [], { platform: 'win32' });
  const options = {
    platform: 'win32',
    currentExecPath: 'C:\\704-old\\704-Brain-Game.exe',
    existsSync: (candidate) => candidate === 'C:\\704-new\\704-Brain-Game.exe'
  };

  assert.deepEqual(validateInstanceHandoff(request, options), {
    ok: true,
    execPath: 'C:\\704-new\\704-Brain-Game.exe',
    args: []
  });
  assert.equal(validateInstanceHandoff({ ...request, execPath: 'C:\\704-new\\Other.exe' }, options).ok, false);
  assert.equal(validateInstanceHandoff({ ...request, execPath: 'C:\\missing\\704-Brain-Game.exe' }, options).ok, false);
  assert.equal(validateInstanceHandoff({ ...request, args: ['--disable-gpu'] }, options).ok, false);
  assert.equal(validateInstanceHandoff({ ...request, protocol: 'other-app' }, options).ok, false);
});

test('display assignment follows saved display IDs rather than enumeration order', () => {
  const settings = createDisplaySettings({ staffDisplayId: '31', gameDisplayId: '74' }, displays);
  const plan = resolveDisplayPlan(settings, [...displays].reverse(), 74);
  assert.equal(plan.mode, 'venue');
  assert.equal(plan.staffDisplay.id, 31);
  assert.equal(plan.gameDisplay.id, 74);
});

test('first launch automatically assigns primary to staff and first non-primary to projection', () => {
  const settings = createDefaultDisplaySettings(displays, 31);
  assert.equal(settings.staffDisplayId, '31');
  assert.equal(settings.gameDisplayId, '74');
  const plan = resolveDisplayPlan(settings, displays, 31);
  assert.equal(plan.mode, 'venue');
  assert.equal(plan.staffDisplay.id, 31);
  assert.equal(plan.gameDisplay.id, 74);
});

test('projection keeps the 2688×3840 TouchService canvas intact and fits without cropping', () => {
  const native = calculateProjectionFit(2688, 3840);
  assert.deepEqual(native, {
    scale: 1,
    sceneWidth: 3328,
    sceneHeight: 2688,
    left: 1344,
    top: 1664,
    outputWidth: 2688,
    outputHeight: 3840,
    sceneOutputWidth: 2688,
    sceneOutputHeight: 3328
  });

  const scaled = calculateProjectionFit(1920, 1080);
  assert.equal(scaled.scale, 1080 / 3840);
  assert.equal(scaled.outputWidth, 2688 * scaled.scale);
  assert.equal(scaled.outputHeight, 1080);
  assert.equal(scaled.sceneOutputWidth, 2688 * scaled.scale);
  assert.equal(scaled.sceneOutputHeight, 3328 * scaled.scale);
  assert.ok(scaled.left - scaled.sceneOutputWidth / 2 >= 0);
  assert.ok(scaled.top - scaled.sceneOutputHeight / 2 >= 0);
  assert.ok(scaled.left + scaled.sceneOutputWidth / 2 <= 1920);
  assert.ok(scaled.top + scaled.sceneOutputHeight / 2 <= 1080);
  assert.equal(calculateProjectionFit(0, 1080), null);
});

test('automatic display assignment stays in preview when there is no secondary screen', () => {
  assert.equal(createDefaultDisplaySettings([displays[0]], 31), null);
});

test('served staff page contains the live TouchService start guidance element', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/staff.html'), 'utf8');
  const client = fs.readFileSync(path.join(ROOT, 'public/staff.js'), 'utf8');
  assert.match(html, /id="start-session-help"/);
  assert.match(html, /id="diagnostics-release-timeout"/);
  assert.match(client, /\$\('#start-session-help'\)\.textContent/);
  assert.match(client, /data\.input\.releaseTimeoutMs/);
});

test('operation manual resolves from project docs in development and resources when packaged', () => {
  assert.equal(resolveOperationManualPath({ appRoot: 'C:/game' }), path.join('C:/game', 'docs', '704現場操作手冊_v1.md'));
  assert.equal(resolveOperationManualPath({ isPackaged: true, resourcesPath: 'C:/game/resources', appRoot: 'C:/game' }),
    path.join('C:/game/resources', '704-operation-manual.md'));
  assert.deepEqual(
    fs.readFileSync(path.join(ROOT, 'docs/704-operation-manual.md')),
    fs.readFileSync(path.join(ROOT, 'docs/704現場操作手冊_v1.md'))
  );
});

test('desktop staff page exposes an operation manual shortcut', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/staff.html'), 'utf8');
  const client = fs.readFileSync(path.join(ROOT, 'public/staff.js'), 'utf8');
  assert.match(html, /id="operation-manual"[^>]*>操作手冊/);
  assert.match(client, /window\.desktop\?\.openOperationManual\(\)/);
});

test('first run with multiple displays requests an explicit human assignment', () => {
  assert.deepEqual(resolveDisplayPlan(null, displays, 31), { mode: 'setup', reason: 'unconfigured' });
});

test('a single display uses development preview and records the missing output condition', () => {
  const plan = resolveDisplayPlan(null, [displays[0]], 31);
  assert.equal(plan.mode, 'preview');
  assert.equal(plan.reason, 'missing-game-display');
  assert.equal(plan.staffDisplay.id, 31);
  assert.equal(plan.gameDisplay.id, 31);
});

test('display assignments reject reuse of one physical screen for both windows', () => {
  assert.throws(() => createDisplaySettings({ staffDisplayId: '31', gameDisplayId: '31' }, displays), /不同螢幕/);
});

test('saved assignment requires the screen size, position, scale, and rotation to remain unchanged', () => {
  const settings = createDisplaySettings({ staffDisplayId: '31', gameDisplayId: '74' }, displays);
  const changed = structuredClone(displays);
  changed[1].bounds.width = 2560;
  assert.deepEqual(resolveDisplayPlan(settings, changed, 31), { mode: 'setup', reason: 'display-changed' });
});

test('disconnecting the assigned game screen requires reconfiguration', () => {
  const settings = createDisplaySettings({ staffDisplayId: '31', gameDisplayId: '74' }, displays);
  assert.deepEqual(resolveDisplayPlan(settings, [displays[0]], 31).mode, 'preview');
  assert.deepEqual(resolveDisplayPlan(settings, [displays[0], { ...displays[1], id: 75 }], 31), {
    mode: 'setup', reason: 'display-missing'
  });
});

test('sandbox preload exposes the desktop bridge through CommonJS and forwards its IPC contract', async () => {
  const preloadPath = path.join(ROOT, 'src/desktop/preload.cjs');
  const source = fs.readFileSync(preloadPath, 'utf8');
  const calls = [];
  const listeners = new Map();
  let exposed;
  const ipcRenderer = {
    invoke: async (...args) => { calls.push(args); return args; },
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => { if (listeners.get(channel) === listener) listeners.delete(channel); }
  };
  vm.runInNewContext(source, {
    require: (name) => {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (name, value) => { exposed = { name, value }; } },
        ipcRenderer
      };
    }
  }, { filename: preloadPath });

  assert.equal(exposed.name, 'desktop');
  assert.equal(exposed.value.isDesktop, true);
  await exposed.value.getDisplaySetup();
  await exposed.value.identifyDisplay(17);
  await exposed.value.saveDisplaySettings({ staffDisplayId: '31', gameDisplayId: '74' });
  await exposed.value.openOperationManual();
  assert.deepEqual(calls, [
    ['desktop:get-display-setup'],
    ['desktop:identify-display', '17'],
    ['desktop:save-display-settings', { staffDisplayId: '31', gameDisplayId: '74' }],
    ['desktop:open-operation-manual']
  ]);

  const warnings = [];
  const unsubscribe = exposed.value.onDisplayWarning((warning) => warnings.push(warning));
  listeners.get('desktop:display-warning')({}, '螢幕配置變更');
  unsubscribe();
  assert.deepEqual(warnings, ['螢幕配置變更']);
  assert.equal(listeners.has('desktop:display-warning'), false);
});
