// 全局应用状态:signal 即状态,动作函数负责数据装载与选择。
// 注意:NSH 的响应式只追踪 JSX 表达式求值链上的 signal 读取,
// 组件函数体是纯 setup——所有读取必须发生在从 JSX 调用的渲染函数里。
import { signal } from "nsh";
import { setLocale } from "nsh/i18n";
import { Library } from "skillmate/native";
import { applyTheme, persist, persisted, type Skin, type ThemeMode } from "./theme";
import { buildUniqueSkillInventory } from "./lib/inventory";

export type ViewId = "dashboard" | "skills" | "assistants" | "scenarios" | "settings";
export type SkillFilter = "all" | "notEnabled" | "updates" | "needsAttention";

export const view = signal<ViewId>("dashboard");
export const dashboard = signal<Record<string, any> | null>(null);
export const loading = signal(false);
export const loadError = signal("");
export const query = signal("");
export const filter = signal<SkillFilter>("all");
export const selectedIdentity = signal("");
export const detail = signal<{ readme: string; validation: Record<string, any> | null; error: string } | null>(null);
export const detailLoading = signal(false);
export const tags = signal<Record<string, any>[]>([]);
export const scenarios = signal<Record<string, any>[]>([]);

const storedSkin = persisted("skillmate-skin");
const storedMode = persisted("skillmate-theme-mode");
const storedLang = persisted("skillmate-language");

export const skin = signal<Skin>(storedSkin === "standard" || storedSkin === "cardbox" ? storedSkin : "ledger");
export const mode = signal<ThemeMode>(
  storedMode === "light" || storedMode === "dark" ? storedMode : "system",
);
export const language = signal<"zh-CN" | "en">(storedLang === "en" ? "en" : "zh-CN");

export function setSkin(next: Skin): void {
  skin.set(next);
  persist("skillmate-skin", next);
  applyTheme(next, mode());
}

export function setMode(next: ThemeMode): void {
  mode.set(next);
  persist("skillmate-theme-mode", next);
  applyTheme(skin(), next);
}

export function setLanguage(next: "zh-CN" | "en"): void {
  language.set(next);
  persist("skillmate-language", next);
  setLocale(next);
}

export function replaceScenarios(items: Record<string, any>[]): void {
  scenarios.set(items);
}

// 统一清单行(含库内 Skill),供 flows 层批量标签等动作使用。
export function allSkillRows(): Record<string, any>[] {
  const data = dashboard();
  if (!data) return [];
  return [
    ...buildUniqueSkillInventory(data.assistants ?? []),
    ...(data.library_skills ?? []),
  ];
}

export async function refresh(): Promise<void> {
  loading.set(true);
  loadError.set("");
  try {
    const data = await Library.loadDashboard();
    dashboard.set(data as unknown as Record<string, any>);
    Library.getAllTags()
      .then((items) => tags.set(items as unknown as Record<string, any>[]))
      .catch(() => tags.set([]));
    Library.getScenarios()
      .then((items) => scenarios.set(items as unknown as Record<string, any>[]))
      .catch(() => scenarios.set([]));
  } catch (error) {
    loadError.set(error instanceof Error ? error.message : String(error));
  } finally {
    loading.set(false);
  }
}

export async function openDetail(path: string): Promise<void> {
  console.log("openDetail called:", path);
  selectedIdentity.set(path);
  detail.set(null);
  detailLoading.set(true);
  try {
    const readme = await Library.getSkillReadme(path);
    let validation: Record<string, any> | null = null;
    try {
      validation = JSON.parse(await Library.inspectSkillValidation(path));
    } catch {
      validation = null;
    }
    detail.set({ readme, validation, error: "" });
  } catch (error) {
    detail.set({ readme: "", validation: null, error: error instanceof Error ? error.message : String(error) });
  } finally {
    detailLoading.set(false);
  }
}

// 启动即应用持久化的主题与语言,并做启动维护(迁移/事务恢复)。
applyTheme(skin(), mode());
setLocale(language());
void Library.initialize();
void refresh();
