import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./Icon";
import type { Preferences } from "./model";
import { BrandMark } from "./BrandMark";

/** Nonmodal page navigation disclosure; this is not a dialog or a menu role. */
export function NavigationCapsule({
  variant,
  behavior,
  brand,
  children,
  onBrand,
  workspaceOpen,
}: {
  variant: "poetry" | "workbench" | "classic";
  behavior: Preferences["navigation"];
  brand: ReactNode;
  children: ReactNode;
  onBrand: () => void;
  workspaceOpen: boolean;
}) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ref = useRef<HTMLElement>(null);
  const pressedExpanded = useRef(false);
  const pointerInside = useRef(false);
  const revealTime = useRef(-Infinity);
  const suppressClick = useRef(false);
  const [centerShift, setCenterShift] = useState(0);
  const [foldClip, setFoldClip] = useState("inset(0 100% 100% 0 round 21px)");
  const persistent = behavior === "persistent";
  const expanded = persistent || workspaceOpen || revealed || focused;
  const cancel = () => clearTimeout(timer.current);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    setRevealed(false);
    setFocused(false);
  }, [behavior]);
  useEffect(() => {
    if (!ref.current) return;
    const element = ref.current;
    const measure = () => {
      if (variant === "poetry")
        setCenterShift(
          Math.max(
            0,
            (element.getBoundingClientRect().width - 42) / 2 -
              parseFloat(getComputedStyle(element).paddingLeft),
          ),
        );
      else {
        const rect = element.getBoundingClientRect();
        const logo = element
          .querySelector<HTMLElement>(".navigation-logo")
          ?.getBoundingClientRect();
        if (logo && logo.width)
          setFoldClip(
            `inset(${Math.max(0, logo.top - rect.top)}px ${Math.max(0, rect.right - logo.right)}px ${Math.max(0, rect.bottom - logo.bottom)}px ${Math.max(0, logo.left - rect.left)}px round 21px)`,
          );
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [variant, behavior]);
  const enter = () => {
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    pointerInside.current = true;
    cancel();
    if (!expanded) revealTime.current = performance.now();
    setRevealed(true);
  };
  const Tag = variant === "workbench" ? "aside" : "header";
  const legacy =
    variant === "poetry"
      ? "poetry-toolbar"
      : variant === "workbench"
        ? "reading-rail"
        : "classic-capsule";
  return (
    <Tag
      ref={ref}
      className={`navigation-capsule ${legacy}`}
      data-variant={variant}
      data-expanded={expanded}
      data-behavior={behavior}
      data-workspace-open={workspaceOpen}
      style={
        variant !== "poetry"
          ? { clipPath: expanded ? "inset(0 0 0 0 round 0)" : foldClip }
          : undefined
      }
      onPointerEnter={() => {
        if (expanded) enter();
      }}
      onPointerLeave={() => {
        pointerInside.current = false;
        cancel();
        timer.current = setTimeout(() => setRevealed(false), 180);
      }}
      onPointerDownCapture={(event) => {
        // A mouse/touch press may focus a button without keyboard intent,
        // including a button that was already focused before the press.
        setFocused(false);
        suppressClick.current = false;
        // Poetry moves its centered logo left while revealing. A quick press at
        // the old logo position must not activate the task sliding underneath.
        if (event && variant === "poetry" && !persistent && !workspaceOpen
          && performance.now() - revealTime.current < 180) {
          const rect = ref.current?.getBoundingClientRect();
          if (rect && Math.abs(event.clientX - rect.x - rect.width / 2) <= 25
            && Math.abs(event.clientY - rect.y - rect.height / 2) <= 25) {
            suppressClick.current = true;
            event.preventDefault();
            event.stopPropagation();
          }
        }
      }}
      onClickCapture={event => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onFocusCapture={(event) => {
        // Focus pins navigation separately; it must not cancel a pending
        // pointer departure when a pointer action returns focus to the logo.
        const target = event.target as HTMLElement;
        setFocused(target.matches(":focus-visible"));
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false);
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !persistent &&
          expanded &&
          !workspaceOpen
        ) {
          event.stopPropagation();
          setFocused(false);
          setRevealed(false);
          ref.current
            ?.querySelector<HTMLButtonElement>(".navigation-brand")
            ?.focus();
          setFocused(false);
        }
      }}
    >
      <button
        className="navigation-brand"
        aria-label={
          persistent || workspaceOpen
            ? workspaceOpen
              ? "收起当前工作区"
              : "展开当前工作区"
            : "译刻导航"
        }
        aria-expanded={persistent || workspaceOpen ? workspaceOpen : expanded}
        aria-controls={
          persistent || workspaceOpen ? "translation-workspace" : id
        }
        onPointerEnter={enter}
        onPointerDown={() => {
          pressedExpanded.current = expanded;
        }}
        style={
          variant === "poetry"
            ? { transform: `translateX(${expanded ? 0 : centerShift}px)` }
            : undefined
        }
        onClick={(event) => {
          if (persistent || workspaceOpen) onBrand();
          else {
            cancel();
            const closing =
              !pointerInside.current &&
              (event.detail > 0 ? pressedExpanded.current : expanded);
            setRevealed(!closing);
            if (closing) {
              setFocused(false);
              ref.current
                ?.querySelector<HTMLButtonElement>(".navigation-brand")
                ?.blur();
            }
          }
        }}
      >
        <span className="navigation-logo">
          <BrandMark size={variant === "workbench" ? 32 : 30} />
        </span>
        <span className="navigation-brand-copy">{brand}</span>
      </button>
      <div
        id={id}
        className="navigation-reveal"
        inert={!expanded ? true : undefined}
        aria-hidden={!expanded ? true : undefined}
      >
        {children}
      </div>
    </Tag>
  );
}

/** Keep children mounted while closed so reading position and local controls survive. */
export function ContentDrawer({
  open,
  direction,
  className = "",
  children,
  onClose,
}: {
  open: boolean;
  direction: "down" | "right";
  className?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      id="translation-workspace"
      className={`content-drawer ${className}`}
      data-open={open}
      data-direction={direction}
      inert={!open ? true : undefined}
      aria-hidden={!open ? true : undefined}
    >
      <IconButton
        className="icon-button drawer-dismiss"
        icon="chevron"
        label="收起工作区（任务继续）"
        onClick={onClose}
      />
      {children}
    </div>
  );
}
