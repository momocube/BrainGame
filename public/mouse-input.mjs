export function installMouseInput(venue, getContext, reportError) {
  let pointer = null;
  let queue = Promise.resolve();
  const send = (phase, event, context) => {
    const rect = venue.getBoundingClientRect();
    const px = [(event.clientX - rect.left) / rect.width * 2688,
      (event.clientY - rect.top) / rect.height * 3328];
    const payload = { phase, px, clientId: context.clientId, phaseRevision: context.revision };
    queue = queue.then(async () => {
      const response = await fetch('/api/mouse-input', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error((await response.json()).error ?? '滑鼠操作失敗');
    }).catch((error) => reportError(error.message));
  };
  venue.addEventListener('pointerdown', (event) => {
    const context = getContext();
    if (!context.clientId || event.pointerType !== 'mouse' || event.button !== 0 || pointer) return;
    event.preventDefault();
    pointer = { id: event.pointerId, ...context };
    venue.setPointerCapture(event.pointerId);
    send('down', event, pointer);
  });
  venue.addEventListener('pointermove', (event) => {
    if (pointer?.id === event.pointerId) send('move', event, pointer);
  });
  const finish = (event, phase) => {
    if (pointer?.id !== event.pointerId) return;
    send(phase, event, pointer);
    pointer = null;
    if (venue.hasPointerCapture(event.pointerId)) venue.releasePointerCapture(event.pointerId);
  };
  venue.addEventListener('pointerup', (event) => finish(event, 'up'));
  venue.addEventListener('pointercancel', (event) => finish(event, 'cancel'));
  venue.addEventListener('lostpointercapture', (event) => finish(event, 'cancel'));
  window.addEventListener('blur', () => {
    if (pointer) finish({ pointerId: pointer.id }, 'cancel');
  });
}
