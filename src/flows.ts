// 全局浮层与写流程状态:toast、确认弹窗、撤销条、安装/启用弹窗、更新预览弹窗。
// 全部走「组件壳 + render*(JSX 链上读 signal)」模式。
import { signal } from "nsh";

// 缺键回退:rust-i18n 缺失时返回 <locale>.<key>,据此落到原文。
export function tt(key: string, fallback: string): string {
  const value = t(key);
  return value.includes(key) ? fallback : value;
}
import { t } from "nsh/i18n";
import { api, type InstallPreview, type InstallResult, type TrashReceipt, type UpdatePreview } from "./lib/api";
import { refresh } from "./state";

// ---- toast ----
export const toast = signal<{ text: string; tone: "info" | "error" } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(text: string, tone: "info" | "error" = "info"): void {
  toast.set({ text, tone });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.set(null), 4200);
}

// ---- 确认弹窗 ----
interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
}
export const confirmState = signal<ConfirmRequest | null>(null);
export const confirmBusy = signal(false);

export function requestConfirm(request: ConfirmRequest): void {
  confirmState.set(request);
}

export async function settleConfirm(): Promise<void> {
  const request = confirmState();
  if (!request || confirmBusy()) return;
  confirmBusy.set(true);
  try {
    await request.onConfirm();
    confirmState.set(null);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    confirmBusy.set(false);
  }
}

// ---- 撤销条 ----
export const undoBar = signal<{ receipt: TrashReceipt; timer: ReturnType<typeof setTimeout> } | null>(null);

export function showUndoBar(receipt: TrashReceipt): void {
  const previous = undoBar();
  if (previous) {
    clearTimeout(previous.timer);
    void api.purgeTrashedSkill(previous.receipt.token).catch(() => undefined);
  }
  const timer = setTimeout(() => {
    const current = undoBar();
    if (current?.receipt.token === receipt.token) {
      void api.purgeTrashedSkill(receipt.token).catch(() => undefined);
      undoBar.set(null);
    }
  }, 8000);
  undoBar.set({ receipt, timer });
}

export async function undoTrash(): Promise<void> {
  const current = undoBar();
  if (!current) return;
  clearTimeout(current.timer);
  undoBar.set(null);
  try {
    await api.restoreTrashedSkill(current.receipt.token);
    showToast(tt("toast.restored", "已恢复"));
    await refresh();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  }
}

// ---- 安装/启用流程(添加与启用共用;plan_token 两段式) ----
export interface InstallFlowContext {
  workflow: "add" | "enable";
  source: string;
  packageValue: string;
  assistantName: string;
  installMode: string;
  projectPath: string;
  preferredSkillId: string;
}

export const installOpen = signal(false);
export const installContext = signal<InstallFlowContext>({
  workflow: "add", source: "local", packageValue: "", assistantName: "", installMode: "library", projectPath: "", preferredSkillId: "",
});
export const installPreview = signal<InstallPreview | null>(null);
export const installPreviewing = signal(false);
export const installApplying = signal(false);
export const installError = signal("");

export function openInstallFlow(workflow: "add" | "enable", initial: Partial<InstallFlowContext> = {}): void {
  installContext.set({
    workflow,
    source: initial.source ?? "local",
    packageValue: initial.packageValue ?? "",
    assistantName: initial.assistantName ?? "",
    installMode: initial.installMode ?? (workflow === "add" ? "library" : "symlink"),
    projectPath: initial.projectPath ?? "",
    preferredSkillId: initial.preferredSkillId ?? "",
  });
  installPreview.set(null);
  installError.set("");
  installOpen.set(true);
}

export function closeInstallFlow(): void {
  if (installApplying()) return;
  installOpen.set(false);
}

function previewStale(context: InstallFlowContext, preview: InstallPreview | null): boolean {
  return !preview || preview.plan_token.length === 0;
}

export async function runInstallPreview(): Promise<void> {
  if (installPreviewing() || installApplying()) return;
  const context = installContext();
  const packageValue = context.packageValue.trim();
  if (!packageValue || !context.assistantName) {
    installError.set(tt("install.needInput", "请填写来源与目标助手"));
    return;
  }
  installPreviewing.set(true);
  installError.set("");
  try {
    const preview = await api.previewInstallSkill({
      package: packageValue,
      source: context.source,
      assistantName: context.assistantName,
      installMode: context.installMode,
      projectPath: context.projectPath,
      preferredSkillId: context.preferredSkillId,
    });
    installPreview.set(preview);
  } catch (error) {
    installError.set(error instanceof Error ? error.message : String(error));
  } finally {
    installPreviewing.set(false);
  }
}

