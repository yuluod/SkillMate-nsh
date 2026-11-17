// 概览,对齐原版结构:
// 页头(标题+说明+添加按钮)→ 首跑引导(skills=0)→ 五格统计条 → 需处理(仅>0 行)。
// 组件只做壳,逻辑在 render*(从 JSX 调用,signal 读取被追踪)。
import { Text, View, token } from "nsh";
import { t } from "nsh/i18n";
import { Icon } from "../components/Icon";
import { skinStyle, toneColor } from "../theme";
import { dashboard, filter, loading, loadError, mode, skin, tags, view } from "../state";
import { buildDashboardStats, buildUnifiedSkillInventory, buildUniqueSkillInventory, type DashboardStats } from "../lib/inventory";
import { buildDriftGroups, openDriftGroup } from "../flows";

function jumpTo(filterValue: "needsAttention" | "updates"): void {
  filter.set(filterValue);
  view.set("skills");
}

function renderAttentionRow(
  icon: string,
  tone: "warn" | "error" | "default",
  title: string,
  body: string,
  onPress: () => void,
) {
  const color = tone === "warn"
    ? toneColor(skin(), "warn", mode())
    : tone === "error"
      ? toneColor(skin(), "error", mode())
      : token("muted-foreground");
  return (
    <View
      role="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 11,
        borderWidth: skinStyle(skin()).borderWidth,
        borderColor: token("border"),
        borderRadius: skinStyle(skin()).radius,
        marginBottom: 8,
      }}
    >
      <Icon name={icon} size={18} color={color} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: token("foreground"), fontSize: 13, fontWeight: "600" }}>{title}</Text>
        <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{body}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text style={{ color: token("primary"), fontSize: 12 }}>{t("dashboard.review")}</Text>
        <Icon name="arrow" size={13} color={token("primary")} />
      </View>
    </View>
  );
}

function renderStatCell(
  label: string,
  value: number,
  onPress?: () => void,
  alert = false,
) {
  const color = alert && value > 0 ? toneColor(skin(), "error", mode()) : token("foreground");
  const content = (
    <View style={{ alignItems: "flex-start", gap: 2, paddingHorizontal: 4 }}>
      <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ color, fontSize: 22, fontWeight: "650" }}>{String(value)}</Text>
        {onPress ? <Icon name="arrow" size={14} color={token("muted-foreground")} /> : null}
      </View>
    </View>
  );
  if (onPress) {
    return (
      <View
        role="button"
        accessibilityLabel={`${label} ${value}`}
        onPress={onPress}
        style={{ flex: 1, paddingHorizontal: 12 }}
      >
        {content}
      </View>
    );
  }
  return <View style={{ flex: 1, paddingHorizontal: 12 }}>{content}</View>;
}

