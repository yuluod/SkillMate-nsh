// 启用位置(含项目核验)、场景(CRUD)与设置(常规/应用/数据 三组七页)。
// 组件只做壳,逻辑在 render*(从 JSX 调用,signal 读取被追踪)。
import { signal, Text, View, token } from "nsh";
import { t } from "nsh/i18n";
import { Input } from "nsh/base";
import { Stamp } from "../components/Stamp";
import { BrandIcon, Icon } from "../components/Icon";
import { skinStyle, SKINS, toneColor, type Skin, type ThemeMode } from "../theme";
import { dashboard, language, mode, scenarios, setLanguage, setMode, setSkin, skin, replaceScenarios } from "../state";
import { api } from "../lib/api";
import {
  buildImportSummaryLines, openScenarioCreate, requestConfirm, showToast, tt,
} from "../flows";

function renderAssistants() {
  const data = dashboard();
  if (!data) return null;
  return (
    <View style={{ gap: 6 }}>
      {(data.assistants ?? []).map((assistant: Record<string, any>) => (
        <View
          accessibilityLabel={assistant.name}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: token("card"),
            borderWidth: skinStyle(skin()).borderWidth,
            borderColor: token("border"),
            borderRadius: skinStyle(skin()).radius,
            gap: 4,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <BrandIcon name={String(assistant.icon || "")} size={16} />
              <Text style={{ color: token("foreground"), fontSize: 13, fontWeight: "600" }}>{assistant.name}</Text>
            </View>
            {assistant.exists
              ? <Stamp label={t("dashboard.assistants")} tone="success" />
              : <Stamp label={t("common.unknown")} tone="muted" />}
          </View>
          <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{assistant.path}</Text>
          <Text class="text-muted-foreground" style={{ fontSize: 12 }}>
            {`${t("nav.skills")}: ${(assistant.skills ?? []).length}`}
          </Text>
          {(assistant.diagnostics ?? []).map((item: Record<string, any>) => (
            <Text class="text-muted-foreground" style={{ fontSize: 11 }}>
              {`${item.code} · ${item.message}`}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export function AssistantsView() {
  return <View style={{ gap: 12 }}>{renderAssistants()}{renderProjectInspect()}</View>;
}

// ---- 项目核验 ----
const projectPathDraft = signal("");
const projectResult = signal<Record<string, any> | null>(null);
const projectTargets = signal<{ assistant: string; target_path: string; exists: boolean; recommended: boolean }[]>([]);
const projectLoading = signal(false);

async function runProjectInspect(): Promise<void> {
  if (projectLoading() || !projectPathDraft().trim()) return;
  projectLoading.set(true);
  try {
    projectResult.set(await api.inspectProject(projectPathDraft().trim()));
    projectTargets.set(await api.previewProjectSkillTargets(projectPathDraft().trim()));
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    projectLoading.set(false);
  }
}

function renderProjectInspect() {
  const result = projectResult();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: token("foreground"), fontSize: 14, fontWeight: "650" }}>
        {tt("project.title", "项目核验")}
      </Text>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Input
          value={projectPathDraft()}
          onChange={({ value }: { value: string }) => projectPathDraft.set(value)}
          placeholder={tt("project.placeholder", "项目目录绝对路径")}
          style={{
            flex: 1,
            backgroundColor: token("card"),
            color: token("foreground"),
            borderWidth: skinStyle(skin()).borderWidth,
            borderColor: token("border"),
            borderRadius: skinStyle(skin()).radius,
            paddingHorizontal: 10,
            paddingVertical: 7,
            fontSize: 12,
          }}
        />
        <View
          role="button"
          accessibilityLabel={tt("project.inspect", "检查")}
          onPress={() => void runProjectInspect()}
          style={{ paddingHorizontal: 14, paddingVertical: 7, backgroundColor: token("primary"), borderRadius: skinStyle(skin()).radius }}
        >
          <Text style={{ color: token("primary-foreground"), fontSize: 12, fontWeight: "600" }}>
            {projectLoading() ? t("common.loading") : tt("project.inspect", "检查")}
          </Text>
        </View>
      </View>
      {result ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: token("foreground"), fontSize: 12, fontWeight: "600" }}>
            {JSON.stringify(result).slice(0, 400)}
          </Text>
          {projectTargets().map((target) => (
            <Text class="text-muted-foreground" style={{ fontSize: 11 }}>
              {`${target.assistant}: ${target.target_path}${target.exists ? " · " + tt("project.exists", "已存在") : ""}${target.recommended ? " · " + tt("project.recommended", "推荐") : ""}`}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---- 场景(CRUD) ----
const expandedScenario = signal<string | null>(null);

function deleteScenarioConfirm(scenario: Record<string, any>): void {
  requestConfirm({
    title: tt("scenarios.deleteTitle", "删除场景"),
    body: String(scenario.name ?? ""),
    confirmLabel: tt("scenarios.delete", "删除"),
    danger: true,
    onConfirm: async () => {
      await api.deleteScenario(String(scenario.id));
      showToast(tt("scenarios.deleted", "已删除"));
      await refreshScenarios();
    },
  });
}

async function refreshScenarios(): Promise<void> {
  replaceScenarios((await api.rawGetScenarios()) as unknown as Record<string, any>[]);
}

function renderScenarios() {
  const items = scenarios();
  const expanded = expandedScenario();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: token("foreground"), fontSize: 14, fontWeight: "650" }}>{t("nav.scenarios")}</Text>
        <Text
          role="button"
          accessibilityLabel={t("scenarios.create")}
          onPress={() => openScenarioCreate([])}
          style={{ color: token("primary"), fontSize: 12, fontWeight: "650", paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: token("primary"), borderRadius: skinStyle(skin()).radius }}
        >
          {t("scenarios.create")}
        </Text>
      </View>
      {items.map((scenario) => {
        const isOpen = expanded === scenario.id;
        return (
          <View
            style={{
              paddingHorizontal: 12,
              paddingVertical: 10,
              backgroundColor: token("card"),
              borderWidth: skinStyle(skin()).borderWidth,
              borderColor: token("border"),
              borderRadius: skinStyle(skin()).radius,
              gap: 4,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View
                role="button"
                accessibilityLabel={String(scenario.name)}
                onPress={() => expandedScenario.set(isOpen ? null : String(scenario.id))}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}
              >
                <Icon name="scenarios" size={14} />
                <Text style={{ color: token("foreground"), fontSize: 13, fontWeight: "600" }}>{String(scenario.name)}</Text>
                <Stamp label={String((scenario.skill_ids ?? []).length)} tone="muted" />
              </View>
              <Text
                role="button"
                accessibilityLabel={t("scenarios.delete")}
                onPress={() => deleteScenarioConfirm(scenario)}
                style={{ color: toneColor(skin(), "error", mode()), fontSize: 12, fontWeight: "600" }}
              >
                {t("scenarios.delete")}
              </Text>
            </View>
            {scenario.description ? (
              <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{String(scenario.description)}</Text>
            ) : null}
            {isOpen ? (
              <View style={{ gap: 2, paddingTop: 4 }}>
                {((scenario.skill_ids ?? []) as string[]).map((path) => (
                  <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{path}</Text>
                ))}
                {((scenario.skill_ids ?? []) as string[]).length === 0 ? (
                  <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{tt("scenarios.empty", "没有成员 Skill")}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
      {items.length === 0 ? (
        <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{t("summary.scenario.noChanges")}</Text>
      ) : null}
    </View>
  );
}

export function ScenariosView() {
  return <View style={{ gap: 8 }}>{renderScenarios()}</View>;
}

// ---- 设置:常规/应用/数据 三组 ----
type SettingsTab = "language" | "appearance" | "backup" | "policy" | "libraryRoot" | "data" | "profiles";
const settingsTab = signal<SettingsTab>("language");

const gitDraft = signal<{ repoPath: string; remoteUrl: string; branch: string } | null>(null);
const policyDraft = signal<{ mode: string } | null>(null);
const libraryRootDraft = signal("");
const dataExportPath = signal("skillmate-library.json");
const dataImportPath = signal("");
const manifestPath = signal("");
const profileNameDraft = signal("");
const profilesList = signal<Record<string, any>[]>([]);

declare global {
  // eslint-disable-next-line no-var
  var __smGetScenarios: () => string;
}

async function loadPanelData(tab: string): Promise<void> {
  try {
    if (tab === "backup") {
      gitDraft.set(await api.getGitBackup() as unknown as { repoPath: string; remoteUrl: string; branch: string });
    } else if (tab === "policy") {
      policyDraft.set(JSON.parse(await api.getInstallPolicyRaw()) as { mode: string });
    } else if (tab === "libraryRoot") {
      const settings = JSON.parse(await api.getLibrarySettingsRaw()) as { library_root?: string; path?: string };
      libraryRootDraft.set(String(settings.library_root ?? settings.path ?? ""));
    } else if (tab === "profiles") {
      profilesList.set((await api.getSkillProfiles()).profiles ?? []);
    }
  } catch {
    // 面板数据加载失败不阻塞切换
  }
}

function renderSettingsNav() {
  const groups: { label: string; items: { id: SettingsTab; labelKey: string; icon: string }[] }[] = [
    {
      label: tt("settings.group.general", "常规"),
      items: [
        { id: "language", labelKey: "settings.language", icon: "assistants" },
        { id: "appearance", labelKey: "settings.appearance", icon: "dashboard" },
      ],
    },
    {
      label: tt("settings.group.app", "应用"),
      items: [
        { id: "backup", labelKey: "settings.tabs.backup", icon: "branch" },
        { id: "policy", labelKey: "settings.tabs.installPolicy", icon: "shield" },
        { id: "libraryRoot", labelKey: "settings.tabs.library", icon: "folder" },
      ],
    },
    {
      label: tt("settings.group.data", "数据"),
      items: [
        { id: "data", labelKey: "settings.tabs.data", icon: "updates" },
        { id: "profiles", labelKey: "settings.tabs.skillset", icon: "scenarios" },
      ],
    },
  ];
  const current = settingsTab();
  return groups.map((group) => (
    <View style={{ gap: 4, marginBottom: 16 }}>
      <Text class="text-muted-foreground" style={{ fontSize: 11, paddingHorizontal: 10 }}>{group.label}</Text>
      {group.items.map((item) => {
        const active = current === item.id;
        return (
          <View
            role="button"
            accessibilityLabel={t(item.labelKey)}
            onPress={() => {
              settingsTab.set(item.id);
              void loadPanelData(item.id);
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 10,
              paddingVertical: 7,
              backgroundColor: active ? token("muted") : "transparent",
              borderRadius: skinStyle(skin()).radius,
            }}
          >
            <Icon name={item.icon} size={15} color={active ? token("primary") : token("muted-foreground")} />
            <Text style={{ color: active ? token("primary") : token("foreground"), fontSize: 13, fontWeight: active ? "650" : "400" }}>
              {tt(item.labelKey, item.labelKey.split(".").pop() ?? "")}
            </Text>
          </View>
        );
      })}
    </View>
  ));
}

function renderPillOption(label: string, active: boolean, onPress: () => void) {
  return (
    <View
      role="button"
      accessibilityLabel={label}
      accessibilityState={active ? { selected: true } : undefined}
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderWidth: active ? 2 : 1,
        borderColor: active ? token("primary") : token("border"),
        borderRadius: 14,
      }}
    >
      <Text style={{ color: active ? token("primary") : token("muted-foreground"), fontSize: 12, fontWeight: active ? "650" : "400" }}>
        {label}
      </Text>
    </View>
  );
}

function renderSkinPreviewMini(skinId: Skin) {
  const style = skinStyle(skinId);
  const appearance = mode() === "dark" ? "dark" : "light";
  const rows = [0, 1, 2];
  return (
    <View
      style={{
        height: 62,
        flexDirection: "row",
        gap: 6,
        padding: 8,
        backgroundColor: SKINS[skinId].colors.background[appearance],
        borderWidth: style.borderWidth,
        borderColor: SKINS[skinId].colors.border[appearance],
        borderRadius: style.radius,
      }}
    >
      <View style={{ width: 18, gap: 5 }}>
        {rows.map((row) => (
          <View style={{ height: 5, width: 14, backgroundColor: token("muted-foreground"), opacity: 0.35, borderRadius: style.radius }} />
        ))}
      </View>
      <View style={{ flex: 1, gap: 5 }}>
        {rows.map((row) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View style={{ width: 7, height: 7, backgroundColor: toneColor(skinId, "success", mode()), borderRadius: skinId === "cardbox" ? 0 : 4 }} />
            <View style={{ height: 5, flex: 1, backgroundColor: token("muted-foreground"), opacity: 0.28, borderRadius: style.radius }} />
          </View>
        ))}
      </View>
    </View>
  );
}

function renderSkinCards() {
  const cards: { id: Skin; nameKey: string; hintKey: string; fallback: string; hint: string }[] = [
    { id: "standard", nameKey: "settings.skin.standard", hintKey: "settings.skin.standardHint", fallback: "中性现代", hint: "纯白底与单一靛蓝,冷静克制的默认外观" },
    { id: "ledger", nameKey: "settings.skin.ledger", hintKey: "settings.skin.ledgerHint", fallback: "经典", hint: "高分辨栏与紧凑状态标记(默认)" },
    { id: "cardbox", nameKey: "settings.skin.cardbox", hintKey: "settings.skin.cardboxHint", fallback: "复古", hint: "直角边框与高对比质感" },
  ];
  return (
    <View role="radiogroup" accessibilityLabel={t("settings.skin")} style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {cards.map((card) => {
        const active = skin() === card.id;
        const accent = active ? token("primary") : token("border");
        return (
          <View
            role="button"
            accessibilityLabel={t(card.nameKey)}
            accessibilityState={active ? { selected: true } : undefined}
            onPress={() => setSkin(card.id)}
            style={{
              width: 190,
              gap: 8,
              padding: 10,
              borderWidth: active ? 2 : 1,
              borderColor: accent,
              borderRadius: Math.max(skinStyle(skin()).radius, 8),
            }}
          >
            {renderSkinPreviewMini(card.id)}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: token("foreground"), fontSize: 13, fontWeight: "650" }}>{tt(card.nameKey, card.fallback)}</Text>
              <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: active ? 4 : 1, borderColor: active ? token("primary") : token("border") }} />
            </View>
            <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{tt(card.hintKey, card.hint)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function renderSectionHeader(title: string, hint: string) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: token("foreground"), fontSize: 14, fontWeight: "650" }}>{title}</Text>
      <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{hint}</Text>
    </View>
  );
}

function fieldInput(value: string, onChange: (value: string) => void, placeholder: string) {
  return (
    <Input
      value={value}
      onChange={({ value }: { value: string }) => onChange(value)}
      placeholder={placeholder}
      style={{
        backgroundColor: token("card"),
        color: token("foreground"),
        borderWidth: skinStyle(skin()).borderWidth,
        borderColor: token("border"),
        borderRadius: skinStyle(skin()).radius,
        paddingHorizontal: 10,
        paddingVertical: 7,
        fontSize: 12,
      }}
    />
  );
}

function primaryButton(label: string, onPress: () => void, danger = false) {
  return (
    <View
      role="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 7,
        backgroundColor: danger ? toneColor(skin(), "error", mode()) : token("primary"),
        borderRadius: skinStyle(skin()).radius,
      }}
    >
      <Text style={{ color: token("primary-foreground"), fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

function renderBackup() {
  const draft = gitDraft() ?? { repoPath: "", remoteUrl: "", branch: "main" };
  return (
    <View style={{ gap: 20 }}>
      {renderSectionHeader(tt("settings.tabs.backup", "Git 备份"), tt("settings.backupHint", "把受管 Skill 快照同步到私有 Git 仓库。"))}
      <View style={{ height: 1, backgroundColor: token("border") }} />
      <View style={{ gap: 8, maxWidth: 520 }}>
        {fieldInput(draft.repoPath ?? "", (value) => gitDraft.set({ ...draft, repoPath: value }), tt("settings.backupRepo", "仓库本地路径"))}
        {fieldInput(draft.remoteUrl ?? "", (value) => gitDraft.set({ ...draft, remoteUrl: value }), tt("settings.backupRemote", "远端 URL"))}
        {fieldInput(draft.branch ?? "main", (value) => gitDraft.set({ ...draft, branch: value }), tt("settings.backupBranch", "分支"))}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {primaryButton(t("common.save"), async () => {
            try {
              await api.setupGitBackup(draft.repoPath ?? "", draft.remoteUrl ?? "", draft.branch ?? "main");
              showToast(tt("settings.backupSaved", "已配置"));
            } catch (error) {
              showToast(error instanceof Error ? error.message : String(error), "error");
            }
          })}
          {primaryButton(tt("settings.backupSync", "立即同步"), async () => {
            try {
              showToast(await api.syncToGit(tt("settings.backupMessage", "SkillMate 手动同步")));
            } catch (error) {
              showToast(error instanceof Error ? error.message : String(error), "error");
            }
          })}
        </View>
      </View>
    </View>
  );
}

function renderPolicy() {
  const draft = policyDraft() ?? { mode: "off" };
  const modes: { id: string; label: string }[] = [
    { id: "off", label: tt("policy.off", "仅提醒") },
    { id: "trusted", label: tt("policy.trusted", "标准") },
    { id: "critical", label: tt("policy.critical", "严格") },
  ];
  return (
    <View style={{ gap: 20 }}>
      {renderSectionHeader(tt("settings.tabs.installPolicy", "安装安全"), tt("settings.policyHint", "控制添加与启用时对结构风险的处理强度。"))}
      <View style={{ height: 1, backgroundColor: token("border") }} />
      <View style={{ gap: 10, maxWidth: 520 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {modes.map((modeItem) => renderPillOption(modeItem.label, draft.mode === modeItem.id, () => policyDraft.set({ mode: modeItem.id })))}
        </View>
        {primaryButton(t("common.save"), async () => {
          try {
            await api.setInstallPolicy(JSON.stringify(draft));
            showToast(tt("settings.policySaved", "安装策略已保存"));
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
          }
        })}
      </View>
    </View>
  );
}

function renderLibraryRoot() {
  return (
    <View style={{ gap: 20 }}>
      {renderSectionHeader(tt("settings.tabs.library", "统一库位置"), tt("settings.libraryHint", "SkillMate 统一库的根目录;受管启用默认从这里连接。"))}
      <View style={{ height: 1, backgroundColor: token("border") }} />
      <View style={{ gap: 8, maxWidth: 520 }}>
        {fieldInput(libraryRootDraft(), (value) => libraryRootDraft.set(value), tt("settings.libraryPlaceholder", "统一库根目录绝对路径"))}
        {primaryButton(t("common.save"), async () => {
          try {
            await api.setLibraryRoot(libraryRootDraft().trim());
            showToast(tt("settings.librarySaved", "统一库位置已更新"));
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
          }
        })}
      </View>
    </View>
  );
}

function renderData() {
  return (
    <View style={{ gap: 24 }}>
      {renderSectionHeader(tt("settings.tabs.data", "数据"), tt("settings.dataHint", "导出/导入完整库,以及应用环境清单。"))}
      <View style={{ height: 1, backgroundColor: token("border") }} />
      <View style={{ gap: 16, maxWidth: 560 }}>
        <Text style={{ color: token("foreground"), fontSize: 13, fontWeight: "650" }}>{tt("settings.dataExport", "导出库")}</Text>
        {fieldInput(dataExportPath(), (value) => dataExportPath.set(value), tt("settings.dataExportPlaceholder", "导出文件绝对路径"))}
        {primaryButton(tt("settings.dataExportAction", "导出"), async () => {
          try {
            showToast(await api.exportLibrary(dataExportPath().trim()));
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
          }
        }, false)}
        <View style={{ height: 1, backgroundColor: token("border") }} />
        <Text style={{ color: token("foreground"), fontSize: 13, fontWeight: "650" }}>{tt("settings.dataImport", "导入库")}</Text>
        {fieldInput(dataImportPath(), (value) => dataImportPath.set(value), tt("settings.dataImportPlaceholder", "库导出文件绝对路径"))}
        {primaryButton(tt("settings.dataImportAction", "导入(合并)"), async () => {
          try {
            const preview = await api.previewImportLibrary(dataImportPath().trim(), "merge") as unknown as Parameters<typeof buildImportSummaryLines>[0];
            const planToken = String(preview.plan_token ?? "");
            const lines = buildImportSummaryLines(preview);
            requestConfirm({
              title: tt("settings.dataImportConfirm", "确认导入"),
              body: lines.join("\n"),
              confirmLabel: tt("settings.dataImportAction", "导入(合并)"),
              onConfirm: async () => {
                showToast(await api.importLibrary(dataImportPath().trim(), "merge", planToken));
                await refreshAll();
              },
            });
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
          }
        }, false)}
        <View style={{ height: 1, backgroundColor: token("border") }} />
        <Text style={{ color: token("foreground"), fontSize: 13, fontWeight: "650" }}>{tt("settings.dataManifest", "应用环境清单")}</Text>
        {fieldInput(manifestPath(), (value) => manifestPath.set(value), tt("settings.dataManifestPlaceholder", "skillmate.toml 绝对路径"))}
        {primaryButton(tt("settings.dataManifestAction", "预览并应用"), async () => {
          try {
            const preview = await api.previewApplySkillmateManifest(manifestPath().trim());
            const planToken = String(preview.plan_token ?? preview.planToken ?? "");
            requestConfirm({
              title: tt("settings.dataManifestConfirm", "确认应用清单"),
              body: String(preview.message ?? JSON.stringify(preview).slice(0, 300)),
              confirmLabel: tt("settings.dataManifestAction", "预览并应用"),
              onConfirm: async () => {
                showToast(await api.applySkillmateManifest(manifestPath().trim(), planToken));
                await refreshAll();
              },
            });
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
          }
        }, false)}
      </View>
    </View>
  );
}

async function refreshAll(): Promise<void> {
  const { refresh } = await import("../state");
  await refresh();
}

function renderProfiles() {
  const profiles = profilesList();
  return (
    <View style={{ gap: 20 }}>
      {renderSectionHeader(tt("settings.tabs.skillset", "技能集"), tt("settings.profilesHint", "把当前启用状态保存为可复现组合,或一键应用。"))}
      <View style={{ height: 1, backgroundColor: token("border") }} />
      <View style={{ gap: 16, maxWidth: 560 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <View style={{ flex: 1 }}>{fieldInput(profileNameDraft(), (value) => profileNameDraft.set(value), tt("settings.profilesName", "技能集名称"))}</View>
          {primaryButton(tt("settings.profilesSave", "保存当前"), async () => {
            try {
              await api.saveCurrentSkillProfile(profileNameDraft().trim(), "");
              profileNameDraft.set("");
              profilesList.set((await api.getSkillProfiles()).profiles ?? []);
              showToast(tt("settings.profilesSaved", "技能集已保存"));
            } catch (error) {
              showToast(error instanceof Error ? error.message : String(error), "error");
            }
          })}
        </View>
        <View style={{ gap: 6 }}>
          {profiles.map((profile) => (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderWidth: skinStyle(skin()).borderWidth,
                borderColor: token("border"),
                borderRadius: skinStyle(skin()).radius,
              }}
            >
              <View style={{ gap: 2 }}>
                <Text style={{ color: token("foreground"), fontSize: 13, fontWeight: "600" }}>{String(profile.name ?? "")}</Text>
                {profile.description ? <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{String(profile.description)}</Text> : null}
              </View>
              <Text
                role="button"
                accessibilityLabel={tt("settings.profilesApply", "应用")}
                onPress={() => void applyProfile(String(profile.id ?? ""))}
                style={{ color: token("primary"), fontSize: 12, fontWeight: "650" }}
              >
                {tt("settings.profilesApply", "应用")}
              </Text>
            </View>
          ))}
          {profiles.length === 0 ? (
            <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{tt("settings.profilesEmpty", "还没有技能集")}</Text>
          ) : null}
        </View>
        {primaryButton(tt("settings.profilesRollback", "回滚上次应用"), async () => {
          try {
            showToast(await api.rollbackSkillProfile());
            await refreshAll();
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
          }
        }, true)}
      </View>
    </View>
  );
}

async function applyProfile(profileId: string): Promise<void> {
  try {
    const preview = await api.previewApplySkillProfile(profileId);
    const planToken = String(preview.plan_token ?? preview.planToken ?? "");
    requestConfirm({
      title: tt("settings.profilesApplyConfirm", "确认应用技能集"),
      body: String(preview.message ?? JSON.stringify(preview).slice(0, 300)),
      confirmLabel: tt("settings.profilesApply", "应用"),
      onConfirm: async () => {
        showToast(await api.applySkillProfile(profileId, planToken));
        await refreshAll();
      },
    });
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  }
}

function renderAppearance() {
  const modeOptions: { id: ThemeMode; labelKey: string; fallback: string }[] = [
    { id: "system", labelKey: "settings.theme.system", fallback: "跟随系统" },
    { id: "light", labelKey: "settings.theme.light", fallback: "浅色" },
    { id: "dark", labelKey: "settings.theme.dark", fallback: "深色" },
  ];
  return (
    <View style={{ gap: 20 }}>
      {renderSectionHeader(tt("settings.appearance", "外观"), tt("settings.appearanceHint", "选择界面风格与明暗模式,立即生效并保存在本机。"))}
      <View style={{ height: 1, backgroundColor: token("border") }} />
      <View style={{ gap: 10 }}>
        <Text style={{ color: token("foreground"), fontSize: 13, fontWeight: "650" }}>{t("settings.skin")}</Text>
        {renderSkinCards()}
      </View>
      <View style={{ gap: 10 }}>
        <Text style={{ color: token("foreground"), fontSize: 13, fontWeight: "650" }}>{t("settings.theme")}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {modeOptions.map((option) => renderPillOption(tt(option.labelKey, option.fallback), mode() === option.id, () => setMode(option.id)))}
        </View>
      </View>
    </View>
  );
}

function renderLanguage() {
  const options: { id: "zh-CN" | "en"; label: string }[] = [
    { id: "zh-CN", label: "中文" },
    { id: "en", label: "English" },
  ];
  return (
    <View style={{ gap: 20 }}>
      {renderSectionHeader(tt("settings.language", "界面语言"), tt("settings.languageHint", "语言切换立即生效,并保存在本机。"))}
      <View style={{ height: 1, backgroundColor: token("border") }} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {options.map((option) => renderPillOption(option.label, language() === option.id, () => setLanguage(option.id)))}
      </View>
    </View>
  );
}

function renderSettings() {
  const current = settingsTab();
  const titles: Record<string, string> = {
    language: tt("settings.language", "界面语言"),
    appearance: tt("settings.appearance", "外观"),
    backup: tt("settings.tabs.backup", "Git 备份"),
    policy: tt("settings.tabs.installPolicy", "安装安全"),
    libraryRoot: tt("settings.tabs.library", "统一库位置"),
    data: tt("settings.tabs.data", "数据"),
    profiles: tt("settings.tabs.skillset", "技能集"),
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
      <View style={{ width: 168 }}>{renderSettingsNav()}</View>
      <View
        style={{
          flex: 1,
          maxWidth: 720,
          paddingLeft: 24,
          borderLeftWidth: skinStyle(skin()).borderWidth,
          borderLeftColor: token("border"),
          gap: 16,
        }}
      >
        <Text style={{ color: token("foreground"), fontSize: 22, fontWeight: "780" }}>{titles[current]}</Text>
        {current === "language" ? renderLanguage() : null}
        {current === "appearance" ? renderAppearance() : null}
        {current === "backup" ? renderBackup() : null}
        {current === "policy" ? renderPolicy() : null}
        {current === "libraryRoot" ? renderLibraryRoot() : null}
        {current === "data" ? renderData() : null}
        {current === "profiles" ? renderProfiles() : null}
      </View>
    </View>
  );
}

export function SettingsView() {
  return <View>{renderSettings()}</View>;
}