export async function runInstallApply(): Promise<InstallResult | null> {
  const context = installContext();
  const preview = installPreview();
  if (installApplying() || !preview || previewStale(context, preview)) return null;
  installApplying.set(true);
  installError.set("");
  try {
    const result = await api.installSkill({
      package: context.packageValue.trim(),
      source: context.source,
      assistantName: context.assistantName,
      installMode: context.installMode,
      projectPath: context.projectPath,
      preferredSkillId: context.preferredSkillId,
      planToken: preview.plan_token,
    });
    installOpen.set(false);
    showToast(result.message, result.success ? "info" : "error");
    await refresh();
    return result;
  } catch (error) {
    installError.set(error instanceof Error ? error.message : String(error));
    return null;
  } finally {
    installApplying.set(false);
  }
}

// ---- 更新预览流程 ----
export const updatePreviewState = signal<{ path: string; name: string; preview: UpdatePreview } | null>(null);
export const updateApplying = signal(false);

export async function openUpdatePreview(path: string, name: string): Promise<void> {
  try {
    const preview = await api.previewSkillUpdate(path);
    updatePreviewState.set({ path, name, preview });
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  }
}

export async function applyUpdate(): Promise<void> {
  const state = updatePreviewState();
  if (!state || updateApplying() || !state.preview.canApply) return;
  updateApplying.set(true);
  try {
    const message = await api.updateFromUpstream(state.path, state.preview.planToken);
    updatePreviewState.set(null);
    showToast(message, "info");
    await refresh();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    updateApplying.set(false);
  }
}

// ---- 接管流程 ----
export const adoptOpen = signal(false);
export const adoptPath = signal("");
export const adoptAssistant = signal("");
export const adoptPreview = signal<InstallPreview | null>(null);
export const adoptPreviewing = signal(false);
export const adoptApplying = signal(false);
export const adoptError = signal("");

export function openAdoptFlow(): void {
  adoptPath.set("");
  adoptAssistant.set("");
  adoptPreview.set(null);
  adoptError.set("");
  adoptOpen.set(true);
}

export async function runAdoptPreview(): Promise<void> {
  if (adoptPreviewing() || adoptApplying()) return;
  if (!adoptPath().trim() || !adoptAssistant().trim()) {
    adoptError.set(tt("adopt.needInput", "请填写目录与目标助手"));
    return;
  }
  adoptPreviewing.set(true);
  adoptError.set("");
  try {
    adoptPreview.set(await api.previewAdoptSkill(adoptPath().trim(), adoptAssistant().trim(), null));
  } catch (error) {
    adoptError.set(error instanceof Error ? error.message : String(error));
  } finally {
    adoptPreviewing.set(false);
  }
}

export async function runAdoptApply(): Promise<void> {
  const preview = adoptPreview();
  if (adoptApplying() || !preview?.can_apply) return;
  adoptApplying.set(true);
  try {
    const result = await api.adoptSkill(adoptPath().trim(), adoptAssistant().trim(), null, preview.plan_token);
    adoptOpen.set(false);
    showToast(result.message, result.success ? "info" : "error");
    await refresh();
  } catch (error) {
    adoptError.set(error instanceof Error ? error.message : String(error));
  } finally {
    adoptApplying.set(false);
  }
}

// ---- 标签管理 ----
export const tagManagerOpen = signal(false);
export const tagNameDraft = signal("");
export const tagColorDraft = signal("#2450c4");
export const tagBusy = signal(false);

export const TAG_COLORS = ["#2450c4", "#1c7f4f", "#8a6011", "#b23327", "#6d28d9", "#0e7490", "#52525b", "#b45309"];

export function openTagManager(): void {
  console.log("openTagManager called");
  tagNameDraft.set("");
  tagColorDraft.set(TAG_COLORS[0]);
  tagManagerOpen.set(true);
}

export async function createTag(): Promise<void> {
  if (tagBusy() || !tagNameDraft().trim()) return;
  tagBusy.set(true);
  try {
    await api.addTag(tagNameDraft().trim(), tagColorDraft());
    tagNameDraft.set("");
    showToast(tt("tags.created", "标签已创建"));
    await refresh();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    tagBusy.set(false);
  }
}

