// 全局浮层:toast / 确认弹窗 / 撤销条 / 安装弹窗 / 更新预览弹窗。
// App 底部挂一次;signal 读取全部在 JSX 调用链上。
import { Text, View, token } from "nsh";
import { Input } from "nsh/base";
import { t } from "nsh/i18n";
import { skinStyle, toneColor } from "../theme";
import { mode, skin } from "../state";
import { Icon } from "./Icon";
import {
  adoptApplying, adoptAssistant, adoptError, adoptOpen, adoptPath, adoptPreview, adoptPreviewing,
  applyDriftSync, applyTagsToSelection, applyUpdate, tt, closeInstallFlow, confirmBusy, confirmState,
  createScenarioNow, createTag, deleteTagConfirm, driftApplying, driftState, installApplying,
  installContext, installError, installOpen, installPreview, installPreviewing, installMarketItem,
  marketError, marketItems, marketLoading, marketOpen, marketQuery, openScenarioCreate,
  runAdoptApply, runAdoptPreview, runInstallApply, runInstallPreview, runMarketSearch,
  scenarioCreateOpen, scenarioBusy, scenarioDescDraft, scenarioNameDraft, scenarioSelected,
  settleConfirm, TAG_COLORS, tagBusy, tagColorDraft, tagEditorBusy, tagEditorOpen, tagEditorSelection,
  tagNameDraft, tagManagerOpen, toast, undoBar, undoTrash, updateApplying, updatePreviewState,
} from "../flows";
import { tags } from "../state";

