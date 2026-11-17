// 库存视图模型构建器:自 SkillMate 前端 skillmate.mjs 直译的浏览子集。
// 合并规则保持一致:同一逻辑 Skill 的多平台部署与库主副本归一为一行,
// 身份 = symlink_source(库主副本路径)或实体路径。

type TFn = (key: string, values?: Record<string, unknown>) => string;

type AnySkill = Record<string, any>;

export const SUBSTANTIVE_RISK_CODES = new Set([
  "contains_scripts",
  "contains_symlinks",
  "unsafe_paths",
]);

export const ADVISORY_RISK_CODES = new Set([
  "declares_dependencies",
  "contains_hidden_files",
  "references_network",
  "references_environment",
  "safety_scan_incomplete",
  "suspicious_instructions",
]);

const STRUCTURE_STATUS_LABELS: Record<string, string> = {
  complete: "符合规范",
  partial: "需要修复",
  nonstandard: "非 Skill",
};

const STRUCTURE_WARNING_LABELS: Record<string, string> = {
  path_missing: "路径不存在",
  missing_entry_document: "缺少入口文档",
  missing_skill_md: "缺少 SKILL.md",
  missing_frontmatter: "缺少 YAML frontmatter",
  frontmatter_invalid: "YAML frontmatter 无效",
  missing_name: "缺少必填 name",
  missing_description: "缺少必填 description",
  invalid_skill_structure: "Skill 不符合 Agent Skills 规范",
  unrecognized_input: "规则无法识别",
  unsafe_paths: "存在异常路径",
  managed_content_changed: "内容已偏离安装时状态",
  contains_scripts: "包含可执行脚本",
  declares_dependencies: "包含第三方依赖清单",
  contains_symlinks: "包含软连接，复制时会跳过",
  contains_hidden_files: "包含隐藏文件",
  references_network: "可能访问网络",
  references_environment: "可能读取环境变量或凭据",
  safety_scan_incomplete: "安全扫描达到上限，结果可能不完整",
  suspicious_instructions: "存在可疑指令",
};

const CONTENT_SOURCE_LABELS: Record<string, string> = {
  github: "GitHub 仓库",
  git: "Git 仓库",
  local: "本地目录",
  external_cli: "外部 CLI 安装内容",
  unknown: "未知来源",
};

const MANAGER_LABELS: Record<string, string> = {
  skillmate: "SkillMate",
  external_cli: "外部安装器",
  skills_cli: "skills CLI",
  external: "外部或手工管理",
};

const UPDATE_STRATEGY_LABELS: Record<string, string> = {
  skillmate: "由 SkillMate 更新",
  external_cli: "通过原安装器更新",
  external: "由外部工具更新",
  manual: "手工维护",
};

const CHECKABLE_ORIGIN_KINDS = new Set(["git", "local", "npm", "legacy_npm", "pip", "legacy_pip"]);

function localized(t: TFn | undefined, key: string, fallback: string, values: Record<string, unknown> = {}): string {
  if (typeof t === "function") {
    const translated = t(key, values);
    if (translated && translated !== key) return translated;
  }
  return fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}

function localizedMap(t: TFn | undefined, prefix: string, value: string, fallbackMap: Record<string, string>, fallbackKey: string): string {
  const normalized = value && fallbackMap[value] ? value : fallbackKey;
  return localized(t, `${prefix}.${normalized}`, fallbackMap[normalized] || String(value || ""));
}

export function getStructureStatusLabel(status: string, t?: TFn): string {
  return localizedMap(t, "structure.status", status, STRUCTURE_STATUS_LABELS, "nonstandard");
}

export function getStructureStatusTone(status: string): "success" | "warn" | "error" {
  if (status === "complete") return "success";
  if (status === "partial") return "warn";
  return "error";
}

export function buildStructureWarningSummary(skill: AnySkill, t?: TFn): string {
  const warnings = Array.isArray(skill?.structure_warnings) ? skill.structure_warnings : [];
  if (warnings.length === 0) {
    return localized(t, "structure.noIssues", "结构未发现明显问题");
  }
  return warnings
    .map((warning: string) => localized(t, `structure.warning.${warning}`, STRUCTURE_WARNING_LABELS[warning] || warning))
    .join(localized(t, "common.listSeparator", "、"));
}

