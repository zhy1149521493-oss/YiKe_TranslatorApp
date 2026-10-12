/** Continue from the displayed frame instead of restarting a rapid switch. */
export function animateView(element: HTMLElement, previous: Animation | null, instant: boolean): Animation | null {
  const interrupted = previous?.playState === "running";
  const style = getComputedStyle(element);
  const opacity = interrupted ? style.opacity : ".78";
  previous?.cancel();
  if (instant || typeof element.animate !== "function") return null;
  return element.animate([{ opacity }, { opacity: "1" }], {
    duration: 180,
    easing: style.getPropertyValue("--ease-out").trim() || "cubic-bezier(0.23, 1, 0.32, 1)",
  });
}
