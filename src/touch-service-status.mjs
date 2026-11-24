function statusError(message) {
  return new Error(`TouchService 狀態檢查失敗：${message}`);
}

export function touchServiceConfigUrl(webSocketUrl) {
  let url;
  try { url = new URL(webSocketUrl); }
  catch { throw statusError('WebSocket 位址無效'); }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw statusError('只支援 ws／wss WebSocket 位址');
  }
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/config';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export async function readTouchInteractionEnabled(webSocketUrl, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 1_000
} = {}) {
  if (typeof fetchImpl !== 'function') throw statusError('目前執行環境沒有 HTTP fetch');
  const endpoint = touchServiceConfigUrl(webSocketUrl);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw statusError(`無法讀取 /config（${error?.message ?? '連線失敗'}）`);
  }
  if (!response.ok) throw statusError(`/config 回應 HTTP ${response.status}`);

  let config;
  try { config = await response.json(); }
  catch { throw statusError('/config 未回傳有效 JSON'); }
  if (!config || typeof config !== 'object' || typeof config.interactionEnabled !== 'boolean') {
    throw statusError('/config 缺少布林值 interactionEnabled');
  }
  return config.interactionEnabled;
}
