// 技能库:筛选/搜索(名称+正文)/排序/标签与场景筛选/批量选择/列表+详情栏动作。
// 组件只做壳,逻辑在 render*(从 JSX 调用,signal 读取被追踪)。
import { signal, Text, View, token } from "nsh";
import { t } from "nsh/i18n";
import { Input } from "nsh/base";
import { Stamp } from "../components/Stamp";
import { Icon } from "../components/Icon";
import { skinStyle, toneColor } from "../theme";
import {
  dashboard, detail, detailLoading, filter, mode, openDetail, query, refresh, scenarios, selectedIdentity,
  skin, tags, type SkillFilter,
} from "../state";
import {
  buildSkillCardView, buildUnifiedSkillInventory, buildUniqueSkillInventory,
  getStructureStatusLabel, skillMatchesQuery,
} from "../lib/inventory";
import { api } from "../lib/api";
import {
  openAdoptFlow, openInstallFlow, openMarket, openScenarioCreate, openTagEditor, openTagManager,
  openUpdatePreview, requestConfirm, showUndoBar, showToast, tt,
} from "../flows";

const FILTERS: { id: SkillFilter; labelKey: string }[] = [
  { id: "all", labelKey: "skills.filterAll" },
  { id: "notEnabled", labelKey: "skills.filterNotEnabled" },
  { id: "updates", labelKey: "skills.filterUpdates" },
  { id: "needsAttention", labelKey: "skills.filterNeedsAttention" },
];

const tagFilter = signal<string | null>(null);
const scenarioFilter = signal<string | null>(null);
const sortMode = signal<"name" | "updates">("name");
const bodyHits = signal<Set<string>>(new Set());
const selection = signal<Set<string>>(new Set());
const syncByPath = signal<Record<string, any>>({});
let bodySearchTimer: ReturnType<typeof setTimeout> | null = null;

function allRows() {
  const data = dashboard();
  if (!data) return [];
  return buildUnifiedSkillInventory([
    ...buildUniqueSkillInventory(data.assistants ?? [], t),
    ...(data.library_skills ?? []),
  ]);
}

function visibleRows() {
  const rows = allRows();
  const needle = query();
  const activeScenario = scenarios().find((item: Record<string, any>) => item.id === scenarioFilter());
  const allowedPaths = activeScenario ? new Set<string>(activeScenario.skill_ids ?? []) : null;
  const filtered = rows.filter((row) => {
    if (filter() === "notEnabled" && (row.deployments?.length ?? 0) > 0) return false;
    if (filter() === "updates" && !row.has_update && row.sync_state !== "behind") return false;
    if (filter() === "needsAttention" && !buildSkillCardView(row, t).needsAttention) return false;
    if (tagFilter() && !(row.tags ?? []).includes(tagFilter())) return false;
    if (allowedPaths) {
      const identities = [row.path, row.symlink_source, ...(row.deployments ?? []).map((d: Record<string, any>) => d.path)];
      if (!identities.some((identity) => identity && allowedPaths.has(identity))) return false;
    }
    return skillMatchesQuery(row, needle, bodyHits());
  });
  if (sortMode() === "name") {
    filtered.sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
  } else {
    filtered.sort((left, right) => Number(right.has_update ?? false) - Number(left.has_update ?? false));
  }
  return filtered;
}

function scheduleBodySearch(): void {
  if (bodySearchTimer) clearTimeout(bodySearchTimer);
  bodySearchTimer = setTimeout(async () => {
    const needle = query().trim();
    const rows = allRows();
    if (!needle || rows.length === 0) {
      bodyHits.set(new Set());
      return;
    }
    try {
      const result = JSON.parse(
        await api.searchSkillBodiesRaw(rows.slice(0, 1000).map((row) => row.path), needle),
      ) as { matches: { path: string }[] };
      bodyHits.set(new Set(result.matches.map((match) => match.path)));
    } catch {
      bodyHits.set(new Set());
    }
  }, 350);
}

