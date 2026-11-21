// 写路径 API:JSON 字符串跨边界,这里解析为类型。
import { Library } from "skillmate/native";

export interface InstallPreviewSkill {
  name: string;
  target_name?: string;
  description?: string;
  suspicious_instructions?: unknown[];
  warnings?: string[];
}

export interface InstallPreview {
  can_install: boolean;
  can_apply: boolean;
  message: string;
  target_name: string;
  target_path: string;
  source_kind: string;
  package_detection: {
    package_kind: string;
    detected_skills: InstallPreviewSkill[];
    warnings: string[];
    needs_model: boolean;
  };
  target_actions: { target: string; action: string }[];
  conflicts: { target: string; reason: string }[];
  structure_status: string;
  structure_features: string[];
  structure_warnings: string[];
  install_policy: { mode: string; allowed: boolean; message: string };
  plan_token: string;
  resolved_ref: string;
  available_skills: { path: string; name: string }[];
  selection_required: boolean;
  suspicious_instructions: { kind: string; file: string; line: number; excerpt: string; fingerprint: string }[];
}

export interface InstallResult {
  success: boolean;
  message: string;
  output: string;
  structure_status?: string;
}

export interface TrashReceipt {
  token: string;
  path: string;
  name?: string;
  expiresAt?: number;
}

export interface UpdatePreview {
  planToken: string;
  libraryPath: string;
  installedRef: string;
  latestRef: string;
  canApply: boolean;
  blockedReason: string | null;
  warnings: string[];
  impacts: { path: string; assistant: string; scope: string; projectPath: string | null; connected: boolean; linkTarget: string | null }[];
  files: { path: string; kind: string; before: string | null; after: string | null; textOmitted: boolean }[];
  omittedFiles: number;
}

export interface SyncInfo {
  originKind: string;
  syncState: string;
  message: string;
  hasUpdate: boolean;
  canCheck: boolean;
  canSync: boolean;
  latestRef?: string;
  remoteUrl?: string;
}

async function parse<T>(promise: Promise<string>): Promise<T> {
  return JSON.parse(await promise) as T;
}

