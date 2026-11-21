//! The app's Rust code: what `App.tsx` imports from `skillmate/native`. Their
//! TypeScript declarations are generated from these types into
//! `.nsh/types/skillmate/native.d.ts`.
//!
//! 本层是 NSH 版的「命令壳层」：浏览优先的第一轮只暴露读路径
//! (扫描、库清单、详情、校验、正文搜索、设置与组织数据)，
//! 与 Tauri 版 lib.rs 中的同名命令一一对应，业务全部委托
//! `skillmate-core`。

use nsh_core::prelude::*;
use skillmate_core as sm;

/// The crate's UI set (`nsh.json` `"rust"`).
#[native_module("skillmate/native")]
fn native(registry: &mut Registry) {
    registry.module::<Library>();
}

#[derive(JsObject)]
pub struct SkillDto {
    pub id: String,
    pub name: String,
    pub path: String,
    pub skill_type: String,
    pub source: String,
    pub source_type: String,
    pub content_source: String,
    pub manager: String,
    pub update_strategy: String,
    pub size: String,
    pub modified: String,
    pub tags: Vec<String>,
    pub description: String,
    pub version: String,
    pub content_hash: String,
    pub upstream_url: String,
    pub has_update: bool,
    pub origin_kind: String,
    pub origin_locator: String,
    pub resolved_locator: String,
    pub tracking_ref: String,
    pub installed_ref: String,
    pub latest_ref: String,
    pub sync_state: String,
    pub sync_message: String,
    pub lag_count: u32,
    pub managed_by_app: bool,
    pub can_check: bool,
    pub can_sync: bool,
    pub symlink_source: Option<String>,
    pub structure_status: String,
    pub structure_features: Vec<String>,
    pub structure_warnings: Vec<String>,
    pub manifest_title: Option<String>,
    pub manifest_description: Option<String>,
}

impl From<&sm::Skill> for SkillDto {
    fn from(skill: &sm::Skill) -> Self {
        SkillDto {
            id: skill.inventory.id.clone(),
            name: skill.inventory.name.clone(),
            path: skill.inventory.path.clone(),
            skill_type: skill.inventory.skill_type.clone(),
            source: skill.inventory.source.clone(),
            source_type: skill.inventory.source_type.clone(),
            content_source: skill.inventory.content_source.clone(),
            manager: skill.inventory.manager.clone(),
            update_strategy: skill.inventory.update_strategy.clone(),
            size: skill.inventory.size.clone(),
            modified: skill.inventory.modified.clone(),
            tags: skill.inventory.tags.clone(),
            description: skill.inventory.description.clone(),
            version: skill.inventory.version.clone(),
            content_hash: skill.inventory.content_hash.clone(),
            upstream_url: skill.origin.upstream_url.clone(),
            has_update: skill.origin.has_update,
            origin_kind: skill.origin.origin_kind.clone(),
            origin_locator: skill.origin.origin_locator.clone(),
            resolved_locator: skill.origin.resolved_locator.clone(),
            tracking_ref: skill.origin.tracking_ref.clone(),
            installed_ref: skill.origin.installed_ref.clone(),
            latest_ref: skill.origin.latest_ref.clone(),
            sync_state: skill.origin.sync_state.clone(),
            sync_message: skill.origin.sync_message.clone(),
            lag_count: skill.origin.lag_count,
            managed_by_app: skill.origin.managed_by_app,
            can_check: skill.origin.can_check,
            can_sync: skill.origin.can_sync,
            symlink_source: skill.origin.symlink_source.clone(),
            structure_status: skill.structure.structure_status.clone(),
            structure_features: skill.structure.structure_features.clone(),
            structure_warnings: skill.structure.structure_warnings.clone(),
            manifest_title: skill.structure.manifest_title.clone(),
            manifest_description: skill.structure.manifest_description.clone(),
        }
    }
}

#[derive(JsObject)]
pub struct DiagnosticDto {
    pub path: String,
    pub code: String,
    pub message: String,
}

#[derive(JsObject)]
pub struct AssistantDto {
    pub name: String,
    pub path: String,
    pub ai_type: String,
    pub icon: String,
    pub exists: bool,
    pub supports_project_skills: bool,
    pub skills: Vec<SkillDto>,
    pub diagnostics: Vec<DiagnosticDto>,
}

impl From<&sm::AIAssistant> for AssistantDto {
    fn from(assistant: &sm::AIAssistant) -> Self {
        AssistantDto {
            name: assistant.name.clone(),
            path: assistant.path.clone(),
            ai_type: assistant.ai_type.clone(),
            icon: assistant.icon.clone(),
            exists: assistant.exists,
            supports_project_skills: assistant.supports_project_skills,
            skills: assistant.skills.iter().map(SkillDto::from).collect(),
            diagnostics: assistant
                .diagnostics
                .iter()
                .map(|item| DiagnosticDto {
                    path: item.path.clone(),
                    code: item.code.clone(),
                    message: item.message.clone(),
                })
                .collect(),
        }
    }
}