async function checkAllUpdates(): Promise<void> {
  const rows = visibleRows();
  if (rows.length === 0) return;
  try {
    const results = JSON.parse(
      await api.rawCheckUpdates(rows.map((row) => row.path), true),
    ) as { path: string; hasUpdate: boolean; message: string }[];
    const merged = { ...syncByPath() };
    let updated = 0;
    for (const item of results) {
      merged[item.path] = item;
      if (item.hasUpdate) updated += 1;
    }
    syncByPath.set(merged);
    showToast(tt("updates.checkedSummary", "检查完成,%{count} 个可更新").replace("%{count}", String(updated)));
    await refresh();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  }
}

function toggleSelected(path: string): void {
  const next = new Set(selection());
  if (next.has(path)) next.delete(path);
  else next.add(path);
  selection.set(next);
}

function renderHeaderActions() {
  const actions = [
    { id: "header-add", label: tt("install.title.add", "添加 Skill"), primary: true, onPress: () => openInstallFlow("add") },
    { id: "header-adopt", label: tt("adopt.title", "接管"), primary: false, onPress: () => openAdoptFlow() },
    { id: "header-market", label: tt("market.title", "发现"), primary: false, onPress: () => openMarket() },
    { id: "header-tags", label: tt("tags.title", "标签"), primary: false, onPress: () => openTagManager() },
  ];
  return (
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
      {actions.map((action) => (
        <View
          testID={action.id}
          role="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 7,
            backgroundColor: action.primary ? token("primary") : token("card"),
            borderWidth: action.primary ? 0 : skinStyle(skin()).borderWidth,
            borderColor: token("border"),
            borderRadius: skinStyle(skin()).radius,
          }}
        >
          {action.primary ? <Icon name="plus" size={13} color={token("primary-foreground")} /> : null}
          <Text style={{ color: action.primary ? token("primary-foreground") : token("foreground"), fontSize: 12, fontWeight: "600" }}>
            {action.label}
          </Text>
        </View>
      ))}
      <Text
        role="button"
        accessibilityLabel={tt("updates.checkAll", "批量检查更新")}
        onPress={() => void checkAllUpdates()}
        style={{ color: token("primary"), fontSize: 12, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 8 }}
      >
        {tt("updates.checkAll", "批量检查更新")}
      </Text>
    </View>
  );
}

function renderBatchBar(): ReturnType<typeof View> | null {
  const selected = selection();
  if (selected.size === 0) return null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 10,
        paddingVertical: 7,
        backgroundColor: token("muted"),
        borderRadius: skinStyle(skin()).radius,
      }}
    >
      <Text style={{ color: token("foreground"), fontSize: 12, fontWeight: "600" }}>
        {tt("skills.selectedCount", "已选 %{count} 项").replace("%{count}", String(selected.size))}
      </Text>
      <Text
        role="button"
        accessibilityLabel={t("scenarios.create")}
        onPress={() => openScenarioCreate([...selected])}
        style={{ color: token("primary"), fontSize: 12, fontWeight: "600" }}
      >
        {t("scenarios.create")}
      </Text>
      <Text
        role="button"
        accessibilityLabel={tt("tags.editorTitle", "编辑标签")}
        onPress={() => openTagEditor([...selected])}
        style={{ color: token("primary"), fontSize: 12, fontWeight: "600" }}
      >
        {tt("tags.editorTitle", "编辑标签")}
      </Text>
      <Text
        role="button"
        accessibilityLabel={t("common.clear")}
        onPress={() => selection.set(new Set())}
        style={{ color: token("muted-foreground"), fontSize: 12 }}
      >
        {t("common.clear")}
      </Text>
    </View>
  );
}

async function applyTagToSelection(): Promise<void> {
  return Promise.resolve();
}