function sheet(children: ReturnType<typeof View>) {
  return (
    <View
      style={{
        position: "absolute",
        left: 0, right: 0, top: 0, bottom: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        alignItems: "center",
        justifyContent: "center",
      }}
      role="dialog"
    >
      <View
        style={{
          width: 560,
          maxWidth: "92%",
          maxHeight: "86%",
          backgroundColor: token("card"),
          borderWidth: skinStyle(skin()).borderWidth,
          borderColor: token("border"),
          borderRadius: skinStyle(skin()).radius,
          padding: 18,
          gap: 12,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function renderInstallModal() {
  if (!installOpen()) return null;
  const context = installContext();
  const preview = installPreview();
  const error = installError();
  const primaryLabel = installApplying()
    ? tt("install.applying", "执行中...")
    : preview?.can_apply
      ? (context.workflow === "enable" ? tt("install.action.enable", "启用") : tt("install.action.add", "添加到库"))
      : installPreviewing()
        ? tt("install.action.analyzing", "分析中...")
        : tt("install.action.analyze", "分析");
  return sheet(
    <View style={{ gap: 12 }}>
      <Text style={{ color: token("foreground"), fontSize: 15, fontWeight: "650" }}>
        {context.workflow === "enable" ? tt("install.title.enable", "启用 Skill") : tt("install.title.add", "添加 Skill")}
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{tt("install.source", "来源")}</Text>
          <Input
            value={context.packageValue}
            onChange={({ value }: { value: string }) => {
              installContext.set({ ...context, packageValue: value });
              installPreview.set(null);
            }}
            placeholder={tt("install.sourcePlaceholder", "本地目录或 Git 仓库")}
            style={{
              backgroundColor: token("background"),
              color: token("foreground"),
              borderWidth: skinStyle(skin()).borderWidth,
              borderColor: token("border"),
              borderRadius: skinStyle(skin()).radius,
              paddingHorizontal: 10,
              paddingVertical: 7,
              fontSize: 12,
            }}
          />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{tt("install.assistant", "目标助手")}</Text>
          <Input
            value={context.assistantName}
            onChange={({ value }: { value: string }) => {
              installContext.set({ ...context, assistantName: value });
              installPreview.set(null);
            }}
            placeholder="Claude Code"
            style={{
              backgroundColor: token("background"),
              color: token("foreground"),
              borderWidth: skinStyle(skin()).borderWidth,
              borderColor: token("border"),
              borderRadius: skinStyle(skin()).radius,
              paddingHorizontal: 10,
              paddingVertical: 7,
              fontSize: 12,
            }}
          />
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["library", "copy", "symlink"] as const).map((modeValue) => (
          <Text
            role="button"
            accessibilityLabel={modeValue}
            onPress={() => {
              installContext.set({ ...context, installMode: modeValue });
              installPreview.set(null);
            }}
            style={{
              color: context.installMode === modeValue ? token("primary") : token("muted-foreground"),
              fontSize: 12,
              fontWeight: context.installMode === modeValue ? "650" : "400",
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            {modeValue === "library" ? tt("install.mode.library", "仅入库") : modeValue === "copy" ? tt("install.mode.copy", "全局复制") : tt("install.mode.symlink", "项目软链")}
          </Text>
        ))}
      </View>
      {preview ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: preview.can_apply ? toneColor(skin(), "success", mode()) : toneColor(skin(), "error", mode()), fontSize: 12 }}>
            {preview.message}
          </Text>
          <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{`${tt("install.target", "目标")}: ${preview.target_path || preview.target_name}`}</Text>
          {preview.target_actions.map((action) => (
            <Text class="text-muted-foreground" style={{ fontSize: 11 }}>
              {`${action.action} · ${action.target}`}
            </Text>
          ))}
          {preview.selection_required ? (
            <Text style={{ color: toneColor(skin(), "warn", mode()), fontSize: 11 }}>
              {tt("install.selectionRequired", "该来源包含多个 Skill,当前版本请改用子目录来源指定单个 Skill")}
            </Text>
          ) : null}
        </View>
      ) : null}
      {error ? <Text style={{ color: toneColor(skin(), "error", mode()), fontSize: 12 }}>{error}</Text> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <View
          role="button"
          accessibilityLabel={t("common.cancel")}
          onPress={() => closeInstallFlow()}
          style={{
            paddingHorizontal: 14, paddingVertical: 7,
            borderWidth: skinStyle(skin()).borderWidth, borderColor: token("border"),
            borderRadius: skinStyle(skin()).radius,
          }}
        >
          <Text style={{ color: token("muted-foreground"), fontSize: 13 }}>{t("common.cancel")}</Text>
        </View>
        <View
          testID="install-primary"
          role="button"
          accessibilityLabel={primaryLabel}
          onPress={() => {
            if (!installPreview()?.can_apply) void runInstallPreview();
            else void runInstallApply();
          }}
          style={{
            paddingHorizontal: 14, paddingVertical: 7,
            backgroundColor: token("primary"),
            borderRadius: skinStyle(skin()).radius,
          }}
        >
          <Text style={{ color: token("primary-foreground"), fontSize: 13, fontWeight: "600" }}>{primaryLabel}</Text>
        </View>
      </View>
    </View>,
  );
}

function renderConfirmModal() {
  const state = confirmState();
  if (!state) return null;
  return sheet(
    <View style={{ gap: 12 }}>
      <Text style={{ color: token("foreground"), fontSize: 15, fontWeight: "650" }}>{state.title}</Text>
      <Text class="text-muted-foreground" style={{ fontSize: 13 }}>{state.body}</Text>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <View
          role="button"
          accessibilityLabel={t("common.cancel")}
          onPress={() => confirmState.set(null)}
          style={{ paddingHorizontal: 14, paddingVertical: 7, borderWidth: skinStyle(skin()).borderWidth, borderColor: token("border"), borderRadius: skinStyle(skin()).radius }}
        >
          <Text style={{ color: token("muted-foreground"), fontSize: 13 }}>{t("common.cancel")}</Text>
        </View>
        <View
          role="button"
          accessibilityLabel={state.confirmLabel}
          onPress={() => void settleConfirm()}
          style={{
            paddingHorizontal: 14, paddingVertical: 7,
            backgroundColor: state.danger ? toneColor(skin(), "error", mode()) : token("primary"),
            borderRadius: skinStyle(skin()).radius,
          }}
        >
          <Text style={{ color: token("primary-foreground"), fontSize: 13, fontWeight: "600" }}>
            {confirmBusy() ? t("common.loading") : state.confirmLabel}
          </Text>
        </View>
      </View>
    </View>,
  );
}

function renderUpdateModal() {
  const state = updatePreviewState();
  if (!state) return null;
  const preview = state.preview;
  return sheet(
    <View style={{ gap: 12 }}>
      <Text style={{ color: token("foreground"), fontSize: 15, fontWeight: "650" }}>
        {tt("updatePreview.title", "更新预览")}
      </Text>
      <Text style={{ color: preview.canApply ? token("foreground") : toneColor(skin(), "warn", mode()), fontSize: 12 }}>
        {preview.blockedReason || `${preview.installedRef} → ${preview.latestRef}`}
      </Text>
      <View style={{ gap: 2 }}>
        {preview.impacts.map((impact) => (
          <Text class="text-muted-foreground" style={{ fontSize: 11 }}>
            {`${impact.assistant} · ${impact.scope}${impact.projectPath ? ` · ${impact.projectPath}` : ""}`}
          </Text>
        ))}
        {preview.files.slice(0, 12).map((file) => (
          <Text class="text-muted-foreground" style={{ fontSize: 11 }}>
            {`${file.kind} · ${file.path}`}
          </Text>
        ))}
        {preview.files.length === 0 ? (
          <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{tt("updatePreview.noFiles", "无文件差异明细")}</Text>
        ) : null}
        {preview.omittedFiles > 0 ? (
          <Text class="text-muted-foreground" style={{ fontSize: 11 }}>
            {tt("updatePreview.omitted", "另有 %{count} 个变更文件未展开").replace("%{count}", String(preview.omittedFiles))}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <View
          role="button"
          accessibilityLabel={t("common.cancel")}
          onPress={() => updatePreviewState.set(null)}
          style={{ paddingHorizontal: 14, paddingVertical: 7, borderWidth: skinStyle(skin()).borderWidth, borderColor: token("border"), borderRadius: skinStyle(skin()).radius }}
        >
          <Text style={{ color: token("muted-foreground"), fontSize: 13 }}>{t("common.cancel")}</Text>
        </View>
        <View
          role="button"
          accessibilityLabel={tt("updatePreview.apply", "执行更新")}
          onPress={() => void applyUpdate()}
          style={{ paddingHorizontal: 14, paddingVertical: 7, backgroundColor: token("primary"), borderRadius: skinStyle(skin()).radius }}
        >
          <Text style={{ color: token("primary-foreground"), fontSize: 13, fontWeight: "600" }}>
            {updateApplying() ? t("common.loading") : tt("updatePreview.apply", "执行更新")}
          </Text>
        </View>
      </View>
    </View>,
  );
}

function renderAdoptModal() {
  if (!adoptOpen()) return null;
  const preview = adoptPreview();
  return sheet(
    <View style={{ gap: 12 }}>
      <Text style={{ color: token("foreground"), fontSize: 15, fontWeight: "650" }}>{tt("adopt.title", "接管已有 Skill")}</Text>
      <View style={{ gap: 4 }}>
        <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{tt("adopt.path", "本地目录")}</Text>
        <Input
          value={adoptPath()}
          onChange={({ value }: { value: string }) => { adoptPath.set(value); adoptPreview.set(null); }}
          style={{
            backgroundColor: token("background"), color: token("foreground"),
            borderWidth: skinStyle(skin()).borderWidth, borderColor: token("border"),
            borderRadius: skinStyle(skin()).radius, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12,
          }}
        />
      </View>
      <View style={{ gap: 4 }}>
        <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{t("install.assistant")}</Text>
        <Input
          value={adoptAssistant()}
          onChange={({ value }: { value: string }) => { adoptAssistant.set(value); adoptPreview.set(null); }}
          placeholder="Claude Code"
          style={{
            backgroundColor: token("background"), color: token("foreground"),
            borderWidth: skinStyle(skin()).borderWidth, borderColor: token("border"),
            borderRadius: skinStyle(skin()).radius, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12,
          }}
        />
      </View>
      {preview ? (
        <Text style={{ color: preview.can_apply ? toneColor(skin(), "success", mode()) : toneColor(skin(), "error", mode()), fontSize: 12 }}>
          {preview.message}
        </Text>
      ) : null}
      {adoptError() ? <Text style={{ color: toneColor(skin(), "error", mode()), fontSize: 12 }}>{adoptError()}</Text> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <View role="button" accessibilityLabel={t("common.cancel")} onPress={() => adoptOpen.set(false)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderWidth: skinStyle(skin()).borderWidth, borderColor: token("border"), borderRadius: skinStyle(skin()).radius }}>
          <Text style={{ color: token("muted-foreground"), fontSize: 13 }}>{t("common.cancel")}</Text>
        </View>
        <View
          role="button"
          accessibilityLabel={tt("adopt.confirm", "接管")}
          onPress={() => (preview?.can_apply ? void runAdoptApply() : void runAdoptPreview())}
          style={{ paddingHorizontal: 14, paddingVertical: 7, backgroundColor: token("primary"), borderRadius: skinStyle(skin()).radius }}
        >
          <Text style={{ color: token("primary-foreground"), fontSize: 13, fontWeight: "600" }}>
            {adoptApplying() ? t("common.loading") : preview?.can_apply ? tt("adopt.confirm", "接管") : adoptPreviewing() ? t("common.loading") : tt("adopt.analyze", "分析")}
          </Text>
        </View>
      </View>
    </View>,
  );
}

function renderTagManagerModal() {
  if (!tagManagerOpen()) return null;
  return sheet(
    <View style={{ gap: 12 }}>
      <Text style={{ color: token("foreground"), fontSize: 15, fontWeight: "650" }}>{tt("tags.title", "标签管理")}</Text>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Input
          value={tagNameDraft()}
          onChange={({ value }: { value: string }) => tagNameDraft.set(value)}
          placeholder={tt("tags.namePlaceholder", "新标签名称")}
          style={{ flex: 1, backgroundColor: token("background"), color: token("foreground"), borderWidth: skinStyle(skin()).borderWidth, borderColor: token("border"), borderRadius: skinStyle(skin()).radius, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12 }}
        />
        <View style={{ flexDirection: "row", gap: 4 }}>
          {TAG_COLORS.map((color) => (
            <View
              role="button"
              accessibilityLabel={color}
              onPress={() => tagColorDraft.set(color)}
              style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: color, borderWidth: tagColorDraft() === color ? 2 : 0, borderColor: token("foreground") }}
            />
          ))}
        </View>
        <View role="button" accessibilityLabel={tt("tags.create", "创建")} onPress={() => void createTag()} style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: token("primary"), borderRadius: skinStyle(skin()).radius }}>
          <Text style={{ color: token("primary-foreground"), fontSize: 12, fontWeight: "600" }}>{tagBusy() ? t("common.loading") : tt("tags.create", "创建")}</Text>
        </View>
      </View>
      <View style={{ gap: 4 }}>
        {tags().map((tag: Record<string, any>) => (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 5 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: String(tag.color || token("border")) }} />
              <Text style={{ color: token("foreground"), fontSize: 12 }}>{tag.name}</Text>
            </View>
            <Text role="button" accessibilityLabel={tt("tags.delete", "删除")} onPress={() => deleteTagConfirm(String(tag.id), String(tag.name))} style={{ color: toneColor(skin(), "error", mode()), fontSize: 12 }}>
              {tt("tags.delete", "删除")}
            </Text>
          </View>
        ))}
        {tags().length === 0 ? <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{tt("tags.empty", "还没有标签")}</Text> : null}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <View role="button" accessibilityLabel={t("common.close")} onPress={() => tagManagerOpen.set(false)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderWidth: skinStyle(skin()).borderWidth, borderColor: token("border"), borderRadius: skinStyle(skin()).radius }}>
          <Text style={{ color: token("muted-foreground"), fontSize: 13 }}>{t("common.close")}</Text>
        </View>
      </View>
    </View>,
  );
}

