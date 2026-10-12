import { useEffect, useLayoutEffect, useRef } from "react";
import { animateView } from "./viewMotion";

/** Stable page shell: task updates never replay a navigation transition. */
export function useViewMotion(view: string) {
  const page = useRef<HTMLElement>(null);
  const previousView = useRef(view);
  const animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    if (previousView.current === view || !page.current) return;
    previousView.current = view;
    page.current.scrollTop = 0;
    const keyboard = page.current.closest<HTMLElement>("[data-motion-input]")?.dataset.motionInput === "keyboard";
    animation.current = animateView(page.current, animation.current,
      keyboard || matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [view]);
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => { animation.current?.cancel(); animation.current = null; };
    const change = () => { if (reduced.matches) cancel(); };
    document.addEventListener("keydown", cancel, true);
    reduced.addEventListener("change", change);
    return () => { cancel(); document.removeEventListener("keydown", cancel, true); reduced.removeEventListener("change", change); };
  }, []);
  return page;
}