export function deleteTagConfirm(tagId: string, name: string): void {
  requestConfirm({
    title: tt("tags.deleteTitle", "删除标签"),
    body: name,
    confirmLabel: tt("tags.delete", "删除"),
    danger: true,
    onConfirm: async () => {
      await api.deleteTag(tagId);
      showToast(tt("tags.deleted", "已删除"));
      await refresh();
    },
  });
}

// ---- 批量标签编辑器(套用/移除到所选 Skill) ----
export const tagEditorOpen = signal(false);
export const tagEditorSelection = signal<string[]>([]);
export const tagEditorBusy = signal(false);

export function openTagEditor(paths: string[]): void {
  tagEditorSelection.set(paths);
  tagEditorOpen.set(true);
}

export async function applyTagsToSelection(tagName: string, remove: boolean): Promise<void> {
  if (tagEditorBusy() || !tagName) return;
  tagEditorBusy.set(true);
  const { allSkillRows } = await import("./state");
  try {
    const rows = allSkillRows();
    let applied = 0;
    for (const row of rows) {
      if (!tagEditorSelection().includes(row.path)) continue;
      const current: string[] = Array.isArray(row.tags) ? row.tags : [];
      const next = remove
        ? current.filter((tag) => tag !== tagName)
        : [...new Set([...current, tagName])];
      await api.updateSkillTags(row.path, next);
      applied += 1;
    }
    showToast(
      remove
        ? tt("tags.removedFrom", "已从 %{count} 项移除标签").replace("%{count}", String(applied))
        : tt("tags.appliedTo", "已为 %{count} 项添加标签").replace("%{count}", String(applied)),
    );
    tagEditorOpen.set(false);
    await refresh();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    tagEditorBusy.set(false);
  }
}

// ---- 新建场景 ----
export const scenarioCreateOpen = signal(false);
export const scenarioNameDraft = signal("");
export const scenarioDescDraft = signal("");
export const scenarioSelected = signal<string[]>([]);
export const scenarioBusy = signal(false);

export function openScenarioCreate(selected: string[] = []): void {
  scenarioNameDraft.set("");
  scenarioDescDraft.set("");
  scenarioSelected.set(selected);
  scenarioCreateOpen.set(true);
}

export async function createScenarioNow(): Promise<void> {
  if (scenarioBusy() || !scenarioNameDraft().trim()) return;
  scenarioBusy.set(true);
  try {
    await api.createScenario(scenarioNameDraft().trim(), scenarioDescDraft().trim(), scenarioSelected());
    scenarioCreateOpen.set(false);
    showToast(tt("scenarios.created", "场景已创建"));
    await refresh();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    scenarioBusy.set(false);
  }
}

// ---- 导入库预览摘要(对齐原版 summary.import.*) ----
export interface ImportSummary {
  replace_existing: boolean;
  tags_to_add: number;
  tags_to_replace: number;
  scenarios_to_add: number;
  scenarios_to_replace: number;
  skill_tag_writes: number;
  existing_tags_to_remove: number;
  existing_scenarios_to_remove: number;
  existing_skill_tag_mappings_to_remove: number;
  plan_token: string;
}

export function buildImportSummaryLines(preview: ImportSummary): string[] {
  const lines: string[] = [];
  if (preview.replace_existing) {
    if (preview.existing_tags_to_remove > 0) {
      lines.push(tt("summary.import.removeTags", "将清空现有 %{count} 个标签").replace("%{count}", String(preview.existing_tags_to_remove)));
    }
    if (preview.existing_scenarios_to_remove > 0) {
      lines.push(tt("summary.import.removeScenarios", "将清空现有 %{count} 个组合").replace("%{count}", String(preview.existing_scenarios_to_remove)));
    }
    if (preview.existing_skill_tag_mappings_to_remove > 0) {
      lines.push(tt("summary.import.removeMappings", "将清空现有 %{count} 条 Skill 标签映射").replace("%{count}", String(preview.existing_skill_tag_mappings_to_remove)));
    }
  }
  if (preview.tags_to_add > 0) lines.push(tt("summary.import.addTags", "将新增 %{count} 个标签").replace("%{count}", String(preview.tags_to_add)));
  if (preview.tags_to_replace > 0) lines.push(tt("summary.import.replaceTags", "将覆盖 %{count} 个标签").replace("%{count}", String(preview.tags_to_replace)));
  if (preview.scenarios_to_add > 0) lines.push(tt("summary.import.addScenarios", "将新增 %{count} 个组合").replace("%{count}", String(preview.scenarios_to_add)));
  if (preview.scenarios_to_replace > 0) lines.push(tt("summary.import.replaceScenarios", "将覆盖 %{count} 个组合").replace("%{count}", String(preview.scenarios_to_replace)));
  if (preview.skill_tag_writes > 0) lines.push(tt("summary.import.writeMappings", "将写入 %{count} 条 Skill 标签映射").replace("%{count}", String(preview.skill_tag_writes)));
  return lines.length > 0 ? lines : [tt("summary.import.noChanges", "未检测到可导入的组织数据变化")];
}