function renderScenarioCreateModal() {
  if (!scenarioCreateOpen()) return null;
  return sheet(
    <View style={{ gap: 12 }}>
      <Text style={{ color: token("foreground"), fontSize: 15, fontWeight: "650" }}>{tt("scenarios.createTitle", "新建场景")}</Text>
      <Input
        value={scenarioNameDraft()}
        onChange={({ value }: { value: string }) => scenarioNameDraft.set(value)}
        placeholder={tt("scenarios.namePlaceholder", "场景名称")}
        style={{ backgroundColor: token("background"), color: token("foreground"), borderWidth: skinStyle(skin()).borderWidth, borderColor: token("border"), borderRadius: skinStyle(skin()).radius, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12 }}
      />
      <Input
        value={scenarioDescDraft()}
        onChange={({ value }: { value: string }) => scenarioDescDraft.set(value)}
        placeholder={tt("scenarios.descPlaceholder", "用途说明(可选)")}
        style={{ backgroundColor: token("background"), color: token("foreground"), borderWidth: skinStyle(skin()).borderWidth, borderColor: token("border"), borderRadius: skinStyle(skin()).radius, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12 }}
      />
      <Text class="text-muted-foreground" style={{ fontSize: 11 }}>
        {tt("scenarios.selectedCount", "已选 %{count} 个 Skill").replace("%{count}", String(scenarioSelected().length))}
      </Text>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <View role="button" accessibilityLabel={t("common.cancel")} onPress={() => scenarioCreateOpen.set(false)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderWidth: skinStyle(skin()).borderWidth, borderColor: token("border"), borderRadius: skinStyle(skin()).radius }}>
          <Text style={{ color: token("muted-foreground"), fontSize: 13 }}>{t("common.cancel")}</Text>
        </View>
        <View
          role="button"
          accessibilityLabel={t("scenarios.create")}
          onPress={() => void createScenarioNow()}
          style={{ paddingHorizontal: 14, paddingVertical: 7, backgroundColor: token("primary"), borderRadius: skinStyle(skin()).radius }}
        >
          <Text style={{ color: token("primary-foreground"), fontSize: 13, fontWeight: "600" }}>
            {scenarioBusy() ? t("common.loading") : t("scenarios.create")}
          </Text>
        </View>
      </View>
    </View>,
  );
}

