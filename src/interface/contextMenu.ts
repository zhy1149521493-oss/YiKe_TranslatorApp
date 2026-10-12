export function menuPosition(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return { left: Math.max(8, Math.min(x, viewportWidth - width - 8)),
    top: Math.max(8, Math.min(y, viewportHeight - height - 8)) };
}

export function keepsEditingMenu(target: Element | null) {
  return Boolean(target?.closest('input, textarea, [contenteditable="true"]'));
}