function renderFirstRun() {
  const steps = [
    { title: t("dashboard.firstRunAdd"), hint: t("dashboard.firstRunAddHint") },
    { title: t("dashboard.firstRunAdopt"), hint: t("dashboard.firstRunAdoptHint") },
    { title: t("dashboard.firstRunEnable"), hint: t("dashboard.firstRunEnableHint") },
  ];
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: token("foreground"), fontSize: 14, fontWeight: "650" }}>{t("dashboard.firstRunTitle")}</Text>
      <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{t("dashboard.firstRunHint")}</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {steps.map((step) => (
          <View
            style={{
              flex: 1,
              gap: 4,
              padding: 12,
              backgroundColor: token("card"),
              borderWidth: skinStyle(skin()).borderWidth,
              borderColor: token("border"),
              borderRadius: skinStyle(skin()).radius,
            }}
          >
            <Text style={{ color: token("foreground"), fontSize: 13, fontWeight: "600" }}>{step.title}</Text>
            <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{step.hint}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function renderDashboard() {
  const data = dashboard();
  if (loading() && !data) {
    return <Text class="text-muted-foreground">{t("common.loading")}</Text>;
  }
  if (loadError()) {
    return <Text style={{ color: toneColor(skin(), "error", mode()), fontSize: 13 }}>{loadError()}</Text>;
  }
  if (!data) return null;
  const stats: DashboardStats = buildDashboardStats(data.assistants ?? [], data.library_skills ?? [], t);
  const driftGroups = buildDriftGroups(
    buildUnifiedSkillInventory(buildUniqueSkillInventory(data.assistants ?? [], t)),
  );
  const attentionCount = stats.updates + stats.structureIssues + stats.securityRisks
    + stats.localChanges + stats.diagnostics + stats.stale;
  return (
    <View style={{ gap: 24 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <View style={{ gap: 6 }}>
          <Text style={{ color: token("foreground"), fontSize: 22, fontWeight: "780" }}>{t("dashboard.title")}</Text>
          <Text class="text-muted-foreground" style={{ fontSize: 13 }}>{t("dashboard.subtitle")}</Text>
        </View>
        <View
          role="button"
          accessibilityLabel={t("common.install")}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            backgroundColor: token("primary"),
            borderRadius: skinStyle(skin()).radius,
            paddingHorizontal: 14,
            paddingVertical: 8,
          }}
        >
          <Icon name="plus" size={14} color={token("primary-foreground")} />
          <Text style={{ color: token("primary-foreground"), fontSize: 13, fontWeight: "600" }}>
            {t("common.install")}
          </Text>
        </View>
      </View>
      {stats.skills === 0 ? renderFirstRun() : null}
      <View
        accessibilityLabel={t("dashboard.statusSummary")}
        style={{
          flexDirection: "row",
          paddingVertical: 10,
          borderTopWidth: skinStyle(skin()).borderWidth,
          borderBottomWidth: skinStyle(skin()).borderWidth,
          borderTopColor: token("border"),
          borderBottomColor: token("border"),
        }}
      >
        {renderStatCell(stats.external > 0 ? t("dashboard.skillsWithExternal", { count: stats.external }) : t("dashboard.skills"), stats.skills, () => view.set("skills"))}
        {renderStatCell(t("dashboard.assistants"), stats.assistants, () => view.set("assistants"))}
        {renderStatCell(t("dashboard.tags"), tags().length)}
        {renderStatCell(t("dashboard.updates"), stats.updates, () => jumpTo("updates"))}
        {renderStatCell(t("dashboard.risks"), attentionCount, undefined, attentionCount > 0)}
      </View>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: token("foreground"), fontSize: 14, fontWeight: "650" }}>{t("dashboard.attention")}</Text>
          <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{t("dashboard.attentionHint")}</Text>
        </View>
        {stats.updates > 0
          ? renderAttentionRow("updates", "warn", t("dashboard.updateTitle", { count: stats.updates }), t("dashboard.updateBody"), () => jumpTo("updates"))
          : null}
        {stats.securityRisks > 0
          ? renderAttentionRow("shield", "error", t("dashboard.securityTitle", { count: stats.securityRisks }), t("dashboard.securityBody"), () => jumpTo("needsAttention"))
          : null}
        {stats.structureIssues > 0
          ? renderAttentionRow("skills", "warn", t("dashboard.structureTitle", { count: stats.structureIssues }), t("dashboard.structureBody"), () => jumpTo("needsAttention"))
          : null}
        {stats.localChanges > 0
          ? renderAttentionRow("edit", "error", t("dashboard.localTitle", { count: stats.localChanges }), t("dashboard.localBody"), () => jumpTo("needsAttention"))
          : null}
        {stats.stale > 0
          ? renderAttentionRow("unlink", "warn", t("dashboard.staleTitle", { count: stats.stale }), t("dashboard.staleBody"), () => jumpTo("needsAttention"))
          : null}
        {driftGroups.map((group) => (
          renderAttentionRow(
            "branch",
            "warn",
            `${group.name} · ${t("drift.versions", { count: group.versionCount })}`,
            t("dashboard.driftBody"),
            () => void openDriftGroup(group),
          )
        ))}
        {stats.diagnostics > 0
          ? renderAttentionRow("search", "default", t("dashboard.diagnosticTitle", { count: stats.diagnostics }), t("dashboard.diagnosticBody"), () => view.set("assistants"))
          : null}
        {attentionCount === 0 ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              padding: 14,
              borderWidth: skinStyle(skin()).borderWidth,
              borderColor: token("border"),
              borderRadius: skinStyle(skin()).radius,
            }}
          >
            <Icon name="check" size={20} color={toneColor(skin(), "success", mode())} />
            <View style={{ gap: 2 }}>
              <Text style={{ color: token("foreground"), fontSize: 13, fontWeight: "600" }}>{t("dashboard.allClear")}</Text>
              <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{t("dashboard.allClearHint")}</Text>
            </View>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 4 }}>
          <Icon name="shield" size={14} />
          <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{t("dashboard.localNote")}</Text>
        </View>
      </View>
    </View>
  );
}

export function DashboardView() {
  return <View>{renderDashboard()}</View>;
}
