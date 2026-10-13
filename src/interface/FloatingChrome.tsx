import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "./Icon";

export function FloatingChrome(props: {
  title: string; icon: string; surface: "floating" | "audio" | "audioMic";
  ready: boolean; tone: "light" | "dark"; style: CSSProperties;
  actions?: ReactNode; settings?: ReactNode; error?: string; children: ReactNode;
  onClose: () => void; closeLabel: string;
}) {
  const drag = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button,input,select,a")) return;
    event.preventDefault();
    invoke("start_window_drag", { clientX: event.clientX, clientY: event.clientY }).catch(() => {});
  };
  return <div className="floating-root" data-tone={props.tone} style={{ ...props.style, visibility: props.ready ? "visible" : "hidden" }}>
    <section className="floating-card" aria-label={`${props.title}悬浮窗`}>
      <header className="floating-bar" onMouseDown={drag} title="拖动移动窗口；靠近其他悬浮窗边缘可拼接">
        <span className="floating-title"><Icon name={props.icon} size={15} />{props.title}</span>
        <div className="floating-actions" onMouseDown={event => event.stopPropagation()}>
          {props.actions}
          <button className="floating-close" title={props.closeLabel} aria-label={props.closeLabel} onClick={props.onClose}><Icon name="close" size={15} /></button>
        </div>
      </header>
      {props.settings && <div className="floating-settings">{props.settings}
        {props.error && <p className="floating-settings-error" role="alert">{props.error}</p>}
      </div>}
      <div className="floating-body">{props.children}</div>
      <div className="floating-resize-zone" onMouseDown={event => {
        if (event.button !== 0) return;
        event.stopPropagation(); event.preventDefault();
        invoke("floating_resize_begin", { kind: props.surface, clientX: event.clientX, clientY: event.clientY }).catch(() => {});
      }} title="拖动右下角调整窗口大小" />
    </section>
  </div>;
}

export function FloatingOpacity(props: { value: number; onChange: (value: number) => void }) {
  return <label className="floating-opacity"><span>共享透明度</span>
    <input type="range" min="0" max="100" value={Math.round(props.value)} onChange={event => props.onChange(Number(event.target.value))} />
    <output>{Math.round(props.value)}%</output>
  </label>;
}

export function FloatingHint(props: { icon: string; title: string; children: ReactNode }) {
  return <div className="floating-hint"><Icon name={props.icon} size={25} /><p>{props.title}</p><span>{props.children}</span></div>;
}
