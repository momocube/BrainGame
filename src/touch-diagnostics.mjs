const DEFAULT_RECENT_LIMIT = 60;

function copyRect(value) {
  return value ? {
    x: value.x, y: value.y, width: value.width, height: value.height
  } : null;
}

/**
 * Keeps a short, in-memory view of TouchService coordinates for staff calibration.
 * Touch IDs and coordinates are never written to session history or operational logs.
 */
export class TouchDiagnostics {
  constructor({ canvas, zones, questionPanels = [], layout = null, reservedRects = [], faces = [], mapTouch, clock = Date.now, recentLimit = DEFAULT_RECENT_LIMIT }) {
    if (!canvas || !Array.isArray(zones) || typeof mapTouch !== 'function') {
      throw new Error('觸控診斷需要場域畫布、玩家區與座標映射函式');
    }
    this.canvas = { width: canvas.width, height: canvas.height };
    this.updateLayout({ zones, questionPanels, layout });
    this.reservedRects = reservedRects.map((item) => ({
      id: item.id, name: item.name, rect: copyRect(item.rect)
    }));
    this.faces = faces.map((face, index) => ({ index, name: face.name }));
    this.mapTouch = mapTouch;
    this.clock = clock;
    this.recentLimit = Math.max(1, Math.trunc(recentLimit));
    this.active = new Map();
    this.recent = [];
    this.frameSeq = null;
    this.lastFrameAt = null;
  }

  updateLayout({ zones = this.zones, questionPanels = this.questionPanels, layout = this.layout } = {}) {
    this.zones = zones.map((zone) => ({
      id: zone.id, name: zone.name, rotationDegrees: zone.rotationDegrees,
      rect: copyRect(zone.rect), sources: (zone.sources ?? []).map((source) => ({ ...source }))
    }));
    this.questionPanels = questionPanels.map((panel) => ({
      id: panel.id, playerId: panel.playerId, name: panel.name,
      rotationDegrees: panel.rotationDegrees, rect: copyRect(panel.rect)
    }));
    this.layout = layout ? { ...layout } : null;
  }

  accept(frame) {
    const receivedAt = this.clock();
    const events = [];
    for (const event of frame.events) {
      const mapped = this.mapTouch(event) ?? {};
      const point = {
        id: event.id,
        phase: event.phase,
        face: event.face,
        faceName: this.faces[event.face]?.name ?? `Face ${event.face}`,
        servicePx: [...event.px],
        cadPoint: mapped.cadPoint ? { x: mapped.cadPoint.x, y: mapped.cadPoint.y } : null,
        position: mapped.position ? {
          zoneId: mapped.position.zoneId, u: mapped.position.u, v: mapped.position.v
        } : null,
        receivedAt
      };
      events.push(point);
      if (event.phase === 'up') this.active.delete(String(event.id));
      else this.active.set(String(event.id), point);
    }

    const alive = new Set(frame.alive.map(String));
    for (const id of this.active.keys()) if (!alive.has(id)) this.active.delete(id);
    this.recent.push(...events);
    if (this.recent.length > this.recentLimit) this.recent.splice(0, this.recent.length - this.recentLimit);
    this.frameSeq = frame.seq;
    this.lastFrameAt = receivedAt;
  }

  clear() {
    this.active.clear();
    this.lastFrameAt = null;
  }

  reset() {
    this.clear();
    this.recent = [];
    this.frameSeq = null;
  }

  snapshot({ ready = false, detail = '尚未連線', releaseTimeoutMs = null, interactionEnabled = null } = {}) {
    return {
      canvas: { ...this.canvas },
      zones: this.zones.map((zone) => ({ ...zone, rect: { ...zone.rect }, sources: zone.sources.map((source) => ({ ...source })) })),
      questionPanels: this.questionPanels.map((panel) => ({ ...panel, rect: { ...panel.rect } })),
      layout: this.layout ? { ...this.layout } : null,
      reservedRects: this.reservedRects.map((item) => ({ ...item, rect: { ...item.rect } })),
      faces: this.faces.map((face) => ({ ...face })),
      input: { ready, detail, releaseTimeoutMs, interactionEnabled },
      frameSeq: this.frameSeq,
      lastFrameAt: this.lastFrameAt,
      active: [...this.active.values()].map((point) => ({ ...point, servicePx: [...point.servicePx] })),
      recent: this.recent.map((point) => ({ ...point, servicePx: [...point.servicePx] }))
    };
  }
}
