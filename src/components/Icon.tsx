// 图标:phosphor SVG(regular)经 tintColor 跟随主题色;
// 品牌图标来自原 SkillMate 的 src/assets/brands(彩色,不做滤色)。
import { Image, token, type ImageAsset } from "nsh";
import dashboard from "../assets/icons/dashboard.svg";
import skills from "../assets/icons/skills.svg";
import assistants from "../assets/icons/assistants.svg";
import scenarios from "../assets/icons/scenarios.svg";
import settings from "../assets/icons/settings.svg";
import refresh from "../assets/icons/refresh.svg";
import search from "../assets/icons/search.svg";
import arrow from "../assets/icons/arrow.svg";
import plus from "../assets/icons/plus.svg";
import check from "../assets/icons/check.svg";
import shield from "../assets/icons/shield.svg";
import edit from "../assets/icons/edit.svg";
import unlink from "../assets/icons/unlink.svg";
import updates from "../assets/icons/updates.svg";
import branch from "../assets/icons/branch.svg";
import appIcon from "../assets/app-icon.png";
import claude from "../assets/brands/claude.svg";
import codexOpenai from "../assets/brands/codex-openai.svg";
import copilot from "../assets/brands/copilot.svg";
import cursor from "../assets/brands/cursor.svg";
import cursorPng from "../assets/brands/cursor.png";
import deepseek from "../assets/brands/deepseek.png";
import devin from "../assets/brands/devin.svg";
import gemini from "../assets/brands/gemini.svg";
import kimi from "../assets/brands/kimi.png";
import openclaw from "../assets/brands/openclaw.svg";
import opencode from "../assets/brands/opencode.svg";
import rooCode from "../assets/brands/roo-code.svg";
import vscode from "../assets/brands/vscode.svg";
import windsurf from "../assets/brands/windsurf.svg";
import zcode from "../assets/brands/zcode.png";
import zed from "../assets/brands/zed.png";

const ICONS: Record<string, ImageAsset> = {
  dashboard,
  skills,
  assistants,
  scenarios,
  settings,
  refresh,
  search,
  arrow,
  plus,
  check,
  shield,
  edit,
  unlink,
  updates,
  branch,
};

// 应用自身 logo(彩色)。
export function AppLogo(props: { size?: number }) {
  return <Image src={appIcon} style={{ width: props.size ?? 22, height: props.size ?? 22 }} />;
}

const BRANDS: Record<string, ImageAsset> = {
  claude,
  "codex-openai": codexOpenai,
  copilot,
  cursor: cursorPng,
  deepseek,
  devin,
  gemini,
  kimi,
  openclaw,
  opencode,
  "roo-code": rooCode,
  vscode,
  windsurf,
  zcode,
  zed,
};

// 单色 UI 图标;tintColor 在 style 表达式里读取 token,主题切换即换色。
export function Icon(props: { name: string; size?: number; color?: string }) {
  const src = ICONS[props.name];
  if (!src) return null;
  const size = props.size ?? 16;
  return (
    <Image
      src={src}
      style={{ width: size, height: size, tintColor: props.color ?? token("muted-foreground") }}
    />
  );
}

// 助手品牌图标(彩色,按 icon 字段名匹配)。
export function BrandIcon(props: { name: string; size?: number }) {
  const src = BRANDS[props.name];
  if (!src) return null;
  const size = props.size ?? 16;
  return <Image src={src} style={{ width: size, height: size }} />;
}