function renderSkillRow(row: Record<string, any>) {
  const card = buildSkillCardView(row, t);
  const selected = selectedIdentity() === row.path;
  const checked = selection().has(row.path);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 9,
        marginBottom: 4,
        backgroundColor: selected ? token("muted") : token("card"),
        borderWidth: skinStyle(skin()).borderWidth,
        borderColor: selected ? token("primary") : token("border"),
        borderRadius: skinStyle(skin()).radius,
        gap: 10,
      }}
    >
      <View
        role="button"
        accessibilityLabel={tt("skills.select", "选择")}
        accessibilityState={checked ? { checked: true } : undefined}
        onPress={() => toggleSelected(row.path)}
        style={{
          width: 15,
          height: 15,
          borderWidth: skinStyle(skin()).borderWidth,
          borderColor: checked ? token("primary") : token("border"),
          backgroundColor: checked ? token("primary") : "transparent",
          borderRadius: Math.max(skinStyle(skin()).radius - 2, 0),
        }}
      />
      <View
        testID={`skill-row-${row.name}`}
        role="button"
        accessibilityLabel={card.title || row.name}
        onPress={() => void openDetail(row.path)}
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <View style={{ flex: 2, gap: 2 }}>
          <Text style={{ color: token("foreground"), fontSize: 13, fontWeight: "600" }}>{card.title || row.name}</Text>
          {card.description ? (
            <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{card.description}</Text>
          ) : null}
          <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{row.path}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text class="text-muted-foreground" style={{ fontSize: 12 }}>
            {card.availabilityLabel || t("skills.filterNotEnabled")}
          </Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, justifyContent: "flex-end", maxWidth: 220 }}>
          {card.hasUpdate ? <Stamp label={t("skills.updateReady")} tone="warn" /> : null}
          {card.needsAttention ? <Stamp label={t("dashboard.attention")} tone="error" /> : null}
          <Stamp label={getStructureStatusLabel(row.structure_status, t)} tone={card.structureTone} />
          {row.in_library ? <Stamp label={t("common.managed")} tone="primary" /> : null}
        </View>
      </View>
    </View>
  );
}