function renderMarketModal() {
  if (!marketOpen()) return null;
  return sheet(
    <View style={{ gap: 12 }}>
      <Text style={{ color: token("foreground"), fontSize: 15, fontWeight: "650" }}>{tt("market.title", "发现 Skill")}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Input
          value={marketQuery()}
          onChange={({ value }: { value: string }) => marketQuery.set(value)}
          placeholder={tt("market.placeholder", "搜索 skills.sh")}
          style={{ flex: 1, backgroundColor: token("background"), color: token("foreground"), borderWidth: skinStyle(skin()).borderWidth, borderColor: token("border"), borderRadius: skinStyle(skin()).radius, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12 }}
        />
        <View role="button" accessibilityLabel={t("common.search")} onPress={() => void runMarketSearch()} style={{ paddingHorizontal: 14, paddingVertical: 7, backgroundColor: token("primary"), borderRadius: skinStyle(skin()).radius }}>
          <Text style={{ color: token("primary-foreground"), fontSize: 12, fontWeight: "600" }}>{marketLoading() ? t("common.loading") : t("common.search")}</Text>
        </View>
      </View>
      {marketError() ? <Text style={{ color: toneColor(skin(), "error", mode()), fontSize: 12 }}>{marketError()}</Text> : null}
      <View style={{ gap: 6 }}>
        {marketItems().map((item) => (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: token("foreground"), fontSize: 13, fontWeight: "600" }}>{String(item.name ?? item.skillId ?? "")}</Text>
              {item.description ? <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{String(item.description)}</Text> : null}
            </View>
            <Text
              role="button"
              accessibilityLabel={t("common.install")}
              onPress={() => installMarketItem(item)}
              style={{ color: token("primary"), fontSize: 12, fontWeight: "650", paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: token("primary"), borderRadius: skinStyle(skin()).radius }}
            >
              {t("common.install")}
            </Text>
          </View>
        ))}
        {marketItems().length === 0 && !marketLoading() ? (
          <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{tt("market.empty", "输入关键词开始搜索")}</Text>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <View role="button" accessibilityLabel={t("common.close")} onPress={() => marketOpen.set(false)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderWidth: skinStyle(skin()).borderWidth, borderColor: token("border"), borderRadius: skinStyle(skin()).radius }}>
          <Text style={{ color: token("muted-foreground"), fontSize: 13 }}>{t("common.close")}</Text>
        </View>
      </View>
    </View>,
  );
}

