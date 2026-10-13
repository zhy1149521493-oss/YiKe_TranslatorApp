/** A brand is both a button and a handle: small presses remain clicks. */
export class BrandDragGesture {
  private origin: { x: number; y: number } | null = null;
  private dragged = false;
  press(x: number, y: number) { this.origin = { x, y }; this.dragged = false; }
  move(x: number, y: number): boolean {
    if (!this.origin || this.dragged || Math.hypot(x - this.origin.x, y - this.origin.y) < 5) return false;
    this.dragged = true;
    return true;
  }
  release() { this.origin = null; }
  consumeClick(): boolean { const value = this.dragged; this.dragged = false; return value; }
}
