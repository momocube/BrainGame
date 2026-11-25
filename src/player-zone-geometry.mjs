const CAD_CROP_PX = 512;
import { resolvePlayerLayout } from './player-layouts.mjs';

function layoutError(message) {
  return new Error(`704 玩家區設定錯誤：${message}`);
}

function validRect(rect) {
  return rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) && Number.isFinite(rect.height) &&
    rect.width > 0 && rect.height > 0;
}

function inside(inner, outer) {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
}

function faceCadRect(face, profile) {
  const cellSize = face.orientation === 'vertical' ? { width: 32, height: 16 }
    : face.orientation === 'horizontal' ? { width: 16, height: 32 } : null;
  if (!cellSize) throw layoutError(`TouchService face ${face.name} 的 orientation 無效`);
  const serviceWidth = face.colCount * cellSize.width;
  const serviceHeight = face.rowCount * cellSize.height;
  return {
    x: profile.canvas.height - CAD_CROP_PX - face.originY - serviceHeight,
    y: face.originX,
    width: serviceHeight,
    height: serviceWidth
  };
}

/** Fail startup when a CAVE player area or its TouchService source can enter a reserved or invalid surface. */
export function validatePlayerZoneConfig(layout, touchProfile) {
  if (!layout || !touchProfile || !Array.isArray(layout.players) || !Array.isArray(touchProfile.faces)) {
    throw layoutError('缺少玩家區或 TouchService 場域設定');
  }
  if (!Number.isInteger(touchProfile.canvas?.width) || !Number.isInteger(touchProfile.canvas?.height) ||
      touchProfile.canvas.height <= CAD_CROP_PX) {
    throw layoutError('TouchService 畫布尺寸無效');
  }
  const expectedCanvas = {
    width: touchProfile.canvas.height - CAD_CROP_PX,
    height: touchProfile.canvas.width
  };
  if (layout.canvas?.width !== expectedCanvas.width || layout.canvas?.height !== expectedCanvas.height) {
    throw layoutError(`CAD 畫布必須為 ${expectedCanvas.width}×${expectedCanvas.height}`);
  }

  const bounds = { x: 0, y: 0, ...layout.canvas };
  const reservedRects = layout.reservedRects ?? [];
  for (const [index, item] of reservedRects.entries()) {
    if (!item?.id || !validRect(item.rect) || !inside(item.rect, bounds)) {
      throw layoutError(`入口保留區 ${index + 1} 的矩形無效或超出畫布`);
    }
  }

  const ignoredFaces = new Set(layout.ignoredFaces ?? []);
  const decorativeFaces = new Set(layout.decorativeFaces ?? []);
  const controlFaces = new Set(layout.controlFaces ?? []);
  const faceRects = touchProfile.faces.map((face) => faceCadRect(face, touchProfile));
  const playerIds = new Set();
  const displayRects = [];
  const sourceRects = [];
  const exitControl = layout.sharedExitControl;
  if (exitControl && (!Number.isInteger(exitControl.face) || !faceRects[exitControl.face] ||
      ignoredFaces.has(exitControl.face) || decorativeFaces.has(exitControl.face) ||
      ![0, 180].includes(exitControl.rotationDegrees ?? 0) ||
      !validRect(exitControl.rect) || !inside(exitControl.rect, faceRects[exitControl.face]))) {
    throw layoutError('共用退出按鈕必須位於有效牆面空白區');
  }
  if (exitControl && reservedRects.some((area) => overlaps(exitControl.rect, area.rect))) {
    throw layoutError('共用退出按鈕不可覆蓋入口保留區');
  }

  for (const player of layout.players) {
    if (!player?.id || playerIds.has(player.id)) throw layoutError(`玩家區 ID 無效或重複：${player?.id ?? ''}`);
    playerIds.add(player.id);
    if (![0, 90, 180, 270].includes(player.rotationDegrees)) {
      throw layoutError(`${player.id} 的旋轉角度必須為 0、90、180 或 270 度`);
    }
    if (!validRect(player.rect) || !inside(player.rect, bounds)) {
      throw layoutError(`${player.id} 顯示區無效或超出 CAD 畫布`);
    }
    for (const previous of displayRects) {
      if (overlaps(player.rect, previous.rect)) throw layoutError(`${player.id} 與 ${previous.id} 顯示區重疊`);
    }
    for (const reserved of reservedRects) {
      if (overlaps(player.rect, reserved.rect)) throw layoutError(`${player.id} 覆蓋入口保留區 ${reserved.id}`);
    }
    displayRects.push({ id: player.id, rect: player.rect });
    if (exitControl && overlaps(exitControl.rect, player.rect)) {
      throw layoutError(`共用退出按鈕與 ${player.id} 答題區重疊`);
    }

    if (!Array.isArray(player.sources) || !player.sources.length) {
      throw layoutError(`${player.id} 沒有 TouchService 輸入來源`);
    }
    for (const source of player.sources) {
      if (!Number.isInteger(source.face) || source.face < 0 || source.face >= touchProfile.faces.length) {
        throw layoutError(`${player.id} 的 TouchService face 無效`);
      }
      if (ignoredFaces.has(source.face) || decorativeFaces.has(source.face) || controlFaces.has(source.face)) {
        throw layoutError(`${player.id} 不可使用忽略或裝飾用 face 或共用控制面 ${source.face}`);
      }
      const rect = { x: source.x, y: source.y, width: source.width, height: source.height };
      if (!validRect(rect) || !inside(rect, faceRects[source.face])) {
        throw layoutError(`${player.id} 的 face ${source.face} 來源超出有效牆面`);
      }
      if (rect.x !== player.rect.x || rect.y !== player.rect.y ||
          rect.width !== player.rect.width || rect.height !== player.rect.height) {
        throw layoutError(`${player.id} 的觸控來源與顯示區沒有一對一對齊`);
      }
      for (const previous of sourceRects) {
        if (previous.face === source.face && overlaps(rect, previous.rect)) {
          throw layoutError(`${player.id} 的觸控來源與 ${previous.id} 重疊`);
        }
      }
      for (const reserved of reservedRects) {
        if (overlaps(rect, reserved.rect)) throw layoutError(`${player.id} 觸控來源覆蓋入口保留區 ${reserved.id}`);
      }
      sourceRects.push({ id: player.id, face: source.face, rect });
    }
  }

  if (layout.menuExtraZones?.length) {
    const { profilePlan, menuExtraZones, ...base } = layout;
    validatePlayerZoneConfig({ ...base, players: [...layout.players, ...menuExtraZones] }, touchProfile);
  }
  if (layout.profilePlan) {
    const { profilePlan, menuExtraZones, ...sharedConfig } = layout;
    for (const expectedCount of [4, 5, 6, 7, 8]) {
      const profile = resolvePlayerLayout({ ...sharedConfig, profilePlan }, expectedCount);
      if (profile.players.length !== expectedCount) {
        throw layoutError(`${expectedCount} 人版型必須剛好配置 ${expectedCount} 個答題區`);
      }
      if (profile.questionDisplayMode === 'player-panels' && profile.questionPanels.length !== expectedCount) {
        throw layoutError(`${expectedCount} 人版型的題目區必須與答題區一對一配置`);
      }
      if (profile.questionDisplayMode === 'floor' && profile.questionPanels.length) {
        throw layoutError(`${expectedCount} 人版型的題目只能顯示在地板區`);
      }
      validatePlayerZoneConfig({ ...sharedConfig, players: profile.players }, touchProfile);

      const profileBounds = { x: 0, y: 0, ...layout.canvas };
      const occupiedRects = profile.players.map((player) => ({ id: player.id, rect: player.rect }));
      const questionIds = new Set();
      for (const [index, panel] of profile.questionPanels.entries()) {
        if (!panel?.id || questionIds.has(panel.id) || panel.playerId !== profile.players[index]?.id) {
          throw layoutError(`${expectedCount} 人版型的題目區識別或玩家配對無效`);
        }
        questionIds.add(panel.id);
        if (exitControl && overlaps(exitControl.rect, panel.rect)) {
          throw layoutError(`共用退出按鈕與 ${panel.id} 題目區重疊`);
        }
        if (![0, 90, 180, 270].includes(panel.rotationDegrees) || !validRect(panel.rect) || !inside(panel.rect, profileBounds)) {
          throw layoutError(`${panel.id} 題目顯示區無效或超出 CAD 畫布`);
        }
        for (const reserved of reservedRects) {
          if (overlaps(panel.rect, reserved.rect)) throw layoutError(`${panel.id} 題目區覆蓋入口保留區 ${reserved.id}`);
        }
        if (!Number.isInteger(panel.face) || panel.face < 0 || panel.face >= touchProfile.faces.length ||
            !inside(panel.rect, faceRects[panel.face])) {
          throw layoutError(`${panel.id} 題目顯示區超出有效 CAVE 顯示面`);
        }
        if (ignoredFaces.has(panel.face) || decorativeFaces.has(panel.face) || controlFaces.has(panel.face)) {
          throw layoutError(`${panel.id} 題目顯示區不可使用忽略或裝飾用 face ${panel.face}`);
        }
        for (const previous of occupiedRects) {
          if (overlaps(panel.rect, previous.rect)) throw layoutError(`${panel.id} 題目區與 ${previous.id} 答題區重疊`);
        }
        occupiedRects.push({ id: panel.id, rect: panel.rect });
      }

      const floor = profile.floorRect;
      if (!floor || !Number.isInteger(floor.face) || floor.face < 0 || floor.face >= touchProfile.faces.length ||
          !validRect(floor.rect) || !inside(floor.rect, faceRects[floor.face])) {
        throw layoutError(`${expectedCount} 人版型的地板顯示區無效或超出有效 CAVE 顯示面`);
      }
      for (const reserved of reservedRects) {
        if (overlaps(floor.rect, reserved.rect)) throw layoutError(`地板顯示區覆蓋入口保留區 ${reserved.id}`);
      }
      for (const item of occupiedRects) {
        if (overlaps(floor.rect, item.rect)) throw layoutError(`地板顯示區與 ${item.id} 重疊`);
      }
    }
  }

  return true;
}