function renderTagEditorModal() {
  if (!tagEditorOpen()) return null;
  return sheet(
    <View style={{ gap: 12 }}>
      <Text style={{ color: token("foreground"), fontSize: 15, fontWeight: "650" }}>{tt("tags.editorTitle", "编辑所选标签")}</Text>
      <Text class="text-muted-foreground" style={{ fontSize: 12 }}>
        {tt("skills.selectedCount", "已选 %{count} 项").replace("%{count}", String(tagEditorSelection().length))}
      </Text>
      <View style={{ gap: 6 }}>
        {tags().map((tag: Record<string, any>) => (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: String(tag.color || token("border")) }} />
              <Text style={{ color: token("foreground"), fontSize: 12 }}>{tag.name}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Text
                role="button"
                accessibilityLabel={tt("tags.apply", "套用")}
                onPress={() => void applyTagsToSelection(String(tag.name), false)}
                style={{ color: token("primary"), fontSize: 12, fontWeight: "600" }}
              >
                {tagEditorBusy() ? "…" : tt("tags.apply", "套用")}
              </Text>
              <Text
                role="button"
                accessibilityLabel={tt("tags.remove", "移除")}
                onPress={() => void applyTagsToSelection(String(tag.name), true)}
                style={{ color: toneColor(skin(), "error", mode()), fontSize: 12, fontWeight: "600" }}
              >
                {tt("tags.remove", "移除")}
              </Text>
            </View>
          </View>
        ))}
        {tags().length === 0 ? <Text class="text-muted-foreground" style={{ fontSize: 12 }}>{tt("tags.empty", "还没有标签")}</Text> : null}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <View role="button" accessibilityLabel={t("common.close")} onPress={() => tagEditorOpen.set(false)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderWidth: skinStyle(skin()).borderWidth, borderColor: token("border"), borderRadius: skinStyle(skin()).radius }}>
          <Text style={{ color: token("muted-foreground"), fontSize: 13 }}>{t("common.close")}</Text>
        </View>
      </View>
    </View>,
  );
}

