import { useEffect, type RefObject } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { navigationSurface, SurfaceAnimator } from "./nativeSurface";

export function useNativeSurface(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!isTauri() || !root.current) return;
    const element = root.current;
    let scheduled = 0;
    let disposed = false;
    let observedNav: HTMLElement | null = null;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const animator = new SurfaceAnimator(
      bounds => invoke("set_main_surface", { bounds }),
      () => new Promise(resolve => requestAnimationFrame(resolve)),
      () => performance.now(),
      error => console.error("Unable to update native drawer surface", error),
    );
    const measure = () => {
      const nav = element.querySelector<HTMLElement>(".navigation-capsule");
      const logo = nav?.querySelector<HTMLElement>(".navigation-logo");
      if (!nav || !logo) return;
      if (observedNav !== nav) {
        if (observedNav) size.unobserve(observedNav);
        observedNav = nav;
        size.observe(nav);
      }
      const full = { x: 0, y: 0, width: innerWidth, height: innerHeight, radius: 0 };
      const target = element.dataset.workspaceOpen === "true" ? null
        : navigationSurface(nav.getBoundingClientRect(), logo.getBoundingClientRect(),
          nav.dataset.expanded === "true", nav.dataset.variant === "poetry");
      if (target && (!target.width || !target.height)) return;
      animator.update(target, full, reduced.matches || element.dataset.motionInput === "keyboard" ? 0
        : element.dataset.workspaceOpen === "true" ? 240 : 160);
    };
    const schedule = () => { if (disposed) return; cancelAnimationFrame(scheduled); scheduled = requestAnimationFrame(measure); };
    const mutations = new MutationObserver(schedule);
    mutations.observe(element, { subtree: true, attributes: true,
      attributeFilter: ["data-expanded", "data-workspace-open", "data-style", "data-navigation"] });
    const size = new ResizeObserver(schedule);
    size.observe(element);
    window.addEventListener("resize", schedule);
    reduced.addEventListener("change", schedule);
    void document.fonts.ready.then(schedule);
    schedule();
    return () => {
      disposed = true; cancelAnimationFrame(scheduled); mutations.disconnect(); size.disconnect(); animator.dispose();
      window.removeEventListener("resize", schedule); reduced.removeEventListener("change", schedule);
      void invoke("set_main_surface", { bounds: null }).catch(console.error);
    };
  }, [root]);
}