export const api = {
  initialize: () => Library.initialize(),
  previewInstallSkill: (request: {
    package: string;
    source: string;
    assistantName: string;
    installMode?: string;
    projectPath?: string;
    selectedSkillPaths?: string[];
    preferredSkillId?: string;
  }) => parse<InstallPreview>(Library.previewInstallSkill(
    request.package,
    request.source,
    request.assistantName,
    request.installMode ?? null,
    request.projectPath ?? null,
    request.selectedSkillPaths ?? null,
    request.preferredSkillId ?? null,
  )),
  installSkill: (request: {
    package: string;
    source: string;
    assistantName: string;
    installMode?: string;
    projectPath?: string;
    selectedSkillPaths?: string[];
    preferredSkillId?: string;
    planToken?: string;
  }) => parse<InstallResult>(Library.installSkill(
    request.package,
    request.source,
    request.assistantName,
    request.installMode ?? null,
    request.projectPath ?? null,
    request.selectedSkillPaths ?? null,
    request.preferredSkillId ?? null,
    request.planToken ?? null,
  )),
  unlinkSymlinkSkill: (path: string) => Library.unlinkSymlinkSkill(path),
  deleteSkill: (path: string) => Library.deleteSkill(path),
  trashSkill: (path: string) => parse<TrashReceipt>(Library.trashSkill(path)),
  restoreTrashedSkill: (token: string) => Library.restoreTrashedSkill(token),
  purgeTrashedSkill: (token: string) => Library.purgeTrashedSkill(token),
  checkUpdate: (path: string, force?: boolean) => parse<SyncInfo>(Library.checkUpdate(path, force ?? null)),
  previewSkillUpdate: (path: string) => parse<UpdatePreview>(Library.previewSkillUpdate(path)),
  updateFromUpstream: (path: string, planToken?: string) => Library.updateFromUpstream(path, planToken ?? null),
  reviewSuspiciousFinding: (finding: { kind: string; file: string; line: number; excerpt: string; fingerprint: string }) =>
    Library.reviewSuspiciousFinding(finding.kind, finding.file, finding.line, finding.excerpt, finding.fingerprint),

  // ---- 第三轮:组织 / 漂移 / 物化 / 项目 / 市场 / 导入导出 / 设置写 ----
  addTag: (name: string, color: string) => Library.addTag(name, color),
  updateTag: (tagId: string, name: string, color: string) => Library.updateTag(tagId, name, color),
  deleteTag: (tagId: string) => Library.deleteTag(tagId),
  updateSkillTags: (skillPath: string, tags: string[]) => Library.updateSkillTags(skillPath, tags),
  createScenario: (name: string, description: string, skillIds: string[]) =>
    Library.createScenario(name, description, skillIds),
  deleteScenario: (scenarioId: string) => Library.deleteScenario(scenarioId),
  previewSyncSkillCopies: (sourcePath: string, targetPaths: string[]) =>
    parse<Record<string, any>>(Library.previewSyncSkillCopies(sourcePath, targetPaths)),
  syncSkillCopies: (sourcePath: string, targetPaths: string[], planToken?: string) =>
    Library.syncSkillCopies(sourcePath, targetPaths, planToken ?? null),
  previewMaterializeSkill: (path: string, assistantName: string, projectPath: string) =>
    parse<InstallPreview>(Library.previewMaterializeSkill(path, assistantName, projectPath)),
  materializeSkill: (path: string, assistantName: string, projectPath: string, planToken?: string) =>
    parse<InstallResult>(Library.materializeSkill(path, assistantName, projectPath, planToken ?? null)),
  inspectProject: (projectPath: string) =>
    parse<Record<string, any>>(Library.inspectProject(projectPath)),
  previewProjectSkillTargets: (projectPath: string) =>
    parse<{ assistant: string; target_path: string; exists: boolean; recommended: boolean }[]>(
      Library.previewProjectSkillTargets(projectPath),
    ),
  searchMarket: (source: string, query: string) =>
    parse<{ source: string; total: number; items: Record<string, any>[] }>(
      Library.searchMarket(source, query),
    ),
  openExternalUrl: (url: string) => Library.openExternalUrl(url),
  openFolder: (path: string) => Library.openFolder(path),
  exportLibrary: (path: string) => Library.exportLibrary(path),
  previewImportLibrary: (path: string, mode?: string) =>
    parse<Record<string, any>>(Library.previewImportLibrary(path, mode ?? null)),
  importLibrary: (path: string, mode?: string, planToken?: string) =>
    Library.importLibrary(path, mode ?? null, planToken ?? null),
  exportScenarioManifest: (path: string) => Library.exportScenarioManifest(path),
  previewApplySkillmateManifest: (path: string) =>
    parse<Record<string, any>>(Library.previewApplySkillmateManifest(path)),
  applySkillmateManifest: (path: string, planToken?: string) =>
    Library.applySkillmateManifest(path, planToken ?? null),
  previewAdoptSkill: (path: string, assistantName: string, projectPath?: string | null) =>
    parse<InstallPreview>(Library.previewAdoptSkill(path, assistantName, projectPath ?? null)),
  adoptSkill: (path: string, assistantName: string, projectPath?: string | null, planToken?: string) =>
    parse<InstallResult>(Library.adoptSkill(path, assistantName, projectPath ?? null, planToken ?? null)),
  getSkillProfiles: () => parse<{ profiles?: Record<string, any>[] }>(Promise.resolve(Library.getSkillProfiles())),
  saveCurrentSkillProfile: (name: string, description: string) =>
    Library.saveCurrentSkillProfile(name, description),
  previewApplySkillProfile: (profileId: string) =>
    parse<Record<string, any>>(Library.previewApplySkillProfile(profileId)),
  applySkillProfile: (profileId: string, planToken?: string) =>
    Library.applySkillProfile(profileId, planToken ?? null),
  rollbackSkillProfile: () => Library.rollbackSkillProfile(),
  setLibraryRoot: (path: string) => Library.setLibraryRoot(path),
  setInstallPolicy: (configJson: string) => Promise.resolve(Library.setInstallPolicy(configJson)),
  getGitBackup: () => parse<Record<string, any>>(Library.getGitBackup()),
  setupGitBackup: (repoPath: string, remoteUrl: string, branch: string) =>
    Library.setupGitBackup(repoPath, remoteUrl, branch),
  syncToGit: (message: string) => Library.syncToGit(message),
  searchSkillBodiesRaw: (paths: string[], query: string) => Library.searchSkillBodies(paths, query),
  // ---- v0.1.2:模板创建 / 忽略标记 / 更新快照回滚 ----
  validateSkillDraft: (name: string, description: string) =>
    parse<{ ok: boolean; errors: string[] }>(Library.validateSkillDraft(name, description)),
  createLibrarySkill: (name: string, description: string, locale?: string) =>
    Library.createLibrarySkill(name, description, locale ?? null),
  setSkillIgnore: (skillPath: string, ignored: boolean) => Library.setSkillIgnore(skillPath, ignored),
  listIgnoredSkills: () => Library.listIgnoredSkills(),
  listSkillSnapshots: (path: string) =>
    parse<{ snapshot_dir: string; ref: string; content_hash: string; created_at: number }[]>(
      Library.listSkillSnapshots(path),
    ),
  previewSkillRollback: (path: string) => parse<UpdatePreview>(Library.previewSkillRollback(path)),
  applySkillRollback: (path: string, planToken?: string) =>
    Library.applySkillRollback(path, planToken ?? null),
  rawGetScenarios: () => Library.getScenarios(),
  previewSyncSkillCopiesTyped: (sourcePath: string, targetPaths: string[]) =>
    parse<{
      can_apply: boolean;
      message: string;
      plan_token: string;
      changed_files?: { path: string; kind: string }[];
    }>(Library.previewSyncSkillCopies(sourcePath, targetPaths)),
  getInstallPolicyRaw: () => Library.getInstallPolicy(),
  getLibrarySettingsRaw: () => Library.getLibrarySettings(),
  rawCheckUpdates: (paths: string[], force?: boolean) => Library.checkUpdates(paths, force ?? null),
};

export interface AdoptPreviewResult {
  preview: InstallPreview;
}