function renderDetailPane() {
  const identity = selectedIdentity();
  const state = detail();
  const row = identity ? allRows().find((item) => item.path === identity) : undefined;
  if (!identity || !row) {
    return <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{t("skills.detailClose")}</Text>;
  }
  const card = buildSkillCardView(row, t);
  const validation = state?.validation as { checks?: { name: string; status: string; message?: string }[] } | null;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ color: token("foreground"), fontSize: 15, fontWeight: "650" }}>{card.title || row.name}</Text>
        {card.description ? <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{card.description}</Text> : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        {card.provenanceNotes.map((note) => (
          <Stamp label={note} tone="muted" />
        ))}
      </View>
      <View style={{ gap: 2 }}>
        <Text style={{ color: token("foreground"), fontSize: 12, fontWeight: "600" }}>{t("preview.structure")}</Text>
        <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{card.warningSummary}</Text>
      </View>
      {validation?.checks?.length ? (
        <View style={{ gap: 2 }}>
          <Text style={{ color: token("foreground"), fontSize: 12, fontWeight: "600" }}>{t("preview.security")}</Text>
          {validation.checks.map((check) => (
            <Text class="text-muted-foreground" style={{ fontSize: 11 }}>
              {`${check.status === "pass" ? "✓" : check.status === "warning" ? "!" : "✗"} ${check.name}${check.message ? ` · ${check.message}` : ""}`}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={{ gap: 2 }}>
        <Text style={{ color: token("foreground"), fontSize: 12, fontWeight: "600" }}>{t("preview.update")}</Text>
        <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{card.updateSummary}</Text>
      </View>
      <View style={{ gap: 4 }}>
        <Text style={{ color: token("foreground"), fontSize: 12, fontWeight: "600" }}>{t("skills.detailAgents")}</Text>
        {row.deployments?.length ? row.deployments.map((deployment: Record<string, any>) => (
          <Text class="text-muted-foreground" style={{ fontSize: 11 }}>
            {`${deployment.name} · ${deployment.scope === "project" ? deployment.projectPath || "project" : "global"} · ${deployment.path}`}
          </Text>
        )) : (
          <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{t("skills.filterNotEnabled")}</Text>
        )}
      </View>
      {renderDetailActions(row)}
      <View style={{ gap: 4 }}>
        <Text style={{ color: token("foreground"), fontSize: 12, fontWeight: "600" }}>{t("common.details")}</Text>
        {detailLoading() ? (
          <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{t("common.loading")}</Text>
        ) : state?.error ? (
          <Text style={{ color: toneColor(skin(), "error", mode()), fontSize: 11 }}>{state.error}</Text>
        ) : (
          <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{(state?.readme || "").slice(0, 600)}</Text>
        )}
      </View>
    </View>
  );
}

async function checkNow(path: string): Promise<void> {
  try {
    const info = await api.checkUpdate(path, true);
    syncByPath.set({ ...syncByPath(), [path]: info });
    showToast(info.message || (info.hasUpdate ? t("skills.updateReady") : t("preview.updateCurrent")));
    await refresh();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "error");
  }
}

function unlinkDeployment(path: string): void {
  requestConfirm({
    title: tt("unlink.title", "停用"),
    body: `${tt("unlink.body", "将移除此启用位置(保留统一库主副本)")}\n${path}`,
    confirmLabel: tt("unlink.confirm", "停用"),
    onConfirm: async () => {
      await api.unlinkSymlinkSkill(path);
      showToast(tt("unlink.done", "已停用"));
      await refresh();
    },
  });
}

function trashSkillRow(path: string, name: string): void {
  requestConfirm({
    title: tt("trash.title", "移除"),
    body: `${tt("trash.body", "移入撤销暂存,期内可恢复")}\n${name}`,
    confirmLabel: tt("trash.confirm", "移除"),
    danger: true,
    onConfirm: async () => {
      const receipt = await api.trashSkill(path);
      showUndoBar(receipt);
      await refresh();
    },
  });
}

function renderDetailActions(row: Record<string, any>) {
  const name = row.manifest_title || row.name || "";
  const sync = syncByPath()[row.path];
  const buttons: { label: string; danger?: boolean; onPress: () => void }[] = [];
  if (row.in_library) {
    buttons.push({
      label: t("install.action.enable"),
      onPress: () => openInstallFlow("enable", {
        source: "local",
        packageValue: row.path,
        assistantName: row.availableIn?.[0]?.name ?? "",
        installMode: "copy",
      }),
    });
  }
  buttons.push({ label: t("preview.checkUpdate"), onPress: () => void checkNow(row.path) });
  if (sync?.hasUpdate && sync?.canSync) {
    buttons.push({ label: t("skills.updateAction"), onPress: () => void openUpdatePreview(row.path, name) });
  }
  for (const deployment of row.deployments ?? []) {
    if (deployment.managed && deployment.isSymlink) {
      buttons.push({ label: `${tt("unlink.confirm", "停用")} ${deployment.name}`, danger: true, onPress: () => unlinkDeployment(deployment.path) });
    }
  }
  buttons.push({ label: tt("trash.confirm", "移除"), danger: true, onPress: () => trashSkillRow(row.path, name) });
  if (row.in_library || row.source_type === "deployment") {
    buttons.push({
      label: t("skills.openFolder", { name }),
      onPress: () => {
        void (async () => {
          try {
            await api.openFolder(String(row.path));
          } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), "error");
          }
        })();
      },
    });
  }
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {buttons.map((button) => (
          <Text
            role="button"
            accessibilityLabel={button.label}
            onPress={button.onPress}
            style={{
              color: button.danger ? toneColor(skin(), "error", mode()) : token("primary"),
              fontSize: 12,
              fontWeight: "600",
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderWidth: skinStyle(skin()).borderWidth,
              borderColor: button.danger ? toneColor(skin(), "error", mode()) : token("border"),
              borderRadius: skinStyle(skin()).radius,
            }}
          >
            {button.label}
          </Text>
        ))}
      </View>
      {sync ? (
        <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{String(sync.message || "")}</Text>
      ) : null}
    </View>
  );
}