export function isSkillManaged(skill: AnySkill): boolean {
  return Boolean(
    skill?.managed_by_app
    || skill?.manager === "skillmate"
    || skill?.source_type === "deployment"
    || skill?.symlink_source,
  );
}

export function isStaleSkill(skill: AnySkill): boolean {
  return isSkillManaged(skill) && (skill?.sync_state === "source_missing" || skill?.sync_state === "failed");
}

export function buildSkillDescription(skill: AnySkill): string {
  const manifestDescription = skill?.manifest_description || "";
  if (manifestDescription) {
    return manifestDescription;
  }
  const readme = skill?.readme || "";
  return (
    readme
      .split("\n")
      .find((line: string) => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("!");
      })
      ?.slice(0, 80) || ""
  );
}

export interface Availability {
  name: string;
  icon: string;
}

export function buildUniqueSkillInventory(assistants: AnySkill[], t?: TFn): AnySkill[] {
  const byPath = new Map<string, AnySkill>();
  for (const assistant of Array.isArray(assistants) ? assistants : []) {
    for (const skill of Array.isArray(assistant?.skills) ? assistant.skills : []) {
      const path = typeof skill?.path === "string" ? skill.path : "";
      const identity = path || `${assistant?.name || "unknown"}:${skill?.id || skill?.name || "unknown"}`;
      const availability: Availability = {
        name: assistant?.name || localized(t, "common.unknownAssistant", "未知助手"),
        icon: assistant?.icon || "",
      };
      const existing = byPath.get(identity);
      if (existing) {
        if (!existing.availableIn.some((item: Availability) => item.name === availability.name)) {
          existing.availableIn.push(availability);
        }
        continue;
      }
      byPath.set(identity, {
        ...skill,
        ai: availability.name,
        aiIcon: availability.icon,
        availableIn: [availability],
      });
    }
  }
  return [...byPath.values()];
}

export interface Deployment {
  name: string;
  icon: string;
  path: string;
  scope: string;
  projectPath: string;
  managed: boolean;
  isSymlink: boolean;
}

export interface UnifiedSkill extends AnySkill {
  deployments: Deployment[];
  availableIn: Availability[];
  in_library: boolean;
}

export function buildUnifiedSkillInventory(skills: AnySkill[]): UnifiedSkill[] {
  const groups = new Map<string, { identity: string; rows: AnySkill[] }>();
  for (const skill of Array.isArray(skills) ? skills : []) {
    if (!skill) continue;
    const identity = skill.symlink_source || skill.path;
    if (!identity) continue;
    const group = groups.get(identity);
    if (group) group.rows.push(skill);
    else groups.set(identity, { identity, rows: [skill] });
  }
  const unified: UnifiedSkill[] = [];
  for (const { identity, rows } of groups.values()) {
    const base = rows.find((row) => row.path === identity)
      ?? rows.find((row) => row.scope !== "project")
      ?? rows[0];
    const deployments: Deployment[] = rows
      .filter((row) => row.path !== identity)
      .map((row) => ({
        name: row.ai || "",
        icon: row.aiIcon || "",
        path: row.path,
        scope: row.scope || "global",
        projectPath: row.project_path || "",
        managed: Boolean(row.managed_by_app),
        isSymlink: ["symlink", "deployment"].includes(row.source_type),
      }));
    const availability: Availability[] = [];
    for (const deployment of deployments) {
      if (!availability.some((item) => item.name === deployment.name)) {
        availability.push({ name: deployment.name, icon: deployment.icon });
      }
    }
    const inLibrary = Boolean(base.in_library)
      || (identity !== base.path && Boolean(base.managed_by_app));
    unified.push({
      ...base,
      path: identity,
      in_library: inLibrary,
      deployments,
      availableIn: availability,
    });
  }
  return unified;
}

