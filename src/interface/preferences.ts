import type { AudioChannel, MainStyle, Preferences } from "./model";
import { languages } from "./model";
import type { LanguagePair } from "./controller";

type Saved = Record<string, any>;
/** Old workbench builds understand only studio/classic; keep their fallback. */
export function restoreDesign(settings: Saved): { mainStyle: MainStyle; navigation: Preferences["navigation"] } {
  const value = settings.design?.mainStyle;
  return {
    mainStyle: value === "poetry" || value === "workbench" || value === "classic" ? value : settings.uiLayout === "classic" ? "classic" : "workbench",
    navigation: settings.design?.navigation === "hover" ? "hover" : "persistent",
  };
}
export function restoreAudioLanguages(saved: unknown): Record<AudioChannel, LanguagePair | null> {
  const value = saved as Record<string, LanguagePair> | null;
  const valid = (channel: AudioChannel) => {
    const pair = value?.[channel];
    return pair && languages.some(([code]) => code === pair.src) && pair.tgt !== "auto" && languages.some(([code]) => code === pair.tgt)
      ? { src: pair.src, tgt: pair.tgt } : null;
  };
  return { system: valid("system"), mic: valid("mic") };
}
/** Preserve optional keys added by other versions while replacing known values. */
export function mergeSavedConfig(previous: Saved, current: Saved): Saved {
  const oldSettings = previous.settings ?? {};
  const settings = { ...oldSettings, ...current.settings };
  for (const key of ["translate", "subtitle", "clipboard", "audio", "design"]) {
    settings[key] = { ...oldSettings[key], ...current.settings?.[key] };
  }
  return { ...previous, ...current, settings };
}
export function actionInk(hex: string): string {
  const rgb = /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) : [0, 0, 0];
  const linear = rgb.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const light = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  return (light + .05) / .05 > 1.05 / (light + .05) ? "#171513" : "#ffffff";
}
