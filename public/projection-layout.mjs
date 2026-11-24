export const PROJECTION_CANVAS = Object.freeze({ width: 2688, height: 3840 });
export const SERVICE_CANVAS_CROP = 512;
export const CAD_SCENE = Object.freeze({
  width: PROJECTION_CANVAS.height - SERVICE_CANVAS_CROP,
  height: PROJECTION_CANVAS.width
});

/** Fit the rotated CAD scene into the fixed TouchService projection canvas. */
export function calculateProjectionFit(viewportWidth, viewportHeight) {
  const width = Number(viewportWidth);
  const height = Number(viewportHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  const scale = Math.min(width / PROJECTION_CANVAS.width, height / PROJECTION_CANVAS.height);
  const canvasLeft = (width - PROJECTION_CANVAS.width * scale) / 2;
  const canvasTop = (height - PROJECTION_CANVAS.height * scale) / 2;

  return {
    scale,
    sceneWidth: CAD_SCENE.width,
    sceneHeight: CAD_SCENE.height,
    left: canvasLeft + (PROJECTION_CANVAS.width * scale) / 2,
    // CAD width is already the service height minus the 512 px blank tail.
    top: canvasTop + (CAD_SCENE.width * scale) / 2,
    outputWidth: PROJECTION_CANVAS.width * scale,
    outputHeight: PROJECTION_CANVAS.height * scale,
    sceneOutputWidth: CAD_SCENE.height * scale,
    sceneOutputHeight: CAD_SCENE.width * scale
  };
}