export function buildScenarioSkillInventory(skills: AnySkill[]): AnySkill[] {
  const byIdentity = new Map<string, AnySkill>();
  for (const skill of Array.isArray(skills) ? skills : []) {
    const identity = skill?.source_type === "deployment" && skill?.symlink_source
      ? skill.symlink_source
      : skill?.path;
    if (!identity) continue;
    const existing = byIdentity.get(identity);
    const availability: Availability[] = Array.isArray(skill?.availableIn) ? skill.availableIn : [];
    if (existing) {
      for (const platform of availability) {
        if (!existing.availableIn.some((item: Availability) => item.name === platform.name)) {
          existing.availableIn.push(platform);
        }
      }
      continue;
    }
    byIdentity.set(identity, {
      ...skill,
      path: identity,
      availableIn: [...availability],
    });
  }
  return [...byIdentity.values()];
}

export interface SkillCardView {
  title: string;
  description: string;
  structureLabel: string;
  structureTone: "success" | "warn" | "error";
  warningSummary: string;
  securityWarningCount: number;
  advisoryWarningCount: number;
  sourceLabel: string;
  managerLabel: string;
  updateStrategyLabel: string;
  provenanceNotes: string[];
  canCheck: boolean;
  canSync: boolean;
  hasUpdate: boolean;
  updateSummary: string;
  needsAttention: boolean;
  availableIn: Availability[];
  availabilityLabel: string;
  isShared: boolean;
}

export function buildSkillCardView(skill: AnySkill, t?: TFn): SkillCardView {
  const structure = {
    status: skill?.structure_status || "nonstandard",
    warnings: Array.isArray(skill?.structure_warnings) ? skill.structure_warnings : [],
  };
  const isSymlink = ["symlink", "deployment"].includes(skill?.source_type);
  const isManaged = Boolean(skill?.managed_by_app);
  const substantiveWarnings = structure.warnings.filter((warning: string) => SUBSTANTIVE_RISK_CODES.has(warning));
  const advisoryWarnings = structure.warnings.filter((warning: string) => ADVISORY_RISK_CODES.has(warning));
  const originKind = skill?.origin_kind || skill?.source_type || "unknown";
  const inferredSource = skill?.content_source || (["git", "github"].includes(originKind) ? (skill?.upstream_url?.includes("github.com") ? "github" : "git") : "unknown");
  const inferredManager = skill?.manager || (isManaged ? "skillmate" : "external");
  const inferredUpdate = skill?.update_strategy || (isManaged && originKind === "git" ? "skillmate" : "manual");
  const canCheck = typeof skill?.can_check === "boolean"
    ? skill.can_check
    : CHECKABLE_ORIGIN_KINDS.has(originKind);
  const canSync = Boolean(skill?.can_sync);
  const syncState = skill?.sync_state ?? "unknown";
  const updateSummary = (() => {
    if (inferredManager === "skills_cli") return localized(t, "preview.updateSkillsCli", "由 skills CLI 管理，请运行 npx skills update 更新");
    if (syncState === "current") return localized(t, "preview.updateCurrent", "已是最新，可随时重新检查");
    if (syncState === "behind") {
      if (canSync) return localized(t, "preview.updateReady", "发现更新，可由 SkillMate 安装");
      if (inferredUpdate === "external_cli") return localized(t, "preview.updateExternalReady", "发现更新，请通过原安装器更新");
      return localized(t, "preview.updateManualReady", "发现来源变化，需要手工处理");
    }
    if (syncState === "source_missing") return localized(t, "preview.localMissing", "原始本地目录已不存在");
    if (syncState === "failed") return localized(t, "preview.checkFailed", "上次检查失败，可以重新检查");
    return canCheck
      ? localized(t, "preview.notChecked", "尚未检查来源")
      : localized(t, "preview.notCheckable", "当前来源无法检查更新");
  })();
  const availableIn = Array.isArray(skill?.availableIn) && skill.availableIn.length > 0
    ? skill.availableIn
    : (skill?.ai ? [{ name: skill.ai, icon: skill.aiIcon || "" }] : []);
  const provenanceNotes: string[] = [];
  if (["github", "git", "external_cli"].includes(inferredSource)) {
    provenanceNotes.push(localized(t, `provenance.source.${inferredSource}`, CONTENT_SOURCE_LABELS[inferredSource] || skill?.source || "未知来源"));
  }
  if (inferredManager !== "external") {
    provenanceNotes.push(localized(t, `provenance.manager.${inferredManager}`, MANAGER_LABELS[inferredManager] || "外部或手工管理"));
  }
  if (inferredUpdate !== "manual") {
    provenanceNotes.push(localized(t, `provenance.update.${inferredUpdate}`, UPDATE_STRATEGY_LABELS[inferredUpdate] || "手工维护"));
  }
  return {
    title: skill?.manifest_title || skill?.name || "",
    description: buildSkillDescription(skill),
    structureLabel: getStructureStatusLabel(structure.status, t),
    structureTone: getStructureStatusTone(structure.status),
    warningSummary: buildStructureWarningSummary(skill, t),
    securityWarningCount: substantiveWarnings.length,
    advisoryWarningCount: advisoryWarnings.length,
    sourceLabel: skill?.source || localized(t, "source.unmanaged", "未托管"),
    managerLabel: localized(t, `provenance.manager.${inferredManager}`, MANAGER_LABELS[inferredManager] || "外部或手工管理"),
    updateStrategyLabel: localized(t, `provenance.update.${inferredUpdate}`, UPDATE_STRATEGY_LABELS[inferredUpdate] || "手工维护"),
    provenanceNotes,
    canCheck,
    canSync,
    hasUpdate: Boolean(skill?.has_update),
    updateSummary,
    needsAttention: substantiveWarnings.length > 0
      || structure.warnings.includes("managed_content_changed")
      || isStaleSkill(skill)
      || structure.status === "nonstandard",
    availableIn,
    availabilityLabel: availableIn.map((assistant: Availability) => assistant.name).join(localized(t, "common.listSeparator", "、")),
    isShared: availableIn.length > 1,
  };
}