#[derive(JsObject)]
pub struct DashboardDto {
    pub assistants: Vec<AssistantDto>,
    pub library_skills: Vec<SkillDto>,
}

#[derive(JsObject)]
pub struct TagDto {
    pub id: String,
    pub name: String,
    pub color: String,
}

impl From<&sm::organization_commands::Tag> for TagDto {
    fn from(tag: &sm::organization_commands::Tag) -> Self {
        TagDto {
            id: tag.id.clone(),
            name: tag.name.clone(),
            color: tag.color.clone(),
        }
    }
}

#[derive(JsObject)]
pub struct ScenarioDto {
    pub id: String,
    pub name: String,
    pub description: String,
    pub skill_ids: Vec<String>,
    pub created_at: String,
}

impl From<&sm::organization_commands::Scenario> for ScenarioDto {
    fn from(scenario: &sm::organization_commands::Scenario) -> Self {
        ScenarioDto {
            id: scenario.id.clone(),
            name: scenario.name.clone(),
            description: scenario.description.clone(),
            skill_ids: scenario.skill_ids.clone(),
            created_at: scenario.created_at.clone(),
        }
    }
}

fn json_string<T: serde::Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

/// SkillMate 浏览数据:扫描助手目录与统一库。
#[module]
pub struct Library;

// 方法名沿用 Tauri 版命令的 camelCase,作为 TSX 侧的稳定 API 面。
#[allow(non_snake_case)]
#[module]
impl Library {
    /// 扫描全部助手目录与统一库,返回概览所需清单(含诊断信息)。
    pub async fn loadDashboard() -> Result<DashboardDto, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let assistants = sm::skill_inventory::scan_all_assistants(db)?;
            let library_skills = sm::skill_library::scan_unassigned_library_skills(db)?;
            Ok(DashboardDto {
                assistants: assistants.iter().map(AssistantDto::from).collect(),
                library_skills: library_skills.iter().map(SkillDto::from).collect(),
            })
        })
    }

    /// 读取指定 Skill 的入口文档预览(仅已发现或受管路径)。
    pub async fn getSkillReadme(path: String) -> Result<String, String> {
        let target = sm::app_core::expand_path(path.trim());
        sm::operation_coordinator::run_readonly_operation(|db| {
            if !sm::operation_coordinator::is_known_skill_path(db, &target)? {
                return Err("只允许预览已发现或受管的 Skill".to_string());
            }
            Ok(sm::skill_structure::read_skill_preview(&target))
        })
    }

    /// 结构校验报告(JSON,仅已发现或受管路径)。
    pub async fn inspectSkillValidation(path: String) -> Result<String, String> {
        let target = sm::app_core::expand_path(path.trim());
        sm::operation_coordinator::run_readonly_operation(|db| {
            if !sm::operation_coordinator::is_known_skill_path(db, &target)? {
                return Err("只允许检查已发现或受管的 Skill".to_string());
            }
            json_string(&sm::skill_structure::validate_skill_structure(&target))
        })
    }

    /// 已知路径正文搜索;超过上限时置 truncated(JSON)。
    pub async fn searchSkillBodies(paths: Vec<String>, query: String) -> Result<String, String> {
        const MAX_BODY_SEARCH_PATHS: usize = 2000;
        let truncated = paths.len() > MAX_BODY_SEARCH_PATHS;
        let mut matches = Vec::new();
        for path in paths.into_iter().take(MAX_BODY_SEARCH_PATHS) {
            let target = sm::app_core::expand_path(path.trim());
            let found = sm::operation_coordinator::run_readonly_operation(|db| {
                if !sm::operation_coordinator::is_known_skill_path(db, &target)? {
                    return Ok(None);
                }
                Ok(sm::skill_structure::search_skill_body(&target, &query))
            })?;
            if let Some(found) = found {
                matches.push(serde_json::json!({
                    "path": path.trim(),
                    "file": found.file,
                    "line": found.line,
                    "matches": found.matches,
                    "snippet": found.snippet,
                }));
            }
        }
        Ok(serde_json::json!({ "matches": matches, "truncated": truncated }).to_string())
    }

    /// 统一库设置(JSON)。
    pub async fn getLibrarySettings() -> Result<String, String> {
        json_string(&sm::library_config::get_library_settings()?)
    }

    /// 安装策略(JSON)。
    pub async fn getInstallPolicy() -> Result<String, String> {
        sm::operation_coordinator::run_readonly_operation(|db| {
            json_string(&sm::install_policy::load_install_policy(db)?)
        })
    }

    /// 全部标签。
    pub async fn getAllTags() -> Result<Vec<TagDto>, String> {
        sm::operation_coordinator::run_readonly_operation(|db| {
            Ok(sm::organization_commands::get_all_tags_from_db(db)?
                .iter()
                .map(TagDto::from)
                .collect())
        })
    }

    /// 全部场景。
    pub async fn getScenarios() -> Result<Vec<ScenarioDto>, String> {
        sm::operation_coordinator::run_readonly_operation(|db| {
            Ok(sm::organization_commands::get_scenarios_from_db(db)?
                .iter()
                .map(ScenarioDto::from)
                .collect())
        })
    }

    /// 启动维护:数据库迁移/事务恢复 + 撤销暂存区恢复。
    pub async fn initialize() -> Result<bool, String> {
        let _ = sm::initialize_database_state();
        let _ = trash_slot();
        Ok(true)
    }

    /// 安装预览(添加/启用共用;JSON InstallPreview)。
    pub async fn previewInstallSkill(
        package: String,
        source: String,
        assistant_name: String,
        install_mode: Option<String>,
        project_path: Option<String>,
        selected_skill_paths: Option<Vec<String>>,
        preferred_skill_id: Option<String>,
    ) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let mode = install_mode.unwrap_or_else(|| "copy".to_string());
            let policy = sm::install_policy::load_install_policy(db);
            let preview = sm::build_install_request_preview(
                db,
                sm::InstallPreviewRequest {
                    package: &package,
                    source: &source,
                    assistant_name: &assistant_name,
                    mode: &mode,
                    project_path: project_path.as_deref(),
                    selected_skill_paths: selected_skill_paths.as_deref(),
                    preferred_skill_id: preferred_skill_id.as_deref(),
                },
                policy.as_ref().map_err(Clone::clone),
            );
            json_string(&preview)
        })
    }

    /// 执行安装/启用(plan_token 两段式;JSON InstallResult)。
    pub async fn installSkill(
        package: String,
        source: String,
        assistant_name: String,
        install_mode: Option<String>,
        project_path: Option<String>,
        selected_skill_paths: Option<Vec<String>>,
        preferred_skill_id: Option<String>,
        plan_token: Option<String>,
    ) -> Result<String, String> {
        let result = sm::install_skill_blocking(sm::InstallSkillRequest {
            package,
            source,
            assistant_name,
            install_mode,
            project_path,
            selected_skill_paths,
            preferred_skill_id,
            plan_token,
        });
        json_string(&result)
    }

    /// 接管预览(JSON InstallPreview)。
    pub async fn previewAdoptSkill(
        path: String,
        assistant_name: String,
        project_path: Option<String>,
    ) -> Result<String, String> {
        match sm::operation_coordinator::run_exclusive_operation(|db| {
            Ok(sm::skill_adoption::preview_adopt_skill(
                db,
                &path,
                &assistant_name,
                project_path.as_deref(),
            ))
        }) {
            Ok(preview) => json_string(&preview),
            Err(error) => json_string(&sm::skill_install::seal_install_preview(
                sm::skill_adoption::preview_adopt_skill_fallback(&path, error),
                &path,
                &assistant_name,
                "adopt",
                project_path.as_deref(),
            )),
        }
    }

    /// 执行接管(JSON InstallResult)。
    pub async fn adoptSkill(
        path: String,
        assistant_name: String,
        project_path: Option<String>,
        plan_token: Option<String>,
    ) -> Result<String, String> {
        let result = match sm::operation_coordinator::run_exclusive_operation(|db| {
            Ok(sm::skill_adoption::adopt_skill(
                db,
                path,
                assistant_name,
                project_path,
                plan_token,
            ))
        }) {
            Ok(result) => result,
            Err(error) => {
                sm::install_result(false, "接管任务异常终止", error, None)
            }
        };
        json_string(&result)
    }

    /// 停用(解除受管启用连接)。
    pub async fn unlinkSymlinkSkill(path: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let p = std::path::PathBuf::from(&path);
            if !p.exists() && std::fs::symlink_metadata(&p).is_err() {
                return Err("路径不存在".to_string());
            }
            let metadata = std::fs::symlink_metadata(&p).map_err(|e| e.to_string())?;
            if !sm::app_core::metadata_is_directory_link(&metadata) {
                return Err("当前启用位置不是可解除的连接".to_string());
            }
            let registry_managed = sm::managed_installation::find_managed_installation(db, &p)?
                .filter(|installation| installation.skill.install_mode.as_deref() == Some("symlink"));
            if !sm::app_core::is_managed_link_entry_path(&p, &sm::app_core::managed_skill_roots())
                && registry_managed.is_none()
            {
                return Err("不允许解除非受管路径".to_string());
            }
            if !sm::managed_installation::is_explicitly_managed(db, &p)? {
                return Err("只允许停用 SkillMate 创建的启用位置".to_string());
            }
            sm::managed_installation::verify_managed_content_unchanged(db, &p)?;
            let mut transaction =
                sm::ReconcileTransaction::prepare_managed(db, std::slice::from_ref(&p), &[])?;
            if let Err(error) = sm::managed_installation::cleanup_skill_metadata(db, &p) {
                return match transaction.rollback() {
                    Ok(()) => Err(error),
                    Err(rollback_error) => {
                        Err(format!("{}；恢复软连接失败: {}", error, rollback_error))
                    }
                };
            }
            match transaction.commit() {
                Ok(None) => Ok("已停用".to_string()),
                Ok(Some(warning)) => Ok(format!("已停用；{}", warning)),
                Err(error) => Err(error),
            }
        })
    }

    /// 删除受管 Skill。
    pub async fn deleteSkill(path: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let p = std::path::PathBuf::from(&path);
            if !p.exists() {
                return Err("路径不存在".to_string());
            }
            let registry_managed = sm::managed_installation::find_managed_installation(db, &p)?;
            if !sm::app_core::is_managed_skill_path(&p, &sm::app_core::managed_skill_roots())
                && registry_managed.is_none()
            {
                return Err("不允许删除".to_string());
            }
            if !sm::managed_installation::is_explicitly_managed(db, &p)? {
                return Err("只允许删除 SkillMate 管理的 Skill".to_string());
            }
            sm::managed_installation::verify_managed_content_unchanged(db, &p)?;
            let mut transaction =
                sm::ReconcileTransaction::prepare_managed(db, std::slice::from_ref(&p), &[])?;
            if let Err(error) = sm::managed_installation::cleanup_skill_metadata(db, &p) {
                return match transaction.rollback() {
                    Ok(()) => Err(error),
                    Err(rollback_error) => Err(format!(
                        "{}；恢复 Skill 文件失败: {}",
                        error, rollback_error
                    )),
                };
            }
            match transaction.commit() {
                Ok(None) => Ok("已删除".to_string()),
                Ok(Some(warning)) => Ok(format!("已删除；{}", warning)),
                Err(error) => Err(error),
            }
        })
    }

    /// 可撤销删除(JSON TrashReceipt)。
    pub async fn trashSkill(path: String) -> Result<String, String> {
        let mut trash = trash_slot()
            .lock()
            .map_err(|_| "撤销暂存区已锁定，请重启应用后重试".to_string())?;
        let receipt = sm::operation_coordinator::run_exclusive_operation(|db| {
            trash.trash(db, &sm::app_core::expand_path(path.trim()))
        })?;
        json_string(&receipt)
    }

    /// 撤销暂存清单(JSON Vec<TrashReceipt>)。
    pub async fn listTrashedSkills() -> Result<String, String> {
        let list = trash_slot()
            .lock()
            .map_err(|_| "撤销暂存区已锁定，请重启应用后重试".to_string())?
            .list();
        json_string(&list)
    }

    /// 撤销删除。
    pub async fn restoreTrashedSkill(token: String) -> Result<String, String> {
        let mut trash = trash_slot()
            .lock()
            .map_err(|_| "撤销暂存区已锁定，请重启应用后重试".to_string())?;
        sm::operation_coordinator::run_exclusive_operation(|db| trash.restore(db, token.trim()))
    }

    /// 清除撤销条目。
    pub async fn purgeTrashedSkill(token: String) -> Result<bool, String> {
        trash_slot()
            .lock()
            .map_err(|_| "撤销暂存区已锁定，请重启应用后重试".to_string())?
            .purge(token.trim())
    }

    /// 单个来源检查(JSON 同步信息,camelCase)。
    pub async fn checkUpdate(path: String, force: Option<bool>) -> Result<String, String> {
        let target = sm::app_core::expand_path(path.trim());
        match sm::operation_coordinator::check_skill_update(&target, force.unwrap_or(false)) {
            Ok(info) => json_string(&sm::skill_origin::sync_info_json(&info)),
            Err(err) => json_string(&sm::failed_sync_info(&format!("检查失败: {}", err))),
        }
    }

    /// 批量来源检查(JSON 数组)。
    pub async fn checkUpdates(paths: Vec<String>, force: Option<bool>) -> Result<String, String> {
        let targets = paths
            .iter()
            .map(|path| sm::app_core::expand_path(path.trim()))
            .collect::<Vec<_>>();
        let results = sm::operation_coordinator::check_skill_updates(&targets, force.unwrap_or(false))?
            .into_iter()
            .map(|(path, result)| {
                let mut value = match result {
                    Ok(info) => sm::skill_origin::sync_info_json(&info),
                    Err(error) => sm::failed_sync_info(&format!("检查失败: {}", error)),
                };
                if let Some(object) = value.as_object_mut() {
                    object.insert(
                        "path".to_string(),
                        serde_json::Value::String(path),
                    );
                }
                value
            })
            .collect::<Vec<_>>();
        json_string(&results)
    }

    /// 更新预览(JSON UpdatePreview)。
    pub async fn previewSkillUpdate(path: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            json_string(&sm::update_preview::preview_update(
                db,
                &sm::app_core::expand_path(path.trim()),
            )?)
        })
    }

    /// 执行更新(plan_token 两段式)。
    pub async fn updateFromUpstream(path: String, plan_token: Option<String>) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let p = sm::app_core::expand_path(path.trim());
            let library_path = sm::skill_library::resolve_library_path(db, &p)?;
            if !sm::operation_coordinator::is_known_skill_path(db, &p)?
                && !sm::operation_coordinator::is_known_skill_path(db, &library_path)?
            {
                return Err("只允许更新已发现或受管的 Skill".to_string());
            }
            if !sm::managed_installation::is_explicitly_managed(db, &library_path)? {
                return Err("只允许更新 SkillMate 管理的 Git 快照".to_string());
            }
            sm::update_preview::apply_update(db, &p, plan_token.as_deref())
        })
    }

    /// 标记可疑指令已审阅。
    pub async fn reviewSuspiciousFinding(
        kind: String,
        file: String,
        line: usize,
        excerpt: String,
        fingerprint: String,
    ) -> Result<(), String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            sm::finding_review::mark_finding_reviewed(
                db,
                &sm::skill_structure::SuspiciousFinding {
                    kind,
                    file,
                    line,
                    excerpt,
                    fingerprint,
                    reviewed: true,
                },
            )
        })
    }


    // ---- v0.1.2 新增:模板创建 / 忽略标记 / 更新快照回滚 ----
    /// 校验模板草稿(JSON SkillDraftValidation)。
    pub async fn validateSkillDraft(name: String, description: String) -> Result<String, String> {
        sm::operation_coordinator::run_readonly_operation(|db| {
            json_string(&sm::skill_template::validate_skill_draft(db, &name, &description))
        })
    }

    /// 从模板创建新 Skill 并入库(返回路径)。
    pub async fn createLibrarySkill(
        name: String,
        description: String,
        locale: Option<String>,
    ) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let path = sm::skill_template::create_library_skill(
                db,
                &name,
                &description,
                locale.as_deref().unwrap_or("zh-CN"),
            )?;
            Ok(path.to_string_lossy().to_string())
        })
    }

    /// 标记/取消忽略外部条目。
    pub async fn setSkillIgnore(skill_path: String, ignored: bool) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            sm::organization_commands::set_skill_ignore_in_db(
                db,
                std::path::Path::new(skill_path.trim()),
                ignored,
            )
        })
    }

    /// 已忽略路径清单。
    pub async fn listIgnoredSkills() -> Result<Vec<String>, String> {
        sm::operation_coordinator::run_readonly_operation(|db| {
            sm::organization_commands::list_ignored_skills_from_db(db)
        })
    }

    /// 更新快照清单(JSON Vec<SkillSnapshot>)。
    pub async fn listSkillSnapshots(path: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let library_path =
                sm::skill_library::resolve_library_path(db, &sm::app_core::expand_path(path.trim()))?;
            json_string(&sm::skill_snapshot::list_snapshots(db, &library_path)?)
        })
    }

    /// 回滚预览(JSON UpdatePreview,camelCase)。
    pub async fn previewSkillRollback(path: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            json_string(&sm::update_preview::preview_skill_rollback(
                db,
                &sm::app_core::expand_path(path.trim()),
            )?)
        })
    }

    /// 执行回滚(plan_token 两段式)。
    pub async fn applySkillRollback(path: String, plan_token: Option<String>) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let p = sm::app_core::expand_path(path.trim());
            let library_path = sm::skill_library::resolve_library_path(db, &p)?;
            if !sm::operation_coordinator::is_known_skill_path(db, &p)?
                && !sm::operation_coordinator::is_known_skill_path(db, &library_path)?
            {
                return Err("只允许回滚已发现或受管的 Skill".to_string());
            }
            sm::update_preview::apply_skill_rollback(db, &p, plan_token.as_deref())
        })
    }

    // ---- 组织:标签/场景 ----
    // ---- 组织:标签/场景 ----
    /// 新增标签。
    pub async fn addTag(name: String, color: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            json_string(&sm::organization_commands::add_tag_in_db(db, &name, &color)?)
        })
    }

    /// 更新标签名称与颜色。
    pub async fn updateTag(tag_id: String, name: String, color: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            json_string(&sm::organization_commands::update_tag_in_db(db, &tag_id, &name, &color)?)
        })
    }

    /// 删除标签(级联清理映射)。
    pub async fn deleteTag(tag_id: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            sm::organization_commands::delete_tag_in_db(db, &tag_id)
        })
    }

    /// 覆盖写入某 Skill 的标签集合。
    pub async fn updateSkillTags(skill_path: String, tags: Vec<String>) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            sm::organization_commands::update_skill_tags_in_db(
                db,
                std::path::Path::new(skill_path.trim()),
                &tags,
            )
        })
    }

    /// 新建场景。
    pub async fn createScenario(
        name: String,
        description: String,
        skill_ids: Vec<String>,
    ) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            json_string(&sm::organization_commands::create_scenario_in_db(
                db, &name, &description, &skill_ids,
            )?)
        })
    }

    /// 删除场景。
    pub async fn deleteScenario(scenario_id: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            sm::organization_commands::delete_scenario_in_db(db, &scenario_id)
        })
    }

    // ---- 漂移同步 / 物化 ----
    /// 多副本漂移同步预览(JSON)。
    pub async fn previewSyncSkillCopies(
        source_path: String,
        target_paths: Vec<String>,
    ) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let targets = target_paths
                .iter()
                .map(|path| sm::app_core::expand_path(path.trim()))
                .collect::<Vec<_>>();
            json_string(&sm::skill_drift::preview_sync_skill_copies(
                db,
                &sm::app_core::expand_path(source_path.trim()),
                &targets,
            )?)
        })
    }

    /// 执行漂移同步(plan_token 两段式)。
    pub async fn syncSkillCopies(
        source_path: String,
        target_paths: Vec<String>,
        plan_token: Option<String>,
    ) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let targets = target_paths
                .iter()
                .map(|path| sm::app_core::expand_path(path.trim()))
                .collect::<Vec<_>>();
            sm::skill_drift::apply_sync_skill_copies(
                db,
                &sm::app_core::expand_path(source_path.trim()),
                &targets,
                plan_token.as_deref(),
            )
        })
    }

    /// 项目软链转独立副本预览(JSON InstallPreview)。
    pub async fn previewMaterializeSkill(
        path: String,
        assistant_name: String,
        project_path: String,
    ) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            json_string(&sm::skill_materialization::preview_materialize_skill(
                db,
                &path,
                &assistant_name,
                &project_path,
            )?)
        })
    }

    /// 执行物化(JSON InstallResult)。
    pub async fn materializeSkill(
        path: String,
        assistant_name: String,
        project_path: String,
        plan_token: Option<String>,
    ) -> Result<String, String> {
        let result = match sm::operation_coordinator::run_exclusive_operation(|db| {
            Ok(sm::skill_materialization::materialize_skill(
                db,
                &path,
                &assistant_name,
                &project_path,
                plan_token.as_deref(),
            ))
        }) {
            Ok(result) => result,
            Err(error) => sm::install_result(false, "项目副本任务异常终止", error, None),
        };
        json_string(&result)
    }

    // ---- 项目核验 / 来源识别 ----
    /// 项目级 Skill 生效检查(JSON ProjectInspection)。
    pub async fn inspectProject(project_path: String) -> Result<String, String> {
        let project = sm::app_core::expand_path(project_path.trim());
        sm::operation_coordinator::run_exclusive_operation(|db| {
            json_string(&sm::project_inspection::inspect_project_skills(db, &project)?)
        })
    }

    /// 各助手项目级目标目录预览(JSON)。
    pub async fn previewProjectSkillTargets(project_path: String) -> Result<String, String> {
        if project_path.trim().is_empty() {
            return Err("项目路径不能为空".to_string());
        }
        let project = sm::app_core::expand_path(project_path.trim());
        let mut previews = Vec::new();
        let mut any_exists = false;
        for assistant in sm::app_core::assistant_definitions() {
            let target = sm::app_core::project_skill_root_by_name(assistant.name, &project)?;
            let exists = target.exists();
            any_exists = any_exists || exists;
            previews.push(serde_json::json!({
                "assistant": assistant.name,
                "target_path": target.to_string_lossy(),
                "exists": exists,
                "recommended": false,
            }));
        }
        if any_exists {
            for preview in &mut previews {
                preview["recommended"] = serde_json::Value::Bool(preview["exists"].as_bool().unwrap_or(false));
            }
        } else if let Some(first) = previews.first_mut() {
            first["recommended"] = serde_json::Value::Bool(true);
        }
        json_string(&previews)
    }

    /// 输入来源识别(JSON InstallDetection)。
    pub fn detectInstallSource(input: String) -> Result<String, String> {
        json_string(&sm::skill_install_source::detect_install_source_rules(input.trim()))
    }

    // ---- 市场 / 打开 ----
    /// 市场搜索(JSON MarketSearchResponse)。
    pub async fn searchMarket(source: String, query: String) -> Result<String, String> {
        json_string(&sm::market::search_market(source.trim(), query.trim())?)
    }

    /// 打开受支持的外部链接。
    pub fn openExternalUrl(url: String) -> Result<(), String> {
        let url = url.trim();
        if !(url.starts_with("https://github.com/") || url.starts_with("https://skills.sh/")) {
            return Err("只允许打开受支持的 Skill 来源".to_string());
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer").arg(url).spawn().map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open").arg(url).spawn().map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open").arg(url).spawn().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// 打开受管目录。
    pub async fn openFolder(path: String) -> Result<(), String> {
        let target = sm::app_core::expand_path(path.trim());
        let is_openable = sm::operation_coordinator::run_readonly_operation(|db| {
            Ok(sm::is_openable_managed_folder(db, &target)?)
        })?;
        if !is_openable {
            return Err("只允许打开受管助手 Skills 目录".to_string());
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer").arg(&target).spawn().map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open").arg(&target).spawn().map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open").arg(&target).spawn().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    // ---- 导入导出 ----
    /// 导出完整库(JSON 文件)。
    pub async fn exportLibrary(path: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let export = sm::library_manifest::build_library_export(
                sm::organization_commands::get_all_tags_from_db(db)?,
                sm::organization_commands::get_scenarios_from_db(db)?,
                sm::skill_inventory::scan_all_assistants(db)?,
                sm::skill_library::scan_unassigned_library_skills(db)?,
            );
            sm::library_manifest::write_library_export(path.trim().to_string(), &export)
        })
    }

    /// 导入库预览(JSON ImportPreview)。
    pub async fn previewImportLibrary(path: String, mode: Option<String>) -> Result<String, String> {
        let export = sm::library_manifest::read_library_export(path.trim().to_string())?;
        let replace_existing = matches!(mode.as_deref(), Some("replace"));
        sm::operation_coordinator::run_readonly_operation(|db| {
            json_string(&sm::library_manifest::preview_imported_library(db, &export, replace_existing)?)
        })
    }

    /// 执行导入(plan_token 两段式)。
    pub async fn importLibrary(path: String, mode: Option<String>, plan_token: Option<String>) -> Result<String, String> {
        let export = sm::library_manifest::read_library_export(path.trim().to_string())?;
        let replace_existing = matches!(mode.as_deref(), Some("replace"));
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let current_preview = sm::library_manifest::preview_imported_library(db, &export, replace_existing)?;
            sm::operation_plan::verify_operation_plan(&current_preview.plan_token, plan_token.as_deref())?;
            let (tag_count, scenario_count) = sm::library_manifest::merge_imported_library(db, export, replace_existing)?;
            Ok(format!(
                "{}导入 {} 个标签,{} 个场景",
                if replace_existing { "已替换并" } else { "已" },
                tag_count,
                scenario_count
            ))
        })
    }

    /// 导出场景清单(JSON 文件)。
    pub async fn exportScenarioManifest(path: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let manifest = sm::scenario_manifest::build_scenario_manifest(
                sm::organization_commands::get_scenarios_from_db(db)?,
            );
            sm::scenario_manifest::write_scenario_manifest(path.trim().to_string(), &manifest)
        })
    }

    /// 场景清单导入预览(JSON ScenarioManifestPreview)。
    pub async fn previewImportScenarioManifest(path: String, mode: Option<String>) -> Result<String, String> {
        let manifest = sm::scenario_manifest::read_scenario_manifest(path.trim().to_string())?;
        let replace_existing = matches!(mode.as_deref(), Some("replace"));
        sm::operation_coordinator::run_readonly_operation(|db| {
            json_string(&sm::scenario_manifest::preview_scenario_manifest(
                db,
                &manifest,
                replace_existing,
                &sm::skill_inventory::collect_known_skill_paths(db)?,
            )?)
        })
    }

    /// 执行场景清单导入(plan_token 两段式)。
    pub async fn importScenarioManifest(path: String, mode: Option<String>, plan_token: Option<String>) -> Result<String, String> {
        let manifest = sm::scenario_manifest::read_scenario_manifest(path.trim().to_string())?;
        let replace_existing = matches!(mode.as_deref(), Some("replace"));
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let current_preview = sm::scenario_manifest::preview_scenario_manifest(
                db,
                &manifest,
                replace_existing,
                &sm::skill_inventory::collect_known_skill_paths(db)?,
            )?;
            sm::operation_plan::verify_operation_plan(&current_preview.plan_token, plan_token.as_deref())?;
            let scenario_count = sm::scenario_manifest::merge_scenario_manifest(db, manifest, replace_existing)?;
            Ok(format!(
                "{}导入 {} 个场景",
                if replace_existing { "已替换并" } else { "已" },
                scenario_count
            ))
        })
    }

    /// 导出全局环境清单(skillmate.toml)。
    pub async fn exportSkillmateManifest(path: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let manifest = sm::skill_orchestration::build_current_manifest(db)?;
            sm::skillmate_manifest::write_skillmate_manifest(sm::app_core::expand_path(path.trim()), &manifest)
        })
    }

    /// 导出项目环境清单。
    pub async fn exportProjectSkillmateManifest(project_path: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            let project = sm::app_core::expand_path(project_path.trim());
            if !project.is_dir() {
                return Err("项目路径不存在或不是目录".to_string());
            }
            let manifest = sm::skill_orchestration::build_project_manifest(db, &project)?;
            if manifest.skills.is_empty() {
                return Err("该项目没有 SkillMate 受管的 Skill".to_string());
            }
            let target = project.join("skillmate.toml");
            sm::skillmate_manifest::write_skillmate_manifest(&target, &manifest)?;
            Ok(target.to_string_lossy().to_string())
        })
    }

    /// 环境清单应用预览(JSON SkillMateManifestPreview)。
    pub async fn previewApplySkillmateManifest(path: String) -> Result<String, String> {
        let manifest = sm::skillmate_manifest::read_skillmate_manifest(sm::app_core::expand_path(path.trim()))?;
        sm::operation_coordinator::run_exclusive_operation(|db| {
            json_string(&sm::skill_orchestration::preview_manifest(db, &manifest)?)
        })
    }

    /// 执行环境清单(plan_token 两段式)。
    pub async fn applySkillmateManifest(path: String, plan_token: Option<String>) -> Result<String, String> {
        let manifest = sm::skillmate_manifest::read_skillmate_manifest(sm::app_core::expand_path(path.trim()))?;
        sm::operation_coordinator::run_exclusive_operation(|db| {
            Ok(sm::skill_orchestration::apply_manifest_with_plan(db, &manifest, plan_token.as_deref())?.message("manifest"))
        })
    }

    // ---- 技能集 Profile ----
    /// 全部技能集(JSON SkillSetProfileStore)。
    pub fn getSkillProfiles() -> Result<String, String> {
        json_string(&sm::skill_profile::read_skill_profiles()?)
    }

    /// 保存当前选择为技能集(JSON SkillSetProfileStore)。
    pub async fn saveCurrentSkillProfile(name: String, description: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            json_string(&sm::skill_orchestration::save_current_profile(db, &name, &description)?)
        })
    }

    /// 技能集应用预览(JSON SkillSetProfilePreview)。
    pub async fn previewApplySkillProfile(profile_id: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            json_string(&sm::skill_orchestration::preview_profile(db, &profile_id)?)
        })
    }

    /// 执行技能集应用(plan_token 两段式)。
    pub async fn applySkillProfile(profile_id: String, plan_token: Option<String>) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            sm::skill_orchestration::apply_profile_with_plan(db, &profile_id, plan_token.as_deref())
        })
    }

    /// 回滚技能集。
    pub async fn rollbackSkillProfile() -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(sm::skill_orchestration::rollback_profile)
    }

    // ---- 设置写 ----
    /// 更新统一库位置。
    pub async fn setLibraryRoot(path: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            json_string(&sm::library_config::set_library_root(db, &path)?)
        })
    }

    /// 保存安装策略(JSON InstallPolicyConfig)。
    pub fn setInstallPolicy(config_json: String) -> Result<String, String> {
        let config: sm::install_policy::InstallPolicyConfig =
            serde_json::from_str(&config_json).map_err(|error| error.to_string())?;
        sm::operation_coordinator::run_exclusive_operation(|db| {
            json_string(&sm::install_policy::save_install_policy(db, config)?)
        })
    }

    /// Git 备份配置(JSON GitBackup)。
    pub async fn getGitBackup() -> Result<String, String> {
        sm::operation_coordinator::run_readonly_operation(|db| {
            json_string(&sm::git_backup::load(db)?)
        })
    }

    /// 配置 Git 备份。
    pub async fn setupGitBackup(repo_path: String, remote_url: String, branch: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            sm::git_backup::configure(db, &repo_path, &remote_url, &branch)?;
            Ok("已配置".to_string())
        })
    }

    /// 立即同步到 Git 备份。
    pub async fn syncToGit(message: String) -> Result<String, String> {
        sm::operation_coordinator::run_exclusive_operation(|db| {
            sm::git_backup::sync(db, &message)
        })
    }
}

static TRASH: std::sync::OnceLock<std::sync::Mutex<sm::skill_trash::SkillTrash>> = std::sync::OnceLock::new();

fn trash_slot() -> &'static std::sync::Mutex<sm::skill_trash::SkillTrash> {
    TRASH.get_or_init(|| {
        let restored = sm::operation_coordinator::run_exclusive_operation(|db| {
            sm::skill_trash::restore_or_purge_abandoned_trash(db)
        })
        .map(|(trash, _)| trash)
        .unwrap_or_default();
        std::sync::Mutex::new(restored)
    })
}
