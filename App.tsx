// 应用壳层,对齐原版布局:
// 顶栏(logo + SkillMate / 右侧刷新)→ [侧栏(导航+徽标,设置沉底) | 内容区(页头+视图)]。
import { mount, Scroll, Text, View, token } from "nsh";
import { t } from "nsh/i18n";
import { skinStyle } from "./src/theme";
import { dashboard, focusSearch, loading, refresh, skin, view, type ViewId } from "./src/state";
import { buildUniqueSkillInventory, buildSkillCardView } from "./src/lib/inventory";
import { AppLogo, Icon } from "./src/components/Icon";
import { Overlays } from "./src/components/Overlays";
import { setupTray } from "./src/tray";
import { DashboardView } from "./src/screens/DashboardView";
import { SkillsView } from "./src/screens/SkillsView";
import { AssistantsView, ScenariosView, SettingsView } from "./src/screens/SimpleViews";

const NAV: { id: ViewId; icon: string; labelKey: string }[] = [
  { id: "dashboard", icon: "dashboard", labelKey: "nav.dashboard" },
  { id: "skills", icon: "skills", labelKey: "nav.skills" },
  { id: "assistants", icon: "assistants", labelKey: "nav.assistants" },
  { id: "scenarios", icon: "scenarios", labelKey: "nav.scenarios" },
];

function navStats() {
  const data = dashboard();
  if (!data) return { skills: 0, updates: 0, assistants: 0 };
  const unique = buildUniqueSkillInventory(data.assistants ?? [], t);
  const updates = unique.filter((skill) => buildSkillCardView(skill, t).hasUpdate).length;
  return {
    skills: unique.length,
    updates,
    assistants: (data.assistants ?? []).length,
  };
}

function renderNavItem(item: { id: ViewId; icon: string; labelKey: string }) {
  const active = view() === item.id;
  const stats = navStats();
  return (
    <View
      role="button"
      accessibilityLabel={t(item.labelKey)}
      accessibilityState={active ? { current: "page" } : undefined}
      onPress={() => view.set(item.id)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: active ? token("muted") : "transparent",
        borderRadius: skinStyle(skin()).radius,
      }}
    >
      <Icon name={item.icon} size={17} color={active ? token("primary") : token("muted-foreground")} />
      <Text
        style={{
          color: active ? token("primary") : token("foreground"),
          fontSize: 13,
          fontWeight: active ? "650" : "400",
        }}
      >
        {t(item.labelKey)}
      </Text>
      {item.id === "skills" && stats.skills > 0 ? (
        <View
          style={{
            backgroundColor: token("border"),
            borderRadius: 9,
            paddingHorizontal: 6,
            paddingVertical: 1,
          }}
        >
          <Text style={{ color: token("foreground"), fontSize: 11 }}>{String(stats.skills)}</Text>
        </View>
      ) : null}
      {item.id === "skills" && stats.updates > 0 ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: token("muted-foreground"),
            borderRadius: 9,
            paddingHorizontal: 6,
            paddingVertical: 1,
          }}
        >
          <Text style={{ color: token("muted-foreground"), fontSize: 11 }}>{String(stats.updates)}</Text>
        </View>
      ) : null}
      {item.id === "assistants" && stats.assistants > 0 ? (
        <View
          style={{
            backgroundColor: token("border"),
            borderRadius: 9,
            paddingHorizontal: 6,
            paddingVertical: 1,
          }}
        >
          <Text style={{ color: token("foreground"), fontSize: 11 }}>{String(stats.assistants)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function renderSettingsNav() {
  const active = view() === "settings";
  return (
    <View
      role="button"
      accessibilityLabel={t("nav.settings")}
      accessibilityState={active ? { current: "page" } : undefined}
      onPress={() => view.set("settings")}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: skinStyle(skin()).radius,
      }}
    >
      <Icon name="settings" size={17} color={active ? token("primary") : token("muted-foreground")} />
      <Text style={{ color: active ? token("primary") : token("foreground"), fontSize: 13, fontWeight: active ? "650" : "400" }}>
        {t("nav.settings")}
      </Text>
    </View>
  );
}

function renderContent() {
  const current = view();
  if (current === "dashboard") return <DashboardView />;
  if (current === "skills") return <SkillsView />;
  if (current === "assistants") return <AssistantsView />;
  if (current === "scenarios") return <ScenariosView />;
  return <SettingsView />;
}

// 应用内快捷键:Alt+1~5 切视图,Ctrl+K 跳到技能库并聚焦搜索(与原版一致)。
// 挂根容器;keydown 会从聚焦子视图冒泡上来。
function handleKeyDown(e: { key: string; modifiers: { alt: boolean; control: boolean } }): void {
  const viewIds: ViewId[] = ["dashboard", "skills", "assistants", "scenarios", "settings"];
  if (e.modifiers.alt && e.key >= "1" && e.key <= "5") {
    view.set(viewIds[Number(e.key) - 1]);
    return;
  }
  if (e.modifiers.control && (e.key === "k" || e.key === "K")) {
    focusSearch.set(true);
    view.set("skills");
  }
}

function App() {
  return (
    <View
      style={{ flex: 1, backgroundColor: token("background") }}
      focusable={true}
      onKeyDown={handleKeyDown as never}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderBottomWidth: skinStyle(skin()).borderWidth,
          borderBottomColor: token("border"),
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <AppLogo size={22} />
          <Text style={{ color: token("foreground"), fontSize: 15, fontWeight: "780" }}>SkillMate</Text>
        </View>
        <View
          role="button"
          accessibilityLabel={t("common.refresh")}
          onPress={() => void refresh()}
          style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: skinStyle(skin()).radius }}
        >
          <Icon name="refresh" size={17} color={loading() ? token("muted-foreground") : token("muted-foreground")} />
        </View>
      </View>
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View
          accessibilityLabel={t("nav.primary")}
          style={{
            width: 216,
            borderRightWidth: skinStyle(skin()).borderWidth,
            borderRightColor: token("border"),
            paddingVertical: 12,
            paddingHorizontal: 8,
          }}
        >
          {NAV.map((item) => renderNavItem(item))}
          <View style={{ flexGrow: 1 }} />
          {renderSettingsNav()}
        </View>
        <Scroll style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 28, paddingVertical: 24, maxWidth: 1180 }}>
            {renderContent()}
          </View>
        </Scroll>
      </View>
      {/* 浮层最后绘制,盖在内容之上 */}
      <Overlays />
    </View>
  );
}

mount(App);
setupTray();