function renderSkills() {
  const rows = visibleRows();
  const identityProbe = selectedIdentity();
  console.log("renderSkills run, identity:", JSON.stringify(identityProbe));
  const style = skinStyle(skin());
  return (
    <View style={{ gap: 10 }}>
      {renderHeaderActions()}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="search" size={14} />
        <Input
          value={query()}
          onChange={({ value }: { value: string }) => {
            query.set(value);
            scheduleBodySearch();
          }}
          placeholder={tt("skills.searchHint", "搜索名称与正文")}
          accessibilityLabel={t("common.search")}
          style={{
            flex: 1,
            backgroundColor: token("card"),
            color: token("foreground"),
            borderWidth: style.borderWidth,
            borderColor: token("border"),
            borderRadius: style.radius,
            paddingHorizontal: 10,
            paddingVertical: 8,
            fontSize: 13,
          }}
        />
      </View>
      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        {FILTERS.map((item) => (
          <Text
            role="button"
            accessibilityLabel={t(item.labelKey)}
            onPress={() => filter.set(item.id)}
            style={{
              color: filter() === item.id ? token("primary") : token("muted-foreground"),
              fontSize: 13,
              fontWeight: filter() === item.id ? "650" : "400",
            }}
          >
            {t(item.labelKey)}
          </Text>
        ))}
        <View style={{ width: 1, height: 14, backgroundColor: token("border") }} />
        <Text
          role="button"
          accessibilityLabel="A-Z"
          onPress={() => sortMode.set("name")}
          style={{ color: sortMode() === "name" ? token("primary") : token("muted-foreground"), fontSize: 13, fontWeight: sortMode() === "name" ? "650" : "400" }}
        >
          A-Z
        </Text>
        <Text
          role="button"
          accessibilityLabel={tt("sort.updates", "有更新优先")}
          onPress={() => sortMode.set("updates")}
          style={{ color: sortMode() === "updates" ? token("primary") : token("muted-foreground"), fontSize: 13, fontWeight: sortMode() === "updates" ? "650" : "400" }}
        >
          {tt("sort.updates", "有更新优先")}
        </Text>
      </View>
      {tags().length > 0 ? (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Text
            role="button"
            accessibilityLabel={tt("tags.all", "全部标签")}
            onPress={() => tagFilter.set(null)}
            style={{ color: tagFilter() === null ? token("primary") : token("muted-foreground"), fontSize: 12 }}
          >
            {tt("tags.all", "全部标签")}
          </Text>
          {tags().map((tag: Record<string, any>) => (
            <Text
              role="button"
              accessibilityLabel={String(tag.name)}
              onPress={() => tagFilter.set(String(tag.name))}
              style={{ color: tagFilter() === tag.name ? token("primary") : token("muted-foreground"), fontSize: 12 }}
            >
              {String(tag.name)}
            </Text>
          ))}
        </View>
      ) : null}
      {scenarios().length > 0 ? (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Text
            role="button"
            accessibilityLabel={tt("scenarios.all", "全部场景")}
            onPress={() => scenarioFilter.set(null)}
            style={{ color: scenarioFilter() === null ? token("primary") : token("muted-foreground"), fontSize: 12 }}
          >
            {tt("scenarios.all", "全部场景")}
          </Text>
          {scenarios().map((scenario: Record<string, any>) => (
            <Text
              role="button"
              accessibilityLabel={String(scenario.name)}
              onPress={() => scenarioFilter.set(String(scenario.id))}
              style={{ color: scenarioFilter() === scenario.id ? token("primary") : token("muted-foreground"), fontSize: 12 }}
            >
              {String(scenario.name)}
            </Text>
          ))}
        </View>
      ) : null}
      {renderBatchBar()}
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <View style={{ flex: 2, gap: 8 }}>
          {rows.length === 0 ? (
            <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{t("common.unknown")}</Text>
          ) : (
            rows.map((row) => renderSkillRow(row))
          )}
        </View>
        <View
          style={{
            flex: 1,
            minWidth: 260,
            backgroundColor: token("card"),
            borderWidth: style.borderWidth,
            borderColor: token("border"),
            borderRadius: style.radius,
            padding: 12,
          }}
        >
          {renderDetailPane()}
        </View>
      </View>
    </View>
  );
}

export function SkillsView() {
  return <View>{renderSkills()}</View>;
}