export function skillMatchesQuery(skill: AnySkill, query: string, bodyHitPaths?: Set<string>): boolean {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  const fields = [skill.name, skill.manifest_title, skill.manifest_description, skill.description];
  if (fields.some((field) => String(field || "").toLowerCase().includes(needle))) return true;
  return Boolean(bodyHitPaths?.has?.(skill.path));
}

export interface DashboardStats {
  skills: number;
  assistants: number;
  updates: number;
  structureIssues: number;
  securityRisks: number;
  localChanges: number;
  external: number;
  stale: number;
  diagnostics: number;
  needsAttention: number;
}

export function buildDashboardStats(assistants: AnySkill[], librarySkills: AnySkill[] = [], t?: TFn): DashboardStats {
  const skills = buildScenarioSkillInventory([
    ...buildUniqueSkillInventory(assistants, t),
    ...(Array.isArray(librarySkills) ? librarySkills : []),
  ]);
  let updates = 0;
  let structureIssues = 0;
  let securityRisks = 0;
  let localChanges = 0;
  let external = 0;
  let stale = 0;
  let needsAttention = 0;
  for (const skill of skills) {
    const card = buildSkillCardView(skill, t);
    if (skill?.sync_state === "behind" || skill?.has_update) updates += 1;
    if (skill?.structure_status === "nonstandard") structureIssues += 1;
    if (card.securityWarningCount > 0) securityRisks += 1;
    if (skill?.structure_warnings?.includes?.("managed_content_changed")) localChanges += 1;
    if (!isSkillManaged(skill)) external += 1;
    if (isStaleSkill(skill)) stale += 1;
    if (card.needsAttention) needsAttention += 1;
  }
  return {
    skills: skills.length,
    assistants: (Array.isArray(assistants) ? assistants : []).filter((assistant) => assistant?.exists).length,
    updates,
    structureIssues,
    securityRisks,
    localChanges,
    external,
    stale,
    diagnostics: (Array.isArray(assistants) ? assistants : [])
      .reduce((count, assistant) => count + (Array.isArray(assistant?.diagnostics) ? assistant.diagnostics.length : 0), 0),
    needsAttention,
  };
}
