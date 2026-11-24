import assert from 'node:assert/strict';
import test from 'node:test';
import { readTouchInteractionEnabled, touchServiceConfigUrl } from '../src/touch-service-status.mjs';

test('TouchService config endpoint follows the WebSocket host and port', () => {
  assert.equal(touchServiceConfigUrl('ws://127.0.0.1:20111/'), 'http://127.0.0.1:20111/config');
  assert.equal(touchServiceConfigUrl('wss://touch.example:2443/stream?token=x'), 'https://touch.example:2443/config');
  assert.throws(() => touchServiceConfigUrl('http://127.0.0.1:20111/'), /只支援 ws／wss/);
});

test('TouchService interaction status requires an explicit boolean from /config', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ interactionEnabled: false, touchMode: 'grid' }) };
  };
  assert.equal(await readTouchInteractionEnabled('ws://127.0.0.1:20111/', { fetchImpl }), false);
  assert.equal(calls[0].url, 'http://127.0.0.1:20111/config');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.cache, 'no-store');

  await assert.rejects(
    readTouchInteractionEnabled('ws://127.0.0.1:20111/', {
      fetchImpl: async () => ({ ok: true, json: async () => ({ touchMode: 'grid' }) })
    }),
    /缺少布林值 interactionEnabled/
  );
  await assert.rejects(
    readTouchInteractionEnabled('ws://127.0.0.1:20111/', {
      fetchImpl: async () => ({ ok: false, status: 404 })
    }),
    /HTTP 404/
  );
});