// ---- 漂移组检测(供概览行) ----
export interface DriftGroup {
  id: string;
  name: string;
  copies: { path: string; availableIn: { name: string }[] }[];
  versionCount: number;
}

export function buildDriftGroups(rows: Record<string, any>[]): DriftGroup[] {
  const byName = new Map<string, { path: string; contentHash: string; availableIn: { name: string }[] }[]>();
  for (const row of rows) {
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    const path = typeof row?.path === "string" ? row.path : "";
    const contentHash = typeof row?.content_hash === "string" ? row.content_hash : "";
    if (!name || !path || !contentHash) continue;
    const copies = byName.get(name) ?? [];
    if (!copies.some((copy) => copy.path === path)) {
      copies.push({
        path,
        contentHash,
        availableIn: Array.isArray(row.availableIn) ? row.availableIn : [],
      });
    }
    byName.set(name, copies);
  }
  return [...byName.entries()]
    .map(([name, copies]) => {
      const hashes = [...new Set(copies.map((copy) => copy.contentHash))];
      return {
        id: name,
        name,
        copies: copies.map((copy) => ({ path: copy.path, availableIn: copy.availableIn })),
        versionCount: hashes.length,
      };
    })
    .filter((group) => group.copies.length > 1 && group.versionCount > 1)
    .sort((left, right) => left.name.localeCompare(right.name));
}

// ---- 漂移同步流程 ----
export const driftState = signal<{
  source: string;
  targets: string[];
  preview: { can_apply: boolean; message: string; plan_token: string; changed_files?: { path: string; kind: string }[] };
} | null>(null);
export const driftApplying = signal(false);

export async function openDriftGroup(group: DriftGroup): Promise<void> {
  try {
    const source = group.copies[0]?.path ?? "";
    const targets = group.copies.slice(1).map((copy) => copy.path);
    if (!source || targets.length === 0) return;
    const preview = await api.previewSyncSkillCopiesTyped(source, targets);
    driftState.set({ source, targets, preview });
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  }
}

export async function applyDriftSync(): Promise<void> {
  const state = driftState();
  if (!state || driftApplying() || !state.preview.can_apply) return;
  driftApplying.set(true);
  try {
    const message = await api.syncSkillCopies(state.source, state.targets, state.preview.plan_token);
    driftState.set(null);
    showToast(message, "info");
    await refresh();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    driftApplying.set(false);
  }
}

// ---- 更新回滚流程(v0.1.2) ----
export const rollbackState = signal<{ path: string; name: string; preview: UpdatePreview } | null>(null);
export const rollbackApplying = signal(false);

export async function openRollbackPreview(path: string, name: string): Promise<void> {
  try {
    const preview = await api.previewSkillRollback(path);
    rollbackState.set({ path, name, preview });
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  }
}

export async function applyRollback(): Promise<void> {
  const state = rollbackState();
  if (!state || rollbackApplying() || !state.preview.canApply) return;
  rollbackApplying.set(true);
  try {
    const message = await api.applySkillRollback(state.path, state.preview.planToken);
    rollbackState.set(null);
    showToast(message, "info");
    await refresh();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    rollbackApplying.set(false);
  }
}

// ---- 模板创建 Skill ----
export const templateOpen = signal(false);
export const templateNameDraft = signal("");
export const templateDescDraft = signal("");
export const templateErrors = signal<string[]>([]);
export const templateBusy = signal(false);

