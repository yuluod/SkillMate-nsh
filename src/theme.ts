// 三套皮肤(ledger / standard / cardbox)× 明暗的主题资产。
// 颜色走 NSH 主题 token(setTheme 运行时切换),圆角/边框宽/阴影
// 是 token 之外的样式常量,随皮肤状态直接应用到 style。
import { setTheme } from "nsh";

export type Skin = "ledger" | "standard" | "cardbox";
export type ThemeMode = "system" | "light" | "dark";

type Adaptive = { light: string; dark: string };
type SkinColors = Record<string, Adaptive>;
type SkinStyle = { radius: number; borderWidth: number; shadow: Adaptive };
type SkinTones = { success: Adaptive; warn: Adaptive; error: Adaptive };

interface SkinDef {
  colors: SkinColors;
  tones: SkinTones;
  style: SkinStyle;
}

const LEDGER: SkinDef = {
  colors: {
    background: { light: "#efece2", dark: "#151821" },
    foreground: { light: "#20263a", dark: "#ede8db" },
    card: { light: "#faf8f0", dark: "#1b1f2a" },
    "card-foreground": { light: "#20263a", dark: "#ede8db" },
    muted: { light: "#faf8f0", dark: "#1b1f2a" },
    "muted-foreground": { light: "#5d5f72", dark: "#94917f" },
    primary: { light: "#2450c4", dark: "#7d9ff2" },
    "primary-foreground": { light: "#ffffff", dark: "#151821" },
    accent: { light: "#1b3f9e", dark: "#93b0f5" },
    border: { light: "#c6bfa9", dark: "#333949" },
    sidebar: { light: "#faf8f0", dark: "#1b1f2a" },
  },
  tones: {
    success: { light: "#25714c", dark: "#5cba8e" },
    warn: { light: "#8f5a10", dark: "#d9a04e" },
    error: { light: "#b23327", dark: "#e0695b" },
  },
  style: { radius: 4, borderWidth: 1, shadow: { light: "0 2px 8px rgba(60,54,38,.14)", dark: "0 3px 10px rgba(0,0,0,.3)" } },
};

const STANDARD: SkinDef = {
  colors: {
    background: { light: "#f3f6fa", dark: "#0f141d" },
    foreground: { light: "#101828", dark: "#f4f7fb" },
    card: { light: "#ffffff", dark: "#161b22" },
    "card-foreground": { light: "#101828", dark: "#f4f7fb" },
    muted: { light: "#ffffff", dark: "#161b22" },
    "muted-foreground": { light: "#646b78", dark: "#96a2b0" },
    primary: { light: "#2563eb", dark: "#6ea8ff" },
    "primary-foreground": { light: "#ffffff", dark: "#0f141d" },
    accent: { light: "#2f4ecf", dark: "#79b8ff" },
    border: { light: "#e5e7eb", dark: "#232a33" },
    sidebar: { light: "#ffffff", dark: "#161b22" },
  },
  tones: {
    success: { light: "#1c7f4f", dark: "#3fb950" },
    warn: { light: "#8a6011", dark: "#d29922" },
    error: { light: "#d65346", dark: "#f47067" },
  },
  style: { radius: 10, borderWidth: 1, shadow: { light: "0 4px 12px rgba(15,23,42,.08)", dark: "0 4px 12px rgba(0,0,0,.22)" } },
};

const CARDBOX: SkinDef = {
  colors: {
    background: { light: "#ffffff", dark: "#101010" },
    foreground: { light: "#0a0a0a", dark: "#f4f4f4" },
    card: { light: "#f5f5f5", dark: "#171717" },
    "card-foreground": { light: "#0a0a0a", dark: "#f4f4f4" },
    muted: { light: "#f5f5f5", dark: "#171717" },
    "muted-foreground": { light: "#585858", dark: "#969696" },
    primary: { light: "#1d43c8", dark: "#8fa9ff" },
    "primary-foreground": { light: "#ffffff", dark: "#101010" },
    accent: { light: "#132f92", dark: "#aebfff" },
    border: { light: "#0a0a0a", dark: "#d6d6d6" },
    sidebar: { light: "#f0f0f0", dark: "#171717" },
  },
  tones: {
    success: { light: "#1c6b45", dark: "#63c795" },
    warn: { light: "#8a6011", dark: "#e0a55b" },
    error: { light: "#b23327", dark: "#ff7a6b" },
  },
  style: { radius: 0, borderWidth: 2, shadow: { light: "3px 3px 0 rgba(10,10,10,.85)", dark: "3px 3px 0 rgba(214,214,214,.55)" } },
};

export const SKINS: Record<Skin, SkinDef> = {
  ledger: LEDGER,
  standard: STANDARD,
  cardbox: CARDBOX,
};

// system 模式分别给 light/dark 两行;显式 light/dark 时合并进 theme(两种外观同值)。
export function buildNshTheme(skin: Skin, mode: ThemeMode): { cssVars: { theme?: Record<string, string>; light?: Record<string, string>; dark?: Record<string, string> } } {
  const colors = SKINS[skin].colors;
  const row = (appearance: "light" | "dark"): Record<string, string> => {
    const flat: Record<string, string> = {};
    for (const [name, value] of Object.entries(colors)) {
      flat[name] = value[appearance];
    }
    return flat;
  };
  if (mode === "system") {
    return { cssVars: { light: row("light"), dark: row("dark") } };
  }
  return { cssVars: { theme: row(mode) } };
}

export function applyTheme(skin: Skin, mode: ThemeMode): void {
  setTheme(buildNshTheme(skin, mode));
}

export function skinStyle(skin: Skin): SkinStyle {
  return SKINS[skin].style;
}

// 状态色作为皮肤常量(皮肤与模式都是 signal,切换即重渲染)。
// system 模式下取 light 行,深色外观的核验以 nsh run 实机为准。
export function toneColor(skin: Skin, tone: "success" | "warn" | "error", mode: ThemeMode): string {
  const appearance = mode === "dark" ? "dark" : "light";
  return SKINS[skin].tones[tone][appearance];
}

// Storage 在 NSH 中无需能力声明;不存在时静默跳过持久化。
const store = (globalThis as { Storage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).Storage;

export function persisted(key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function persist(key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // 持久化失败不影响本次会话
  }
}
