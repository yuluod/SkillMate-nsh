// `nsh test` 无头运行:mock 掉 skillmate/native 的 Rust 模块层,
// 断言壳层导航与技能库列表的渲染。
import { expect, open, test } from "nsh/test";

const skillFixture = {
  id: "skill-1",
  name: "writer",
  path: "/tmp/claude/skills/writer",
  skill_type: "skill-folder",
  source: "https://github.com/example/writer",
  source_type: "deployment",
  content_source: "github",
  manager: "skillmate",
  update_strategy: "skillmate",
  size: "1 KB",
  modified: "2026-01-01",
  tags: [],
  description: "帮助写作",
  readme: "",
  version: "",
  content_hash: "hash-1",
  upstream_url: "https://github.com/example/writer",
  has_update: false,
  origin_kind: "git",
  origin_locator: "",
  resolved_locator: "",
  tracking_ref: "",
  installed_ref: "",
  latest_ref: "",
  sync_state: "current",
  sync_message: "",
  lag_count: 0,
  managed_by_app: true,
  can_check: true,
  can_sync: true,
  symlink_source: "/tmp/library/skills/writer",
  structure_status: "complete",
  structure_features: [],
  structure_warnings: [],
  manifest_title: null,
  manifest_description: "帮助写作",
};

const dashboardFixture = {
  assistants: [
    {
      name: "Claude Code",
      path: "/tmp/claude",
      ai_type: "claude",
      icon: "",
      exists: true,
      supports_project_skills: true,
      skills: [skillFixture],
      diagnostics: [],
    },
  ],
  library_skills: [],
};

const libraryMock = {
  loadDashboard: () => dashboardFixture,
  getSkillReadme: () => "# writer\n\n帮助写作。",
  inspectSkillValidation: () => JSON.stringify({ checks: [] }),
  searchSkillBodies: () => JSON.stringify({ matches: [], truncated: false }),
  getLibrarySettings: () => "{}",
  getInstallPolicy: () => "{}",
  getAllTags: () => [{ id: "t1", name: "写作", color: "#2450c4" }],
  getScenarios: () => [],
  initialize: async () => true,
  previewInstallSkill: () => JSON.stringify({
    can_install: true, can_apply: true, message: "将添加 1 个 Skill",
    target_name: "writer", target_path: "/tmp/library/skills/writer", source_kind: "local",
    package_detection: { package_kind: "single_skill", detected_skills: [], warnings: [], needs_model: false },
    target_actions: [{ target: "/tmp/library/skills/writer", action: "copy" }],
    conflicts: [], structure_status: "complete", structure_features: [], structure_warnings: [],
    install_policy: { mode: "off", allowed: true, message: "" },
    plan_token: "tok-1", resolved_ref: "", available_skills: [], selection_required: false,
    suspicious_instructions: [],
  }),
  installSkill: () => JSON.stringify({ success: true, message: "已添加到 SkillMate 库", output: "" }),
  addTag: () => JSON.stringify({ id: "t2", name: "新标签", color: "#1c7f4f" }),
  openFolder: async () => undefined,
};

function moduleMock() {
  return {
    "Library.loadDashboard": libraryMock.loadDashboard,
    "Library.getSkillReadme": libraryMock.getSkillReadme,
    "Library.inspectSkillValidation": libraryMock.inspectSkillValidation,
    "Library.searchSkillBodies": libraryMock.searchSkillBodies,
    "Library.getLibrarySettings": libraryMock.getLibrarySettings,
    "Library.getInstallPolicy": libraryMock.getInstallPolicy,
    "Library.getAllTags": libraryMock.getAllTags,
    "Library.getScenarios": libraryMock.getScenarios,
    "Library.initialize": libraryMock.initialize,
    "Library.previewInstallSkill": libraryMock.previewInstallSkill,
    "Library.installSkill": libraryMock.installSkill,
    "Library.addTag": libraryMock.addTag,
    "Library.openFolder": libraryMock.openFolder,
    "Library.trashSkill": () => JSON.stringify({ token: "tr-1", path: "/tmp/x" }),
    "Library.purgeTrashedSkill": () => true,
    "Library.restoreTrashedSkill": () => "已恢复",
    "Library.unlinkSymlinkSkill": () => "已停用",
    "Library.checkUpdate": () => JSON.stringify({ syncState: "current", message: "已是最新", hasUpdate: false, canCheck: true, canSync: true, originKind: "git" }),
    "Library.previewSkillUpdate": () => JSON.stringify({ planToken: "tok-u", libraryPath: "/l/w", installedRef: "a", latestRef: "b", canApply: true, blockedReason: null, warnings: [], impacts: [], files: [], omittedFiles: 0 }),
    "Library.updateFromUpstream": () => "已更新",
  };
}

const DESKTOP = { width: 1000, height: 700, platform: "windows" } as const;

test("boots the shell and loads the dashboard", async () => {
  const app = await open("./App.tsx", {
    ...DESKTOP,
    modules: { "skillmate/native": moduleMock() },
  });
  await app.waitUntil(() => app.texts().some((text) => text.includes("SkillMate")));
  expect(app.texts().some((text) => /1|one/i.test(text) && text.trim().length <= 3)).toBe(true);
});

test("navigates to the skills list and renders mocked rows", async () => {
  const app = await open("./App.tsx", {
    ...DESKTOP,
    modules: { "skillmate/native": moduleMock() },
  });
  await app.waitUntil(() => app.texts().some((text) => text.includes("SkillMate")));
  const navLabel = app
    .texts()
    .find((text) => text === "技能库" || text === "Skills");
  expect(navLabel).toBeTruthy();
  await app.press(`text:${navLabel}`);
  await app.waitUntil(() => app.shows("text:writer"));
  expect(app.shows("text:writer")).toBe(true);
  expect(app.shows("text:帮助写作")).toBe(true);
});

test("install flow previews then applies with plan token", async () => {
  const app = await open("./App.tsx", {
    ...DESKTOP,
    modules: { "skillmate/native": moduleMock() },
  });
  await app.waitUntil(() => app.texts().some((text) => text.includes("SkillMate")));
  await app.press("text:技能库");
  await app.waitUntil(() => app.shows("id:skill-row-writer"));
  console.log("BEFORE-ROW-PRESS:", JSON.stringify(app.texts()));
  // 点击行展开详情栏
  await app.press("id:skill-row-writer");
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log("AFTER-ROW-PRESS:", JSON.stringify(app.texts()));
  await app.waitUntil(() => app.texts().some((text) => text === "启用"));
  await app.press("role:button[启用]");
  await app.waitUntil(() => app.shows("id:install-primary"));
  await app.press("id:install-primary");
  await app.waitUntil(() => app.shows("text:将添加 1 个 Skill"));
  await app.press("id:install-primary");
  await app.waitUntil(() => app.shows("text:已添加到 SkillMate 库"));
  expect(app.shows("text:已添加到 SkillMate 库")).toBe(true);
});

test("tag manager opens with the mocked tag", async () => {
  const app = await open("./App.tsx", {
    ...DESKTOP,
    modules: { "skillmate/native": moduleMock() },
  });
  await app.waitUntil(() => app.texts().some((text) => text.includes("SkillMate")));
  await app.press("text:技能库");
  await app.waitUntil(() => app.shows("id:header-tags"));
  await app.press("id:header-tags");
  await app.waitUntil(() => app.shows("text:标签管理"));
  expect(app.shows("text:写作")).toBe(true);
});
