const TOUCH_PROTOCOL_VERSION = 1;
const TOUCH_CELL_PIXEL_SIZE = { horizontal: { width: 16, height: 32 }, vertical: { width: 32, height: 16 } };
const TOUCH_PHASES = new Set(['down', 'move', 'up']);

function protocolError(message) {
  return new Error(`TouchService 協定錯誤：${message}`);
}

function expectedFaceGeometry(profile, index) {
  const face = profile.faces[index];
  const cellSize = TOUCH_CELL_PIXEL_SIZE[face.orientation];
  if (!cellSize) throw protocolError(`704 face ${index} 的 orientation 無效`);
  return {
    index,
    name: face.name,
    originX: face.originX,
    originY: face.originY,
    width: face.colCount * cellSize.width,
    height: face.rowCount * cellSize.height,
    cols: face.colCount,
    rows: face.rowCount,
    cellW: cellSize.width,
    cellH: cellSize.height
  };
}

export function validateTouchServiceHello(hello, profile) {
  if (!hello || hello.type !== 'hello') throw protocolError('缺少 hello');
  if (hello.v !== TOUCH_PROTOCOL_VERSION || hello.venue !== profile.venue) {
    throw protocolError('場域名稱或協定版本不符');
  }
  if (hello.canvas?.w !== profile.canvas.width || hello.canvas?.h !== profile.canvas.height) {
    throw protocolError('畫布尺寸與 704 場域設定不符');
  }
  if (!Number.isInteger(hello.releaseTimeoutMs) || hello.releaseTimeoutMs < 10 || hello.releaseTimeoutMs > 10_000) {
    throw protocolError('releaseTimeoutMs 必須是 10–10000 毫秒的整數');
  }
  if (!Array.isArray(hello.faces) || hello.faces.length !== profile.faces.length) {
    throw protocolError('感應面數量與 704 場域設定不符');
  }
  for (let index = 0; index < profile.faces.length; index++) {
    const actual = hello.faces[index];
    const expected = expectedFaceGeometry(profile, index);
    for (const [key, value] of Object.entries(expected)) {
      if (actual?.[key] !== value) {
        throw protocolError(`face ${index} 的 ${key} 與 704 場域設定不符`);
      }
    }
  }
  return true;
}

export class TouchFrameGuard {
  constructor(profile) {
    this.profile = profile;
    this.reset();
  }

  reset() {
    this.lastSequence = null;
    this.highestTouchId = null;
  }

  accept(frame) {
    if (!frame || frame.v !== TOUCH_PROTOCOL_VERSION || frame.venue !== this.profile.venue) {
      throw protocolError('frame 場域名稱或協定版本不符');
    }
    if (!Number.isSafeInteger(frame.seq) || frame.seq < 0) throw protocolError('frame seq 必須是非負安全整數');
    if (this.lastSequence !== null && frame.seq <= this.lastSequence) return false;
    if (frame.canvas?.w !== this.profile.canvas.width || frame.canvas?.h !== this.profile.canvas.height) {
      throw protocolError('frame 畫布尺寸與 704 場域設定不符');
    }
    if (!Array.isArray(frame.events) || !Array.isArray(frame.alive)) throw protocolError('frame 缺少 events 或 alive');

    const alive = new Set();
    for (const id of frame.alive) {
      if (!Number.isSafeInteger(id) || id < 0 || alive.has(id)) throw protocolError('alive 必須是唯一的非負 Touch ID 清單');
      alive.add(id);
    }

    const downIds = new Set();
    let highestDownId = this.highestTouchId;
    for (const event of frame.events) {
      if (!event || !Number.isSafeInteger(event.id) || event.id < 0) throw protocolError('event id 必須是非負安全整數');
      if (!TOUCH_PHASES.has(event.phase)) throw protocolError('event phase 無效');
      if (!Number.isInteger(event.face) || event.face < 0 || event.face >= this.profile.faces.length) {
        throw protocolError('event face 超出 704 場域範圍');
      }
      if (!Array.isArray(event.px) || event.px.length !== 2 ||
          !event.px.every((value) => Number.isFinite(value)) ||
          event.px[0] < 0 || event.px[0] > this.profile.canvas.width ||
          event.px[1] < 0 || event.px[1] > this.profile.canvas.height) {
        throw protocolError('event px 超出服務畫布');
      }
      if (event.phase === 'down') {
        if (downIds.has(event.id) || (this.highestTouchId !== null && event.id <= this.highestTouchId)) {
          throw protocolError('Touch ID 重複使用或未遞增');
        }
        downIds.add(event.id);
        highestDownId = highestDownId === null ? event.id : Math.max(highestDownId, event.id);
      }
    }

    this.lastSequence = frame.seq;
    this.highestTouchId = highestDownId;
    return true;
  }
}
