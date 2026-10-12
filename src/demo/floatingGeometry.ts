/** Browser work-area proxy; native monitor work areas are connected after acceptance. */
export function dockSide(
  x: number,
  width: number,
  workAreaWidth: number,
): "left" | "right" | null {
  if (x <= 24) return "left";
  if (x + width >= workAreaWidth - 24) return "right";
  return null;
}