function renderDriftModal() {
  const state = driftState();
  if (!state) return null;
  return sheet(
    <View style={{ gap: 12 }}>
      <Text style={{ color: token("foreground"), fontSize: 15, fontWeight: "650" }}>{tt("drift.title", "多副本同步")}</Text>
      <Text style={{ color: state.preview.can_apply ? token("foreground") : toneColor(skin(), "warn", mode()), fontSize: 12 }}>
        {state.preview.message}
      </Text>
      <View style={{ gap: 2 }}>
        <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{`${tt("drift.source", "源")}: ${state.source}`}</Text>
        {state.targets.map((target) => (
          <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{`${tt("drift.target", "目标")}: ${target}`}</Text>
        ))}
        {(state.preview.changed_files ?? []).slice(0, 10).map((file) => (
          <Text class="text-muted-foreground" style={{ fontSize: 11 }}>{`${file.kind} · ${file.path}`}</Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <View role="button" accessibilityLabel={t("common.cancel")} onPress={() => driftState.set(null)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderWidth: skinStyle(skin()).borderWidth, borderColor: token("border"), borderRadius: skinStyle(skin()).radius }}>
          <Text style={{ color: token("muted-foreground"), fontSize: 13 }}>{t("common.cancel")}</Text>
        </View>
        <View
          role="button"
          accessibilityLabel={tt("drift.apply", "同步")}
          onPress={() => void applyDriftSync()}
          style={{ paddingHorizontal: 14, paddingVertical: 7, backgroundColor: token("primary"), borderRadius: skinStyle(skin()).radius }}
        >
          <Text style={{ color: token("primary-foreground"), fontSize: 13, fontWeight: "600" }}>
            {driftApplying() ? t("common.loading") : tt("drift.apply", "同步")}
          </Text>
        </View>
      </View>
    </View>,
  );
}

function renderToastNode(currentToast: { text: string; tone: "info" | "error" }) {
  return (
    <View
      accessibilityLabel={currentToast.text}
      style={{
        position: "absolute",
        bottom: 64,
        left: 0, right: 0,
        alignItems: "center",
      }}
    >
      <View
        style={{
          backgroundColor: token("card"),
          borderWidth: skinStyle(skin()).borderWidth,
          borderColor: currentToast.tone === "error" ? toneColor(skin(), "error", mode()) : token("border"),
          borderRadius: skinStyle(skin()).radius,
          paddingHorizontal: 14,
          paddingVertical: 8,
        }}
      >
        <Text style={{ color: token("foreground"), fontSize: 12 }}>{currentToast.text}</Text>
      </View>
    </View>
  );
}

function renderUndoNode(undo: { receipt: Record<string, any>; timer: unknown }) {
  return (
    <View
      style={{
        position: "absolute",
        bottom: 18,
        left: 0, right: 0,
        alignItems: "center",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: token("card"),
          borderWidth: skinStyle(skin()).borderWidth,
          borderColor: token("border"),
          borderRadius: skinStyle(skin()).radius,
          paddingHorizontal: 14,
          paddingVertical: 8,
        }}
      >
        <Text style={{ color: token("foreground"), fontSize: 12 }}>
          {tt("trash.undoHint", "已移入撤销暂存")}
        </Text>
        <Text
          role="button"
          accessibilityLabel={tt("trash.undo", "撤销")}
          onPress={() => void undoTrash()}
          style={{ color: token("primary"), fontSize: 12, fontWeight: "650" }}
        >
          {tt("trash.undo", "撤销")}
        </Text>
      </View>
    </View>
  );
}

// 注意:NSH 组件函数体是一次性 setup——所有 signal 条件必须放在
// JSX 表达式里;且不要包全屏容器(空态会拦截点击),各浮层自带定位。
export function Overlays() {
  return (
    <>
      {toast() ? renderToastNode(toast()!) : null}
      {undoBar() ? renderUndoNode(undoBar()!) : null}
      {renderInstallModal()}
      {renderConfirmModal()}
      {renderUpdateModal()}
      {renderAdoptModal()}
      {renderTagManagerModal()}
      {renderScenarioCreateModal()}
      {renderMarketModal()}
      {renderTagEditorModal()}
      {renderDriftModal()}
    </>
  );
}