export function openTemplateCreate(): void {
  templateNameDraft.set("");
  templateDescDraft.set("");
  templateErrors.set([]);
  templateOpen.set(true);
}

export async function validateTemplateDraft(): Promise<void> {
  const result = await api.validateSkillDraft(templateNameDraft().trim(), templateDescDraft().trim());
  templateErrors.set(result.errors);
  return result.ok ? undefined : Promise.reject(new Error(result.errors.join("\n")));
}

export async function createTemplateSkill(): Promise<void> {
  if (templateBusy() || !templateNameDraft().trim()) return;
  templateBusy.set(true);
  templateErrors.set([]);
  try {
    const result = await api.validateSkillDraft(templateNameDraft().trim(), templateDescDraft().trim());
    if (!result.ok) {
      templateErrors.set(result.errors);
      return;
    }
    const path = await api.createLibrarySkill(templateNameDraft().trim(), templateDescDraft().trim());
    templateOpen.set(false);
    showToast(tt("template.created", "已从模板创建") + "\n" + path, "info");
    await refresh();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    templateBusy.set(false);
  }
}

// ---- 忽略标记(v0.1.2) ----
// 清单本体在 state.ignoredPaths(refresh 时同步);这里只提供动作与筛选。

export function toggleIgnoreConfirm(path: string, name: string, ignored: boolean): void {
  requestConfirm({
    title: ignored ? tt("skills.unignoreTitle", "取消忽略") : tt("skills.ignoreTitle", "忽略"),
    body: ignored
      ? tt("skills.unignoreBody", "重新显示该条目") + "\n" + name
      : tt("skills.ignoreBody", "从默认列表隐藏(不删除文件)") + "\n" + name,
    confirmLabel: ignored ? tt("skills.unignoreTitle", "取消忽略") : tt("skills.ignoreTitle", "忽略"),
    onConfirm: async () => {
      await api.setSkillIgnore(path, !ignored);
      showToast(ignored ? tt("skills.unignored", "已取消忽略") : tt("skills.ignored", "已忽略"));
      await refresh();
    },
  });
}

// 筛选态:默认隐藏已忽略条目;showIgnoredOnly 打开时只显示已忽略条目。
export const showIgnoredOnly = signal(false);

export function toggleShowIgnored(): void {
  showIgnoredOnly.set(!showIgnoredOnly());
}

export function filterByIgnored(rows: Record<string, any>[], ignored: Set<string>): Record<string, any>[] {
  const showOnly = showIgnoredOnly();
  if (!showOnly) {
    return rows.filter((row) => !ignored.has(String(row.path)));
  }
  return rows.filter((row) => ignored.has(String(row.path)));
}

// ---- 市场发现 ----
export const marketOpen = signal(false);
export const marketQuery = signal("");
export const marketItems = signal<Record<string, any>[]>([]);
export const marketLoading = signal(false);
export const marketError = signal("");

export function openMarket(): void {
  marketOpen.set(true);
  marketItems.set([]);
  marketError.set("");
}

function marketInstallSource(item: Record<string, any>): string {
  const raw = typeof item.installSource === "string" && item.installSource.trim()
    ? item.installSource
    : typeof item.install_source === "string" && item.install_source.trim()
      ? item.install_source
      : "";
  if (raw) return raw;
  const repository = typeof item.repository === "string" ? item.repository.trim() : "";
  return repository ? `https://github.com/${repository}.git` : "";
}

export async function runMarketSearch(): Promise<void> {
  if (marketLoading()) return;
  const query = marketQuery().trim();
  if (!query) return;
  marketLoading.set(true);
  marketError.set("");
  try {
    const response = await api.searchMarket("skills-sh", query);
    marketItems.set(response.items ?? []);
  } catch (error) {
    marketError.set(error instanceof Error ? error.message : String(error));
  } finally {
    marketLoading.set(false);
  }
}

export function installMarketItem(item: Record<string, any>): void {
  const source = marketInstallSource(item);
  if (!source) {
    showToast(tt("market.noSource", "该结果没有可安装来源"), "error");
    return;
  }
  const preferredSkillId = typeof item.skill_id === "string" ? item.skill_id.trim() : "";
  marketOpen.set(false);
  openInstallFlow("add", { source, packageValue: source, installMode: "library", preferredSkillId: source.includes("skills-sh") ? preferredSkillId : "" });
}
