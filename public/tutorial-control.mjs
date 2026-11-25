export const TUTORIAL_BUTTON_DIAMETER = 560;

// A physical circle stays circular even though the floor's normalized axes differ.
export function tutorialHoldTarget(floorRect) {
  const width = TUTORIAL_BUTTON_DIAMETER / floorRect.width;
  const height = TUTORIAL_BUTTON_DIAMETER / floorRect.height;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height, shape: 'circle' };
}
