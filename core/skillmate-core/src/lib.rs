//! SkillMate 核心:不含 UI 的业务库(库存扫描、统一技能库、安装/接管/停用的事务
//! 与来源追踪)。自 Tauri 版 SkillMate 移植:前端命令壳层留在各宿主应用,
//! 本 crate 只保留纯业务函数与领域类型。

pub mod app_core;
pub mod claude_marketplace;
pub mod cli;
pub mod database;
pub mod finding_review;
pub mod git_backup;
pub mod install_policy;
pub mod library_config;
pub mod library_manifest;
pub mod managed_installation;
pub mod managed_state;
pub mod market;
pub mod operation_coordinator;
pub mod operation_plan;
pub mod organization_commands;
pub mod project_inspection;
pub mod scenario_manifest;
pub mod skill_adoption;
pub mod skill_doctor;
pub mod skill_drift;
pub mod skill_install;
pub mod skill_install_source;
pub mod skill_inventory;
pub mod skill_library;
pub mod skill_materialization;
pub mod skill_model;
pub mod skill_orchestration;
pub mod skill_origin;
pub mod skill_package;
pub mod skill_profile;
pub mod skill_reconcile;
pub mod skill_structure;
pub mod skill_trash;
pub mod skillmate_manifest;
pub mod update_preview;

use app_core::{
    assistant_root_by_name, expand_path, managed_skill_roots, now_ms, project_skill_root_by_name,
};
use database::remember_database_initialization_error;
use install_policy::{
    evaluate_install_policy, load_install_policy, policy_failure_decision, InstallPolicyConfig,
    InstallPolicyInput,
};
use managed_installation::{
    find_managed_installation, list_managed_installations, record_managed_path,
    refresh_managed_installation,
};
use operation_coordinator::{initialize_managed_database, run_exclusive_operation};
use operation_plan::verify_operation_plan;
use organization_commands::{Scenario, Tag};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use skill_install::{
    install_selected_local_package_at_digest, installable_content_fingerprint,
    preview_selected_local_install_source, seal_install_preview, InstallPreview, InstallResult,
    PreparedGitInstall,
};
use skill_install_source::{install_target_name, is_git_install_source};
use skill_library::{
    add_deployment_to_preview, copy_origin_to_deployment, deploy_library_skill,
    is_library_skill_path, library_root, library_skill_id, register_deployment,
    register_library_skill, reuse_library_preview,
};
use skill_origin::{
    save_installed_git_meta as save_git_origin_meta, save_installed_local_meta as save_local_origin_meta,
};
use skill_package::PackageDetection;
pub use skill_reconcile::ReconcileTransaction;
use skill_structure::SkillStructureInfo;
use std::fs;
use std::path::{Path, PathBuf};

// 仅供 lib.rs 内联测试通过 `use super::*` 引用的再导出。
#[cfg(test)]
use install_policy::save_install_policy;
#[cfg(test)]
use library_manifest::{build_library_export, merge_imported_library, preview_imported_library};
#[cfg(test)]
use managed_installation::{
    cleanup_skill_metadata, is_explicitly_managed, verify_managed_content_unchanged,
};
#[cfg(test)]
use project_inspection::inspect_project_skills;
#[cfg(test)]
use skill_inventory::scan_all_assistants;
#[cfg(test)]
use skill_library::scan_unassigned_library_skills;
#[cfg(test)]
use organization_commands::get_scenarios_from_db;
#[cfg(test)]
use scenario_manifest::{merge_scenario_manifest, preview_scenario_manifest};
#[cfg(test)]
use skill_orchestration::{build_current_manifest, preview_manifest};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillInventoryFields {
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
    pub readme: String,
    pub version: String,
    pub content_hash: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillOriginFields {
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
    pub last_probe_at: Option<i64>,
    pub last_sync_at: Option<i64>,
    pub managed_by_app: bool,
    pub can_check: bool,
    pub can_sync: bool,
    pub symlink_source: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillStructureFields {
    pub structure_status: String,
    pub structure_features: Vec<String>,
    pub structure_warnings: Vec<String>,
    pub manifest_title: Option<String>,
    pub manifest_description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Skill {
    #[serde(flatten)]
    pub inventory: SkillInventoryFields,
    #[serde(flatten)]
    pub origin: SkillOriginFields,
    #[serde(flatten)]
    pub structure: SkillStructureFields,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectSkillTargetPreview {
    pub assistant: String,
    pub target_path: String,
    pub exists: bool,
    pub recommended: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillScanDiagnostic {
    pub path: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AIAssistant {
    pub name: String,
    pub path: String,
    pub paths: Vec<String>,
    pub ai_type: String,
    pub icon: String,
    pub skills: Vec<Skill>,
    pub diagnostics: Vec<SkillScanDiagnostic>,
    pub exists: bool,
    pub supports_project_skills: bool,
}

pub fn install_result(
    success: bool,
    message: impl Into<String>,
    output: impl Into<String>,
    structure: Option<SkillStructureInfo>,
) -> InstallResult {
    let structure = structure.unwrap_or_default();
    InstallResult {
        success,
        message: message.into(),
        output: output.into(),
        structure_status: structure.structure_status,
        structure_features: structure.structure_features,
        structure_warnings: structure.structure_warnings,
        manifest_title: structure.manifest_title,
        manifest_description: structure.manifest_description,
    }
}

pub struct InstallPreviewRequest<'a> {
    pub package: &'a str,
    pub source: &'a str,
    pub assistant_name: &'a str,
    pub mode: &'a str,
    pub project_path: Option<&'a str>,
    pub selected_skill_paths: Option<&'a [String]>,
    pub preferred_skill_id: Option<&'a str>,
}

pub fn build_install_request_preview(
    db: &Connection,
    request: InstallPreviewRequest<'_>,
    policy: Result<&InstallPolicyConfig, String>,
) -> InstallPreview {
    build_install_request_preview_with_prepared(db, request, policy, None, None)
}

/// `prepared_git` 允许调用方在操作锁外提前完成 git 克隆与检测，
/// `resolved_marketplace` 允许调用方复用锁外的市场来源解析；
/// 传 `None` 时在锁内自行准备（CLI 与测试沿用原路径）。
#[allow(clippy::too_many_arguments)]
fn build_install_request_preview_with_prepared(
    db: &Connection,
    request: InstallPreviewRequest<'_>,
    policy: Result<&InstallPolicyConfig, String>,
    prepared_git: Option<Result<PreparedGitInstall, String>>,
    resolved_marketplace: Option<Result<(String, String), String>>,
) -> InstallPreview {
    let InstallPreviewRequest {
        package,
        source,
        assistant_name,
        mode,
        project_path,
        selected_skill_paths,
        preferred_skill_id,
    } = request;
    let resolved_package;
    let resolved_source;
    let (package, source) = if source == "claude_marketplace" {
        match resolved_marketplace
            .unwrap_or_else(|| claude_marketplace::resolve_plugin_source(package))
        {
            Ok((package_value, source_value)) => {
                resolved_package = package_value;
                resolved_source = source_value;
                (resolved_package.as_str(), resolved_source.as_str())
            }
            Err(error) => {
                return finalize_install_request_preview(
                    mark_reviewed_findings(
                        db,
                        install_preview_error(error, source.to_string(), String::new()),
                    ),
                    package,
                    source,
                    assistant_name,
                    mode,
                    project_path,
                    policy,
                );
            }
        }
    } else {
        (package, source)
    };
    let deployment_root = if mode == "library" {
        None
    } else {
        match install_target_root(assistant_name, mode, project_path) {
            Ok(path) => Some(path),
            Err(err) => {
                return finalize_install_request_preview(
                    mark_reviewed_findings(
                        db,
                        install_preview_error(err, source.to_string(), String::new()),
                    ),
                    package,
                    source,
                    assistant_name,
                    mode,
                    project_path,
                    policy,
                );
            }
        }
    };
    let library_root = match library_root() {
        Ok(path) => path,
        Err(error) => {
            return finalize_install_request_preview(
                mark_reviewed_findings(
                    db,
                    install_preview_error(error, source.to_string(), String::new()),
                ),
                package,
                source,
                assistant_name,
                mode,
                project_path,
                policy,
            );
        }
    };
    let preview = if is_git_install_source(source) {
        let skill_name = install_target_name(package, source).unwrap_or_default();
        let prepared = match prepared_git {
            Some(result) => result,
            None => PreparedGitInstall::prepare_selected(
                package,
                selected_skill_paths,
                preferred_skill_id,
            ),
        };
        match prepared {
            Ok(prepared) => prepared.preview(&library_root, &skill_name),
            Err(error) => {
                let mut preview = install_preview_error(
                    error,
                    "git".to_string(),
                    library_root.join(&skill_name).to_string_lossy().to_string(),
                );
                preview.target_name = skill_name;
                preview
            }
        }
    } else {
        let preview =
            preview_selected_local_install_source(package, &library_root, selected_skill_paths);
        if source == "local" && is_library_skill_path(&expand_path(package.trim())) {
            reuse_library_preview(db, preview)
        } else {
            preview
        }
    };
    let preview = if let Some(deployment_root) = deployment_root.as_deref() {
        let scope = if mode == "symlink" {
            "project"
        } else {
            "global"
        };
        add_deployment_to_preview(db, preview, deployment_root, assistant_name, scope, false)
    } else {
        library_only_preview(preview)
    };
    finalize_install_request_preview(
        mark_reviewed_findings(db, preview),
        package,
        source,
        assistant_name,
        mode,
        project_path,
        policy,
    )
}

fn library_only_preview(mut preview: InstallPreview) -> InstallPreview {
    if preview.can_apply {
        preview.message = format!(
            "将 {} 个 Skill 添加到 SkillMate 库",
            preview.package_detection.detected_skills.len()
        );
    }
    preview
}

/// 「已审阅」是展示态：逐条标记 findings，全部审阅后摘除提醒代码，
/// 减少重复打扰。findings 本身不进计划令牌（见 seal_install_preview）。
fn mark_reviewed_findings(db: &Connection, mut preview: InstallPreview) -> InstallPreview {
    for skill in &mut preview.package_detection.detected_skills {
        let _ = crate::finding_review::apply_review_state(db, &mut skill.suspicious_instructions);
    }
    if crate::finding_review::apply_review_state(db, &mut preview.suspicious_instructions)
        .map(|pending| !pending)
        .unwrap_or(false)
    {
        preview
            .structure_warnings
            .retain(|code| code != "suspicious_instructions");
    }
    preview
}

fn finalize_install_request_preview(
    mut preview: InstallPreview,
    package: &str,
    source: &str,
    assistant_name: &str,
    mode: &str,
    project_path: Option<&str>,
    policy: Result<&InstallPolicyConfig, String>,
) -> InstallPreview {
    apply_policy_to_preview(&mut preview, package, source, policy);
    seal_install_preview(preview, package, assistant_name, mode, project_path)
}

pub(crate) fn apply_policy_to_preview(
    preview: &mut InstallPreview,
    package: &str,
    source: &str,
    policy: Result<&InstallPolicyConfig, String>,
) {
    let mut warnings = preview.structure_warnings.clone();
    warnings.extend(preview.package_detection.warnings.iter().cloned());
    for skill in &preview.package_detection.detected_skills {
        warnings.extend(skill.warnings.iter().cloned());
    }
    warnings.sort();
    warnings.dedup();
    let decision = match policy {
        Ok(policy) => evaluate_install_policy(
            policy,
            InstallPolicyInput {
                source_kind: source,
                source: package.trim(),
                structure_status: &preview.structure_status,
                warnings: &warnings,
            },
        ),
        Err(error) => policy_failure_decision(format!("无法读取安装策略: {error}")),
    };
    if !decision.allowed {
        preview.can_install = false;
        preview.can_apply = false;
        preview.message = decision.message.clone();
        if !preview
            .conflicts
            .iter()
            .any(|conflict| conflict.reason == "install_policy_blocked")
        {
            preview.conflicts.push(skill_install::PreviewConflict {
                target: preview.target_path.clone(),
                reason: "install_policy_blocked".to_string(),
            });
        }
    }
    preview.install_policy = decision;
}

pub struct InstallSkillRequest {
    pub package: String,
    pub source: String,
    pub assistant_name: String,
    pub install_mode: Option<String>,
    pub project_path: Option<String>,
    pub selected_skill_paths: Option<Vec<String>>,
    pub preferred_skill_id: Option<String>,
    pub plan_token: Option<String>,
}

pub fn install_skill_blocking(request: InstallSkillRequest) -> InstallResult {
    match run_exclusive_operation(move |db| Ok(install_skill_exclusive(db, request))) {
        Ok(result) => result,
        Err(error) => install_result(false, error, "", None),
    }
}

pub fn install_skill_exclusive(db: &Connection, request: InstallSkillRequest) -> InstallResult {
    let InstallSkillRequest {
        mut package,
        mut source,
        assistant_name,
        install_mode,
        project_path,
        selected_skill_paths,
        preferred_skill_id,
        plan_token,
    } = request;
    if source == "claude_marketplace" {
        match claude_marketplace::resolve_plugin_source(&package) {
            Ok((resolved_package, resolved_source)) => {
                package = resolved_package;
                source = resolved_source;
            }
            Err(error) => return install_result(false, error, "", None),
        }
    }
    let mode = install_mode.unwrap_or_else(|| "copy".to_string());
    let library_only = mode == "library";
    let reuse_existing_library =
        source == "local" && is_library_skill_path(&expand_path(package.trim()));
    let policy = load_install_policy(db);
    let deployment_root = if library_only {
        None
    } else {
        match install_target_root(&assistant_name, &mode, project_path.as_deref()) {
            Ok(path) => Some(path),
            Err(err) => return install_result(false, err, "", None),
        }
    };
    let library_root = match library_root() {
        Ok(path) => path,
        Err(error) => return install_result(false, error, "", None),
    };
    let skill_name = match install_target_name(&package, &source) {
        Ok(name) => name,
        Err(err) => return install_result(false, err, "", None),
    };
    let (prepared_git, current_preview) = if is_git_install_source(&source) {
        match PreparedGitInstall::prepare_selected(
            &package,
            selected_skill_paths.as_deref(),
            preferred_skill_id.as_deref(),
        ) {
            Ok(prepared) => {
                let preview = if let Some(deployment_root) = deployment_root.as_deref() {
                    add_deployment_to_preview(
                        db,
                        prepared.preview(&library_root, &skill_name),
                        deployment_root,
                        &assistant_name,
                        if mode == "symlink" {
                            "project"
                        } else {
                            "global"
                        },
                        false,
                    )
                } else {
                    library_only_preview(prepared.preview(&library_root, &skill_name))
                };
                (
                    Some(prepared),
                    finalize_install_request_preview(
                        mark_reviewed_findings(db, preview),
                        &package,
                        &source,
                        &assistant_name,
                        &mode,
                        project_path.as_deref(),
                        policy.as_ref().map_err(Clone::clone),
                    ),
                )
            }
            Err(error) => {
                let mut preview = install_preview_error(
                    error,
                    "git".to_string(),
                    library_root.join(&skill_name).to_string_lossy().to_string(),
                );
                preview.target_name = skill_name.clone();
                (
                    None,
                    finalize_install_request_preview(
                        mark_reviewed_findings(db, preview),
                        &package,
                        &source,
                        &assistant_name,
                        &mode,
                        project_path.as_deref(),
                        policy.as_ref().map_err(Clone::clone),
                    ),
                )
            }
        }
    } else {
        (
            None,
            build_install_request_preview(
                db,
                InstallPreviewRequest {
                    package: &package,
                    source: &source,
                    assistant_name: &assistant_name,
                    mode: &mode,
                    project_path: project_path.as_deref(),
                    selected_skill_paths: selected_skill_paths.as_deref(),
                    preferred_skill_id: preferred_skill_id.as_deref(),
                },
                policy.as_ref().map_err(Clone::clone),
            ),
        )
    };
    if let Err(error) = verify_operation_plan(&current_preview.plan_token, plan_token.as_deref()) {
        return install_result(false, error, "", None);
    }
    if !current_preview.can_apply {
        return install_result(false, current_preview.message, "", None);
    }
    for root in std::iter::once(&library_root).chain(deployment_root.iter()) {
        if let Err(err) = fs::create_dir_all(root) {
            return install_result(false, format!("无法创建目标目录: {}", err), "", None);
        }
    }

    let scope = if library_only {
        "library"
    } else if mode == "symlink" {
        "project"
    } else {
        "global"
    };
    let planned_targets = current_preview
        .target_actions
        .iter()
        .filter(|action| matches!(action.action.as_str(), "copy" | "keep" | "symlink"))
        .map(|action| PathBuf::from(&action.target))
        .collect::<Vec<_>>();
    if planned_targets.is_empty() {
        return install_result(false, "安装计划没有可执行目标", "", None);
    }
    let mut transaction = match ReconcileTransaction::prepare_managed(db, &[], &planned_targets) {
        Ok(transaction) => transaction,
        Err(error) => return install_result(false, "无法建立安装事务", error, None),
    };

    let operation = match source.as_str() {
        source_kind if is_git_install_source(source_kind) => prepared_git
            .ok_or_else(|| "Git 安装来源尚未准备完成".to_string())
            .and_then(|prepared| {
                prepared.apply(
                    &library_root,
                    &skill_name,
                    "SkillMate",
                    Some(&current_preview.resolved_ref),
                    |target_path, spec, outcome| {
                        save_git_origin_meta(db, target_path, spec, outcome)
                    },
                )
            })
            .map(|outcome| outcome.structure),
        "local" if reuse_existing_library => {
            let source_path = expand_path(package.trim());
            installable_content_fingerprint(&source_path).and_then(|digest| {
                if digest != current_preview.source_digest {
                    return Err("SkillMate 库内容在预览后发生变化，请重新检查结构".to_string());
                }
                let structure = skill_structure::analyze_skill_structure(&source_path);
                if structure.structure_status == "complete" {
                    Ok(structure)
                } else {
                    Err("SkillMate 库中的 Skill 结构不再有效".to_string())
                }
            })
        }
        "local" => {
            let source_path = expand_path(package.trim());
            install_selected_local_package_at_digest(
                &source_path,
                &library_root,
                &skill_name,
                "SkillMate",
                Some(&current_preview.source_digest),
                selected_skill_paths.as_deref(),
            )
        }
        _ => Err("当前版本仅支持 Git 仓库和本地目录安装".to_string()),
    };

    let structure = match operation {
        Ok(result) => result,
        Err(error) => return rollback_install_result(&mut transaction, "安装失败", error),
    };
    let library_paths = current_preview
        .target_actions
        .iter()
        .filter(|action| {
            matches!(action.action.as_str(), "copy" | "keep")
                && Path::new(&action.target).parent() == Some(library_root.as_path())
        })
        .map(|action| PathBuf::from(&action.target))
        .collect::<Vec<_>>();
    let deployment_paths = current_preview
        .target_actions
        .iter()
        .filter(|action| {
            action.action == "symlink"
                || (action.action == "keep"
                    && deployment_root.as_deref() == Path::new(&action.target).parent())
        })
        .map(|action| PathBuf::from(&action.target))
        .collect::<Vec<_>>();
    if (!library_only && library_paths.len() != deployment_paths.len())
        || (library_only && !deployment_paths.is_empty())
    {
        return rollback_install_result(
            &mut transaction,
            "安装失败",
            "SkillMate 库与启用计划不一致".to_string(),
        );
    }
    let registration = finalize_library_install_registration(
        db,
        &package,
        &source,
        &assistant_name,
        scope,
        project_path.as_deref(),
        &library_root,
        deployment_root.as_deref(),
        &library_paths,
        &deployment_paths,
        current_preview.resolved_ref.as_str(),
        reuse_existing_library,
    );
    if let Err(error) = registration {
        return rollback_install_result(&mut transaction, "记录受管状态失败", error);
    }
    let message = if library_only {
        "已添加到 SkillMate 库".to_string()
    } else if reuse_existing_library {
        format!(
            "已在 {} 中启用",
            if scope == "project" {
                "当前项目"
            } else {
                &assistant_name
            }
        )
    } else {
        format!(
            "已添加到 SkillMate，并在 {} 中启用",
            if scope == "project" {
                "当前项目"
            } else {
                &assistant_name
            }
        )
    };
    match transaction.commit() {
        Ok(None) => install_result(true, message, "", Some(structure)),
        Ok(Some(warning)) => install_result(true, message, warning, Some(structure)),
        Err(error) => install_result(false, "提交安装事务失败", error, None),
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn finalize_library_install_registration(
    db: &Connection,
    package: &str,
    source: &str,
    assistant_name: &str,
    scope: &str,
    project_path: Option<&str>,
    library_root: &Path,
    deployment_root: Option<&Path>,
    library_paths: &[PathBuf],
    deployment_paths: &[PathBuf],
    resolved_ref: &str,
    reuse_existing_library: bool,
) -> Result<(), String> {
    let mut skill_ids = Vec::with_capacity(library_paths.len());
    for library_path in library_paths {
        if !reuse_existing_library {
            record_managed_path(db, library_root, library_path, "library", None)?;
        }
        let skill_id = if reuse_existing_library {
            library_skill_id(db, library_path)?
        } else {
            let skill_id = register_library_skill(
                db,
                library_path,
                package,
                source,
                (!resolved_ref.trim().is_empty()).then_some(resolved_ref),
            )?;
            if source == "local"
                && skill_origin::load_origin_meta(db, &library_path.to_string_lossy())?.is_none()
            {
                let source = find_managed_installation(db, library_path)?
                    .map(|installation| installation.skill.source)
                    .unwrap_or_else(|| package.trim().to_string());
                let source_path = expand_path(&source);
                let source_path = if source_path.is_absolute() {
                    source_path
                } else {
                    std::env::current_dir()
                        .map_err(|error| format!("无法记录本地来源: {error}"))?
                        .join(source_path)
                };
                save_local_origin_meta(db, library_path, &source_path)?;
            }
            skill_id
        };
        skill_ids.push(skill_id);
    }
    if deployment_paths.is_empty() {
        return Ok(());
    }
    let deployment_root = deployment_root.ok_or_else(|| "启用计划缺少目标目录".to_string())?;
    for ((library_path, skill_id), deployment_path) in
        library_paths.iter().zip(skill_ids).zip(deployment_paths)
    {
        if skill_library::connected_managed_deployment(
            db,
            library_path,
            deployment_path,
            assistant_name,
            scope,
        )? {
            continue;
        }
        let deploy_mode = deploy_library_skill(library_path, deployment_path)?;
        managed_state::mark_managed_skill(
            deployment_root,
            assistant_name,
            deployment_path,
            &format!("symlink:{}", library_path.to_string_lossy()),
        )?;
        record_managed_path(db, deployment_root, deployment_path, scope, project_path)?;
        register_deployment(
            db,
            &skill_id,
            library_path,
            deployment_path,
            assistant_name,
            scope,
            project_path,
            &deploy_mode,
        )?;
        copy_origin_to_deployment(db, library_path, deployment_path)?;
        if !refresh_managed_installation(db, deployment_path, None)? {
            return Err(format!(
                "未能刷新启用记录: {}",
                deployment_path.to_string_lossy()
            ));
        }
    }
    Ok(())
}

pub(crate) fn rollback_install_result(
    transaction: &mut ReconcileTransaction<'_>,
    message: &str,
    error: String,
) -> InstallResult {
    match rollback_install_attempt(transaction) {
        Ok(()) => install_result(false, message, format!("{}；已回滚安装变更", error), None),
        Err(rollback_error) => install_result(
            false,
            format!("{}，且回滚不完整", message),
            format!("{}；回滚失败: {}", error, rollback_error),
            None,
        ),
    }
}

fn rollback_install_attempt(transaction: &mut ReconcileTransaction<'_>) -> Result<(), String> {
    transaction.rollback()
}

fn install_target_root(
    assistant_name: &str,
    install_mode: &str,
    project_path: Option<&str>,
) -> Result<PathBuf, String> {
    if install_mode == "symlink" {
        let raw_project = project_path
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .ok_or_else(|| "项目软连接安装需要填写项目路径".to_string())?;
        let project = expand_path(raw_project);
        return project_skill_root_by_name(assistant_name, &project);
    }
    assistant_root_by_name(assistant_name)
}

fn install_preview_error(
    message: impl Into<String>,
    source_kind: String,
    target_path: String,
) -> InstallPreview {
    InstallPreview {
        can_install: false,
        can_apply: false,
        message: message.into(),
        target_name: String::new(),
        target_path,
        source_kind,
        package_detection: PackageDetection {
            package_kind: "unknown".to_string(),
            detected_skills: vec![],
            warnings: vec!["unrecognized_input".to_string()],
            needs_model: false,
        },
        target_actions: vec![],
        conflicts: vec![],
        structure_status: "nonstandard".to_string(),
        structure_features: vec![],
        structure_warnings: vec!["unrecognized_input".to_string()],
        manifest_title: None,
        manifest_description: None,
        install_policy: install_policy::InstallPolicyDecision::default(),
        plan_token: String::new(),
        source_digest: String::new(),
        resolved_ref: String::new(),
        available_skills: vec![],
        selection_required: false,
        suspicious_instructions: vec![],
    }
}

pub fn failed_sync_info(message: &str) -> serde_json::Value {
    serde_json::json!({
        "originKind": "unknown",
        "originLocator": "",
        "resolvedLocator": "",
        "trackingRef": "",
        "installedRef": "",
        "latestRef": "",
        "syncState": "failed",
        "message": message,
        "lagCount": 0,
        "lastProbeAt": now_ms(),
        "lastSyncAt": null,
        "managedByApp": false,
        "canCheck": false,
        "canSync": false,
        "hasUpdate": false,
        "behindCount": 0,
        "remoteUrl": ""
    })
}

pub fn is_openable_managed_folder(db: &Connection, path: &Path) -> Result<bool, String> {
    if is_openable_managed_folder_with_roots(path, &managed_skill_roots()) {
        return Ok(true);
    }
    let managed_paths = list_managed_installations(db)?
        .into_iter()
        .map(|installation| installation.path)
        .collect::<Vec<_>>();
    Ok(is_openable_registered_folder(path, &managed_paths))
}

fn is_openable_managed_folder_with_roots(path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| is_same_or_child_path(path, root))
}

fn is_same_or_child_path(path: &Path, root: &Path) -> bool {
    let Ok(canonical_path) = path.canonicalize() else {
        return false;
    };
    let Ok(canonical_root) = root.canonicalize() else {
        return false;
    };
    canonical_path == canonical_root || canonical_path.starts_with(canonical_root)
}

fn is_openable_registered_folder(path: &Path, managed_paths: &[PathBuf]) -> bool {
    managed_paths.iter().any(|managed_path| {
        let parent_matches = managed_path
            .parent()
            .map(|parent| is_same_path(path, parent))
            .unwrap_or(false);
        if parent_matches {
            return true;
        }
        let is_link = fs::symlink_metadata(managed_path)
            .map(|metadata| crate::app_core::metadata_is_directory_link(&metadata))
            .unwrap_or(false);
        !is_link && is_same_path(path, managed_path)
    })
}

fn is_same_path(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

pub fn initialize_database_state() -> (Option<Connection>, skill_trash::SkillTrash) {
    let (db, report) = match initialize_managed_database() {
        Ok(result) => result,
        Err(error) => {
            let message = remember_database_initialization_error(&error);
            eprintln!("{}", message);
            return (None, skill_trash::SkillTrash::default());
        }
    };
    let mut restored_trash = skill_trash::SkillTrash::default();
    if let Err(error) = run_exclusive_operation(|db| {
        let (trash, removed) = skill_trash::restore_or_purge_abandoned_trash(db)?;
        restored_trash = trash;
        Ok(removed)
    }) {
        eprintln!("恢复可撤销暂存区失败: {}", error);
    }
    if report.recovered_transactions > 0 {
        eprintln!(
            "已恢复 {} 个未完成的文件事务",
            report.recovered_transactions
        );
    }
    for warning in report.warnings {
        eprintln!("{}", warning);
    }
    (Some(db), restored_trash)
}

#[cfg(test)]
mod tests {
    mod scenario_workflow_tests;
    mod update_preview_tests;
    use super::*;
    use crate::app_core::generate_id;
    use crate::library_manifest::{LibraryExport, LibrarySkillRecord};
    use crate::scenario_manifest::ScenarioManifest;
    use crate::skill_model::SkillDescriptor;
    use crate::skill_orchestration::apply_manifest;
    use crate::skillmate_manifest::SkillMateManifest;
    use rusqlite::params;

    fn test_db() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute(
            "CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL)",
            [],
        )
        .unwrap();
        db.execute("CREATE TABLE scenarios (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, skill_ids TEXT, skill_ids_json TEXT NOT NULL DEFAULT '[]', created_at TEXT)", []).unwrap();
        db.execute(
            "CREATE TABLE skill_tags (skill_path TEXT PRIMARY KEY, tags TEXT, tags_json TEXT NOT NULL DEFAULT '[]')",
            [],
        )
        .unwrap();
        db.execute_batch(
            "CREATE TABLE skill_origin_meta (
                skill_path TEXT PRIMARY KEY,
                origin_kind TEXT NOT NULL DEFAULT 'unknown',
                origin_locator TEXT NOT NULL DEFAULT '',
                resolved_locator TEXT NOT NULL DEFAULT '',
                tracking_ref TEXT NOT NULL DEFAULT '',
                installed_ref TEXT NOT NULL DEFAULT '',
                latest_ref TEXT NOT NULL DEFAULT '',
                sync_state TEXT NOT NULL DEFAULT 'unprobed',
                sync_message TEXT NOT NULL DEFAULT '',
                lag_count INTEGER NOT NULL DEFAULT 0,
                last_probe_at INTEGER,
                last_sync_at INTEGER,
                managed_by_app INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE managed_installations (
                skill_path TEXT PRIMARY KEY, assistant TEXT NOT NULL, source TEXT NOT NULL,
                source_kind TEXT NOT NULL, target_name TEXT NOT NULL, scope TEXT NOT NULL,
                install_mode TEXT NOT NULL, project_path TEXT, tracking_ref TEXT, subdir TEXT,
                resolved_ref TEXT, content_hash TEXT, installed_at TEXT NOT NULL
            );
            CREATE TABLE managed_roots (
                root_path TEXT PRIMARY KEY, scope TEXT NOT NULL,
                project_path TEXT, updated_at TEXT NOT NULL
            );
            CREATE TABLE library_skills (
                id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, library_path TEXT NOT NULL UNIQUE,
                source TEXT NOT NULL, source_kind TEXT NOT NULL, resolved_ref TEXT,
                content_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE skill_deployments (
                target_path TEXT PRIMARY KEY, skill_id TEXT NOT NULL, library_path TEXT NOT NULL,
                assistant TEXT NOT NULL, scope TEXT NOT NULL, project_path TEXT,
                deploy_mode TEXT NOT NULL, deployed_at TEXT NOT NULL,
                FOREIGN KEY(skill_id) REFERENCES library_skills(id) ON DELETE RESTRICT
            );
            CREATE TABLE install_policy (
                id INTEGER PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off',
                block_risky_content INTEGER NOT NULL DEFAULT 0,
                trusted_git_hosts_json TEXT NOT NULL DEFAULT '[]',
                trusted_local_roots_json TEXT NOT NULL DEFAULT '[]'
            );",
        )
        .unwrap();
        db
    }

    fn test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("skillmate-test-{}-{}", name, now_ms()))
    }

    fn materialization_fixture(
        label: &str,
    ) -> (
        Connection,
        PathBuf,
        PathBuf,
        PathBuf,
        skill_library::TestLibraryRootGuard,
    ) {
        let db = test_db();
        let root = test_dir(label);
        fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let library = root.join("library");
        let guard = skill_library::use_test_library_root(library.clone());
        let source = root.join("writer");
        let project = root.join("project");
        fs::create_dir_all(&source).unwrap();
        fs::write(
            source.join("SKILL.md"),
            "---\nname: writer\ndescription: 写作\n---\n原始内容\n",
        )
        .unwrap();
        apply_manifest(
            &db,
            &SkillMateManifest {
                version: 2,
                reconcile: false,
                skills: vec![SkillDescriptor {
                    assistant: "Codex".to_string(),
                    source: source.to_string_lossy().to_string(),
                    source_kind: "local".to_string(),
                    scope: Some("project".to_string()),
                    project_path: Some(project.to_string_lossy().to_string()),
                    ..Default::default()
                }],
            },
        )
        .unwrap();
        let target = project_skill_root_by_name("Codex", &project)
            .unwrap()
            .join("writer");
        assert!(fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
        save_local_origin_meta(&db, &library.join("writer"), &source).unwrap();
        copy_origin_to_deployment(&db, &library.join("writer"), &target).unwrap();
        (db, root, project, target, guard)
    }

    #[test]
    fn materialization_releases_only_the_project_copy_and_preserves_library() {
        let (db, root, project, target, _guard) = materialization_fixture("materialize-success");
        let library = root.join("library/writer");
        fs::create_dir_all(library.join("scripts")).unwrap();
        fs::write(library.join("scripts/helper.txt"), "辅助内容").unwrap();
        let library_hash = managed_state::content_fingerprint(&library).unwrap();
        let other_project = root.join("other-project");
        fs::create_dir_all(&other_project).unwrap();
        let other_root = project_skill_root_by_name("Codex", &other_project).unwrap();
        let other_target = other_root.join("writer");
        finalize_library_install_registration(
            &db,
            &library.to_string_lossy(),
            "local",
            "Codex",
            "project",
            Some(&other_project.to_string_lossy()),
            &root.join("library"),
            Some(&other_root),
            std::slice::from_ref(&library),
            std::slice::from_ref(&other_target),
            "",
            true,
        )
        .unwrap();
        db.execute(
            "INSERT INTO skill_tags (skill_path, tags_json) VALUES (?, '[\"writing\"]')",
            [library.to_string_lossy().as_ref()],
        )
        .unwrap();
        let path = target.to_string_lossy();
        let project_path = project.to_string_lossy();
        let preview =
            skill_materialization::preview_materialize_skill(&db, &path, "Codex", &project_path)
                .unwrap();
        assert!(preview.can_apply, "{}", preview.message);
        assert!(fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
        let result = skill_materialization::materialize_skill(
            &db,
            &path,
            "Codex",
            &project_path,
            Some(&preview.plan_token),
        );
        assert!(result.success, "{}: {}", result.message, result.output);
        assert!(!fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            fs::read(target.join("SKILL.md")).unwrap(),
            fs::read(library.join("SKILL.md")).unwrap()
        );
        assert_eq!(
            fs::read_to_string(target.join("scripts/helper.txt")).unwrap(),
            "辅助内容"
        );
        assert_eq!(
            managed_state::content_fingerprint(&library).unwrap(),
            library_hash
        );
        assert!(find_managed_installation(&db, &target).unwrap().is_none());
        assert!(skill_library::find_deployment(&db, &target)
            .unwrap()
            .is_none());
        assert!(!is_explicitly_managed(&db, &target).unwrap());
        assert!(find_managed_installation(&db, &library).unwrap().is_some());
        assert!(skill_library::find_deployment(&db, &other_target)
            .unwrap()
            .is_some());
        assert!(fs::symlink_metadata(&other_target)
            .unwrap()
            .file_type()
            .is_symlink());
        let origin = skill_origin::load_origin_meta(&db, &path).unwrap().unwrap();
        assert!(!origin.managed_by_app);
        assert_eq!(origin.origin_kind, "local");
        let tags: String = db
            .query_row(
                "SELECT tags_json FROM skill_tags WHERE skill_path = ?",
                [&*path],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tags, "[\"writing\"]");
        let inspection = inspect_project_skills(&db, &project).unwrap();
        let copy = inspection
            .assistants
            .iter()
            .find(|assistant| assistant.name == "Codex")
            .unwrap()
            .skills
            .iter()
            .find(|skill| skill.scope == "project")
            .unwrap();
        assert!(!copy.skill.origin.managed_by_app);
        assert!(!copy.skill.origin.can_sync);
        assert!(copy.skill.origin.symlink_source.is_none());
        fs::write(library.join("scripts/helper.txt"), "库更新").unwrap();
        assert_eq!(
            fs::read_to_string(target.join("scripts/helper.txt")).unwrap(),
            "辅助内容"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn materialization_rejects_stale_or_missing_plan_without_replacing_link() {
        let (db, root, project, target, _guard) = materialization_fixture("materialize-stale");
        let path = target.to_string_lossy();
        let project_path = project.to_string_lossy();
        let preview =
            skill_materialization::preview_materialize_skill(&db, &path, "Codex", &project_path)
                .unwrap();
        let missing =
            skill_materialization::materialize_skill(&db, &path, "Codex", &project_path, None);
        assert!(!missing.success);
        fs::write(
            root.join("library/writer/SKILL.md"),
            "---\nname: writer\ndescription: 新内容\n---\n",
        )
        .unwrap();
        let stale = skill_materialization::materialize_skill(
            &db,
            &path,
            "Codex",
            &project_path,
            Some(&preview.plan_token),
        );
        assert!(!stale.success);
        assert!(stale.message.contains("已过期"));
        assert!(fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(is_explicitly_managed(&db, &target).unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn materialization_rolls_back_files_database_and_sidecar_on_metadata_failure() {
        let (db, root, project, target, _guard) = materialization_fixture("materialize-rollback");
        let path = target.to_string_lossy();
        let project_path = project.to_string_lossy();
        let original_link = fs::read_link(&target).unwrap();
        let state_path = target
            .parent()
            .unwrap()
            .join(managed_state::STATE_FILE_NAME);
        let state = fs::read(&state_path).unwrap();
        let preview =
            skill_materialization::preview_materialize_skill(&db, &path, "Codex", &project_path)
                .unwrap();
        db.execute_batch("CREATE TRIGGER fail_released_origin BEFORE INSERT ON skill_origin_meta WHEN NEW.managed_by_app = 0 BEGIN SELECT RAISE(FAIL, '模拟来源登记失败'); END;").unwrap();
        let result = skill_materialization::materialize_skill(
            &db,
            &path,
            "Codex",
            &project_path,
            Some(&preview.plan_token),
        );
        assert!(!result.success);
        assert!(result.output.contains("模拟来源登记失败"));
        assert_eq!(fs::read_link(&target).unwrap(), original_link);
        assert_eq!(fs::read(state_path).unwrap(), state);
        assert!(find_managed_installation(&db, &target).unwrap().is_some());
        assert!(skill_library::find_deployment(&db, &target)
            .unwrap()
            .is_some());
        assert!(
            skill_origin::load_origin_meta(&db, &path)
                .unwrap()
                .unwrap()
                .managed_by_app
        );
        verify_managed_content_unchanged(&db, &target).unwrap();
        assert!(root.join("library/writer/SKILL.md").is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn materialization_rejects_wrong_project_platform_and_unmanaged_or_physical_target() {
        let (db, root, project, target, _guard) = materialization_fixture("materialize-scope");
        let path = target.to_string_lossy();
        let project_path = project.to_string_lossy();
        assert!(skill_materialization::preview_materialize_skill(&db, &path, "Codex", "").is_err());
        assert!(skill_materialization::preview_materialize_skill(
            &db,
            &path,
            "Claude Code",
            &project_path
        )
        .is_err());
        assert!(skill_materialization::preview_materialize_skill(
            &db,
            &root.join("library/writer").to_string_lossy(),
            "Codex",
            &project_path
        )
        .is_err());
        let other_project = root.join("other-project");
        fs::create_dir_all(other_project.join(".agents/skills")).unwrap();
        assert!(skill_materialization::preview_materialize_skill(
            &db,
            &path,
            "Codex",
            &other_project.to_string_lossy()
        )
        .is_err());
        cleanup_skill_metadata(&db, &target).unwrap();
        assert!(skill_materialization::preview_materialize_skill(
            &db,
            &path,
            "Codex",
            &project_path
        )
        .is_err());
        app_core::remove_path(&target).unwrap();
        fs::create_dir_all(&target).unwrap();
        assert!(skill_materialization::preview_materialize_skill(
            &db,
            &path,
            "Codex",
            &project_path
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn materialization_obeys_policy_changes_and_rejects_retargeted_links() {
        let (db, root, project, target, _guard) = materialization_fixture("materialize-policy");
        let path = target.to_string_lossy();
        let project_path = project.to_string_lossy();
        let preview =
            skill_materialization::preview_materialize_skill(&db, &path, "Codex", &project_path)
                .unwrap();
        save_install_policy(
            &db,
            InstallPolicyConfig {
                mode: "trusted-only".to_string(),
                ..Default::default()
            },
        )
        .unwrap();
        let blocked =
            skill_materialization::preview_materialize_skill(&db, &path, "Codex", &project_path)
                .unwrap();
        assert!(!blocked.can_apply);
        let result = skill_materialization::materialize_skill(
            &db,
            &path,
            "Codex",
            &project_path,
            Some(&preview.plan_token),
        );
        assert!(!result.success);
        assert!(fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
        save_install_policy(&db, InstallPolicyConfig::default()).unwrap();
        app_core::remove_path(&target).unwrap();
        deploy_library_skill(&root.join("writer"), &target).unwrap();
        assert!(skill_materialization::preview_materialize_skill(
            &db,
            &path,
            "Codex",
            &project_path
        )
        .is_err());
        assert!(fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn materialization_rejects_internal_symlinks_without_dropping_files() {
        let (db, root, project, target, _guard) =
            materialization_fixture("materialize-internal-link");
        let library = root.join("library/writer");
        std::os::unix::fs::symlink(root.join("writer/SKILL.md"), library.join("linked.txt"))
            .unwrap();
        let path = target.to_string_lossy();
        let project_path = project.to_string_lossy();
        let preview =
            skill_materialization::preview_materialize_skill(&db, &path, "Codex", &project_path)
                .unwrap();
        assert!(!preview.can_apply);
        assert!(preview.message.contains("内部链接"));
        let result = skill_materialization::materialize_skill(
            &db,
            &path,
            "Codex",
            &project_path,
            Some(&preview.plan_token),
        );
        assert!(!result.success);
        assert!(fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(fs::symlink_metadata(library.join("linked.txt"))
            .unwrap()
            .file_type()
            .is_symlink());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn manifest_apply_is_idempotent_for_managed_project_skill() {
        let db = test_db();
        let root = test_dir("manifest-idempotent");
        let _library_guard = skill_library::use_test_library_root(root.join("library"));
        let source = root.join("writer");
        let project = root.join("project");
        fs::create_dir_all(&source).unwrap();
        fs::write(
            source.join("SKILL.md"),
            "---\nname: writer\ndescription: 写作\n---\n",
        )
        .unwrap();
        let manifest = SkillMateManifest {
            version: 2,
            reconcile: false,
            skills: vec![SkillDescriptor {
                assistant: "Codex".to_string(),
                source: source.to_string_lossy().to_string(),
                source_kind: "local".to_string(),
                target_name: Some("writer".to_string()),
                scope: Some("project".to_string()),
                install_mode: Some("copy".to_string()),
                project_path: Some(project.to_string_lossy().to_string()),
                ..Default::default()
            }],
        };

        let first = apply_manifest(&db, &manifest).unwrap();
        let second = apply_manifest(&db, &manifest).unwrap();
        let target = project_skill_root_by_name("Codex", &project)
            .unwrap()
            .join("writer");
        assert!(fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
        db.execute(
            "INSERT INTO skill_tags (skill_path, tags, tags_json) VALUES (?, '', '[\"writing\"]')",
            params![target.to_string_lossy().to_string()],
        )
        .unwrap();
        let removed = apply_manifest(
            &db,
            &SkillMateManifest {
                version: 2,
                reconcile: true,
                skills: vec![],
            },
        )
        .unwrap();

        assert_eq!((first.installed, first.removed, first.kept), (1, 0, 0));
        assert_eq!((second.installed, second.removed, second.kept), (0, 0, 1));
        assert_eq!(
            (removed.installed, removed.removed, removed.kept),
            (0, 1, 0)
        );
        assert!(!target.exists());
        assert!(managed_state::read_managed_state(target.parent().unwrap())
            .unwrap()
            .managed_skills
            .is_empty());
        for table in ["managed_installations", "skill_origin_meta", "skill_tags"] {
            let count: i64 = db
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE skill_path = ?"),
                    params![target.to_string_lossy().to_string()],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 0, "{table} 未清理");
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn exported_manifest_with_content_hash_keeps_existing_deployment() {
        let db = test_db();
        let root = test_dir("manifest-export-idempotent");
        let _library_guard = skill_library::use_test_library_root(root.join("library"));
        let source = root.join("writer");
        let project = root.join("project");
        fs::create_dir_all(&source).unwrap();
        fs::write(
            source.join("SKILL.md"),
            "---\nname: writer\ndescription: 写作\n---\n",
        )
        .unwrap();
        let initial = SkillMateManifest {
            version: 2,
            reconcile: false,
            skills: vec![SkillDescriptor {
                assistant: "Codex".to_string(),
                source: source.to_string_lossy().to_string(),
                source_kind: "local".to_string(),
                target_name: Some("writer".to_string()),
                scope: Some("project".to_string()),
                install_mode: Some("copy".to_string()),
                project_path: Some(project.to_string_lossy().to_string()),
                ..Default::default()
            }],
        };
        apply_manifest(&db, &initial).unwrap();
        let exported = build_current_manifest(&db).unwrap();
        assert!(exported.skills[0].content_hash.is_some());

        let preview = preview_manifest(&db, &exported).unwrap();
        let reapplied = apply_manifest(&db, &exported).unwrap();

        assert_eq!(preview.actions.len(), 1);
        assert_eq!(preview.actions[0].kind, "keep");
        assert_eq!(
            (reapplied.installed, reapplied.removed, reapplied.kept),
            (0, 0, 1)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn manifest_reconcile_can_disable_deployment_after_library_content_changes() {
        let db = test_db();
        let root = test_dir("manifest-drift");
        let library_root = root.join("library");
        let _library_guard = skill_library::use_test_library_root(library_root.clone());
        let source = root.join("writer");
        let project = root.join("project");
        fs::create_dir_all(&source).unwrap();
        fs::write(
            source.join("SKILL.md"),
            "---\nname: writer\ndescription: 写作\n---\n",
        )
        .unwrap();
        let manifest = SkillMateManifest {
            version: 2,
            reconcile: false,
            skills: vec![SkillDescriptor {
                assistant: "Codex".to_string(),
                source: source.to_string_lossy().to_string(),
                source_kind: "local".to_string(),
                target_name: Some("writer".to_string()),
                scope: Some("project".to_string()),
                install_mode: Some("copy".to_string()),
                project_path: Some(project.to_string_lossy().to_string()),
                ..Default::default()
            }],
        };
        apply_manifest(&db, &manifest).unwrap();
        let target = project_skill_root_by_name("Codex", &project)
            .unwrap()
            .join("writer");
        fs::write(target.join("SKILL.md"), "user change").unwrap();
        let empty = SkillMateManifest {
            version: 2,
            reconcile: true,
            skills: vec![],
        };

        let preview = preview_manifest(&db, &empty).unwrap();
        let result = apply_manifest(&db, &empty).unwrap();
        let library_path = library_root.join("writer");

        assert!(preview.can_apply);
        assert_eq!(result.removed, 1);
        assert!(!target.exists());
        assert_eq!(
            fs::read_to_string(library_path.join("SKILL.md")).unwrap(),
            "user change"
        );
        assert!(find_managed_installation(&db, &target).unwrap().is_none());
        assert!(find_managed_installation(&db, &library_path)
            .unwrap()
            .is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn deployment_inventory_reports_changes_to_library_content() {
        let db = test_db();
        let root = test_dir("deployment-library-drift");
        let _library_guard = skill_library::use_test_library_root(root.join("library"));
        let source = root.join("writer");
        let project = root.join("project");
        fs::create_dir_all(&source).unwrap();
        fs::write(
            source.join("SKILL.md"),
            "---\nname: writer\ndescription: 写作\n---\n",
        )
        .unwrap();
        let manifest = SkillMateManifest {
            version: 2,
            reconcile: false,
            skills: vec![SkillDescriptor {
                assistant: "Codex".to_string(),
                source: source.to_string_lossy().to_string(),
                source_kind: "local".to_string(),
                target_name: Some("writer".to_string()),
                scope: Some("project".to_string()),
                install_mode: Some("copy".to_string()),
                project_path: Some(project.to_string_lossy().to_string()),
                ..Default::default()
            }],
        };
        apply_manifest(&db, &manifest).unwrap();
        let deployment_path = project_skill_root_by_name("Codex", &project)
            .unwrap()
            .join("writer");
        fs::write(
            deployment_path.join("SKILL.md"),
            "---\nname: writer\ndescription: 已修改\n---\n",
        )
        .unwrap();

        let assistants = scan_all_assistants(&db).unwrap();
        let skill = assistants
            .iter()
            .find(|assistant| assistant.name == "Codex")
            .and_then(|assistant| {
                assistant
                    .skills
                    .iter()
                    .find(|skill| skill.inventory.name == "writer")
            })
            .unwrap();

        assert!(skill
            .structure
            .structure_warnings
            .contains(&"managed_content_changed".to_string()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn adding_to_library_and_enabling_are_independent_operations() {
        let db = test_db();
        let root = test_dir("add-then-enable");
        let library_root = root.join("library");
        let _library_guard = skill_library::use_test_library_root(library_root.clone());
        let source = root.join("source/writer");
        let project = root.join("project");
        fs::create_dir_all(&source).unwrap();
        fs::write(
            source.join("SKILL.md"),
            "---\nname: writer\ndescription: 写作\n---\n",
        )
        .unwrap();
        let policy = InstallPolicyConfig::default();
        let source_value = source.to_string_lossy().to_string();

        let add_preview = build_install_request_preview(
            &db,
            InstallPreviewRequest {
                package: &source_value,
                source: "local",
                assistant_name: "",
                mode: "library",
                project_path: None,
                selected_skill_paths: None,
                preferred_skill_id: None,
            },
            Ok(&policy),
        );
        assert!(add_preview.can_apply, "{}", add_preview.message);
        assert!(add_preview
            .target_actions
            .iter()
            .all(|action| action.action != "symlink"));
        let add_result = install_skill_exclusive(
            &db,
            InstallSkillRequest {
                package: source_value,
                source: "local".to_string(),
                assistant_name: String::new(),
                install_mode: Some("library".to_string()),
                project_path: None,
                selected_skill_paths: None,
                preferred_skill_id: None,
                plan_token: Some(add_preview.plan_token),
            },
        );
        assert!(
            add_result.success,
            "{}: {}",
            add_result.message, add_result.output
        );

        let library_path = library_root.join("writer");
        let library_count: i64 = db
            .query_row("SELECT COUNT(*) FROM library_skills", [], |row| row.get(0))
            .unwrap();
        let deployment_count: i64 = db
            .query_row("SELECT COUNT(*) FROM skill_deployments", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(library_count, 1);
        assert_eq!(deployment_count, 0);
        assert!(library_path.join("SKILL.md").is_file());

        let library_value = library_path.to_string_lossy().to_string();
        let project_value = project.to_string_lossy().to_string();
        let enable_preview = build_install_request_preview(
            &db,
            InstallPreviewRequest {
                package: &library_value,
                source: "local",
                assistant_name: "Codex",
                mode: "symlink",
                project_path: Some(&project_value),
                selected_skill_paths: None,
                preferred_skill_id: None,
            },
            Ok(&policy),
        );
        assert!(enable_preview.can_apply, "{}", enable_preview.message);
        assert_eq!(
            enable_preview
                .target_actions
                .iter()
                .filter(|action| action.action == "symlink")
                .count(),
            1
        );
        let enable_result = install_skill_exclusive(
            &db,
            InstallSkillRequest {
                package: library_value,
                source: "local".to_string(),
                assistant_name: "Codex".to_string(),
                install_mode: Some("symlink".to_string()),
                project_path: Some(project_value),
                selected_skill_paths: None,
                preferred_skill_id: None,
                plan_token: Some(enable_preview.plan_token),
            },
        );
        assert!(
            enable_result.success,
            "{}: {}",
            enable_result.message, enable_result.output
        );

        let target = project_skill_root_by_name("Codex", &project)
            .unwrap()
            .join("writer");
        let library_count: i64 = db
            .query_row("SELECT COUNT(*) FROM library_skills", [], |row| row.get(0))
            .unwrap();
        let deployment_count: i64 = db
            .query_row("SELECT COUNT(*) FROM skill_deployments", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(library_count, 1);
        assert_eq!(deployment_count, 1);
        assert!(fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            fs::canonicalize(target).unwrap(),
            fs::canonicalize(library_path).unwrap()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn local_multi_skill_install_only_adds_selected_directories() {
        let db = test_db();
        let root = test_dir("local-selected-skills");
        let library_root = root.join("library");
        let _library_guard = skill_library::use_test_library_root(library_root.clone());
        let source = root.join("source");
        for name in ["reader", "writer"] {
            let skill = source.join(name);
            fs::create_dir_all(&skill).unwrap();
            fs::write(
                skill.join("SKILL.md"),
                format!("---\nname: {name}\ndescription: {name}\n---\n"),
            )
            .unwrap();
        }
        let policy = InstallPolicyConfig::default();
        let source_value = source.to_string_lossy().to_string();
        let unselected_preview = build_install_request_preview(
            &db,
            InstallPreviewRequest {
                package: &source_value,
                source: "local",
                assistant_name: "",
                mode: "library",
                project_path: None,
                selected_skill_paths: None,
                preferred_skill_id: None,
            },
            Ok(&policy),
        );
        assert!(unselected_preview.selection_required);
        assert!(!unselected_preview.can_apply);
        assert_eq!(unselected_preview.available_skills.len(), 2);
        let selected = vec!["writer".to_string()];
        let preview = build_install_request_preview(
            &db,
            InstallPreviewRequest {
                package: &source_value,
                source: "local",
                assistant_name: "",
                mode: "library",
                project_path: None,
                selected_skill_paths: Some(&selected),
                preferred_skill_id: None,
            },
            Ok(&policy),
        );

        assert!(preview.can_apply, "{}", preview.message);
        assert_eq!(preview.available_skills.len(), 2);
        assert_eq!(preview.target_actions.len(), 1);
        assert!(preview.target_actions[0].target.ends_with("writer"));
        let result = install_skill_exclusive(
            &db,
            InstallSkillRequest {
                package: source_value,
                source: "local".to_string(),
                assistant_name: String::new(),
                install_mode: Some("library".to_string()),
                project_path: None,
                selected_skill_paths: Some(selected),
                preferred_skill_id: None,
                plan_token: Some(preview.plan_token),
            },
        );

        assert!(result.success, "{}: {}", result.message, result.output);
        assert!(library_root.join("writer/SKILL.md").is_file());
        assert!(!library_root.join("reader").exists());
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM library_skills", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        let origin =
            skill_origin::load_origin_meta(&db, &library_root.join("writer").to_string_lossy())
                .unwrap()
                .unwrap();
        assert_eq!(origin.origin_kind, "local");
        assert_eq!(
            origin.origin_locator,
            source.join("writer").to_string_lossy()
        );
        assert!(origin.managed_by_app);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn library_scan_recovers_skill_after_deployment_disappears() {
        let db = test_db();
        let root = test_dir("library-scan-prune");
        let library_root = root.join("library");
        let deployment_root = root.join("deployments");
        let library_path = library_root.join("writer");
        let deployment_path = deployment_root.join("writer");
        let _library_guard = skill_library::use_test_library_root(library_root.clone());
        fs::create_dir_all(&library_path).unwrap();
        fs::write(
            library_path.join("SKILL.md"),
            "---\nname: writer\ndescription: 写作\n---\n",
        )
        .unwrap();
        managed_state::mark_managed_skill(
            &library_root,
            managed_state::LIBRARY_OWNER_NAME,
            &library_path,
            "local:/tmp/writer",
        )
        .unwrap();
        record_managed_path(&db, &library_root, &library_path, "library", None).unwrap();
        let skill_id =
            register_library_skill(&db, &library_path, "/tmp/writer", "local", None).unwrap();
        deploy_library_skill(&library_path, &deployment_path).unwrap();
        managed_state::mark_managed_skill(
            &deployment_root,
            "Codex",
            &deployment_path,
            &format!("symlink:{}", library_path.to_string_lossy()),
        )
        .unwrap();
        record_managed_path(&db, &deployment_root, &deployment_path, "global", None).unwrap();
        register_deployment(
            &db,
            &skill_id,
            &library_path,
            &deployment_path,
            "Codex",
            "global",
            None,
            "symlink",
        )
        .unwrap();
        app_core::remove_path(&deployment_path).unwrap();

        let skills = scan_unassigned_library_skills(&db).unwrap();

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].inventory.name, "writer");
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM skill_deployments", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn install_rollback_removes_files_state_and_database_metadata() {
        let db = test_db();
        let root = test_dir("install-rollback");
        fs::create_dir_all(&root).unwrap();
        let target = root.join("writer");
        let mut transaction =
            ReconcileTransaction::prepare_managed(&db, &[], std::slice::from_ref(&target)).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(
            target.join("SKILL.md"),
            "---\nname: writer\ndescription: 写作\n---\n",
        )
        .unwrap();
        managed_state::mark_managed_skill(&root, "Codex", &target, "local:/tmp/writer").unwrap();
        managed_installation::record_managed_root(&db, &root, "global", None).unwrap();
        db.execute(
            "INSERT INTO skill_origin_meta (skill_path, managed_by_app) VALUES (?, 1)",
            params![target.to_string_lossy().to_string()],
        )
        .unwrap();

        rollback_install_attempt(&mut transaction).unwrap();

        assert!(!target.exists());
        assert!(managed_state::read_managed_state(&root)
            .unwrap()
            .managed_skills
            .is_empty());
        assert!(find_managed_installation(&db, &target).unwrap().is_none());
        let origin_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM skill_origin_meta WHERE skill_path = ?",
                params![target.to_string_lossy().to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(origin_count, 0);
        let root_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM managed_roots WHERE root_path = ?",
                params![root.to_string_lossy().to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(root_count, 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn install_rollback_cleans_origin_written_before_sidecar() {
        let db = test_db();
        let root = test_dir("install-origin-before-sidecar");
        fs::create_dir_all(&root).unwrap();
        let target = root.join("writer");
        let mut transaction =
            ReconcileTransaction::prepare_managed(&db, &[], std::slice::from_ref(&target)).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("SKILL.md"), "writer").unwrap();
        db.execute(
            "INSERT INTO skill_origin_meta (skill_path, managed_by_app) VALUES (?, 1)",
            params![target.to_string_lossy().to_string()],
        )
        .unwrap();

        rollback_install_attempt(&mut transaction).unwrap();

        assert!(!target.exists());
        assert!(!root.join(managed_state::STATE_FILE_NAME).exists());
        let origin_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM skill_origin_meta WHERE skill_path = ?",
                params![target.to_string_lossy().to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(origin_count, 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn install_rollback_handles_registry_refresh_failure() {
        let db = test_db();
        let base = test_dir("install-refresh-failure");
        let library_root = base.join("library");
        let deployment_root = base.join("deployments");
        let library_path = library_root.join("writer");
        let deployment_path = deployment_root.join("writer");
        fs::create_dir_all(&base).unwrap();
        let mut transaction = ReconcileTransaction::prepare_managed(
            &db,
            &[],
            &[library_path.clone(), deployment_path.clone()],
        )
        .unwrap();
        fs::create_dir_all(&library_path).unwrap();
        fs::write(library_path.join("SKILL.md"), "writer").unwrap();
        managed_state::mark_managed_skill(
            &library_root,
            "SkillMate",
            &library_path,
            "local:/tmp/writer",
        )
        .unwrap();
        db.execute_batch(
            "CREATE TRIGGER discard_managed_insert
             AFTER INSERT ON managed_installations
             BEGIN
                 DELETE FROM managed_installations WHERE skill_path = NEW.skill_path;
             END;",
        )
        .unwrap();

        let error = finalize_library_install_registration(
            &db,
            "/tmp/writer",
            "local",
            "Codex",
            "global",
            None,
            &library_root,
            Some(&deployment_root),
            std::slice::from_ref(&library_path),
            std::slice::from_ref(&deployment_path),
            "",
            false,
        )
        .unwrap_err();
        rollback_install_attempt(&mut transaction).unwrap();

        assert!(error.contains("未能刷新启用记录"), "{error}");
        assert!(!library_path.exists());
        assert!(fs::symlink_metadata(&deployment_path).is_err());
        assert!(!deployment_root
            .join(managed_state::STATE_FILE_NAME)
            .exists());
        assert!(find_managed_installation(&db, &deployment_path)
            .unwrap()
            .is_none());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn managed_skill_path_rejects_root_and_parent_escape() {
        let base = test_dir("managed-path");
        let root = base.join("skills");
        let skill = root.join("skill-a");
        let outside = base.join("outside");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        assert!(app_core::is_managed_skill_path(
            &skill,
            std::slice::from_ref(&root)
        ));
        assert!(!app_core::is_managed_skill_path(
            &root,
            std::slice::from_ref(&root)
        ));
        assert!(!app_core::is_managed_skill_path(
            &root.join("..").join("outside"),
            std::slice::from_ref(&root)
        ));

        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn managed_link_entry_path_allows_external_symlink_target() {
        let base = test_dir("managed-link-path");
        let root = base.join("skills");
        let source = base
            .join("project")
            .join(".codex")
            .join("skills")
            .join("skill-a");
        let link = root.join("skill-a");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&source).unwrap();
        if !app_core::create_test_directory_symlink_or_skip(&source, &link) {
            std::fs::remove_dir_all(base).ok();
            return;
        }

        assert!(app_core::is_managed_link_entry_path(
            &link,
            std::slice::from_ref(&root)
        ));
        assert!(!app_core::is_managed_skill_path(
            &link,
            std::slice::from_ref(&root)
        ));
        assert!(!app_core::is_managed_link_entry_path(
            &root.join("..").join("outside-link"),
            std::slice::from_ref(&root)
        ));

        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn openable_managed_folder_allows_roots_and_children_only() {
        let base = test_dir("openable-managed-folder");
        let root = base.join("skills");
        let skill = root.join("skill-a");
        let outside = base.join("outside");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        assert!(is_openable_managed_folder_with_roots(
            &root,
            std::slice::from_ref(&root)
        ));
        assert!(is_openable_managed_folder_with_roots(
            &skill,
            std::slice::from_ref(&root)
        ));
        assert!(!is_openable_managed_folder_with_roots(
            &outside,
            std::slice::from_ref(&root)
        ));

        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn openable_registered_folder_allows_project_root_and_regular_skill() {
        let base = test_dir("openable-project-folder");
        let project_root = base.join("project").join(".codex").join("skills");
        let skill = project_root.join("skill-a");
        let outside = base.join("outside");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        assert!(is_openable_registered_folder(
            &project_root,
            std::slice::from_ref(&skill)
        ));
        assert!(is_openable_registered_folder(
            &skill,
            std::slice::from_ref(&skill)
        ));
        assert!(!is_openable_registered_folder(
            &outside,
            std::slice::from_ref(&skill)
        ));

        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn openable_registered_folder_does_not_follow_managed_symlink_target() {
        let base = test_dir("openable-project-link");
        let project_root = base.join("project").join(".codex").join("skills");
        let source = base.join("source");
        let link = project_root.join("skill-a");
        std::fs::create_dir_all(&project_root).unwrap();
        std::fs::create_dir_all(&source).unwrap();
        if !app_core::create_test_directory_symlink_or_skip(&source, &link) {
            std::fs::remove_dir_all(base).ok();
            return;
        }

        assert!(is_openable_registered_folder(
            &project_root,
            std::slice::from_ref(&link)
        ));
        assert!(!is_openable_registered_folder(
            &source,
            std::slice::from_ref(&link)
        ));

        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn build_library_export_flattens_skills() {
        let export = build_library_export(
            vec![Tag {
                id: "1".into(),
                name: "AI".into(),
                color: "#fff".into(),
            }],
            vec![Scenario {
                id: "s1".into(),
                name: "写作".into(),
                description: "desc".into(),
                skill_ids: vec!["/tmp/a".into()],
                created_at: "2026-04-20".into(),
            }],
            vec![AIAssistant {
                name: "Codex".into(),
                path: "/Users/demo/.agents/skills".into(),
                paths: vec!["/Users/demo/.agents/skills".into()],
                ai_type: "skill".into(),
                icon: "codex".into(),
                exists: true,
                supports_project_skills: true,
                diagnostics: vec![],
                skills: vec![Skill {
                    inventory: SkillInventoryFields {
                        id: "/tmp/a".into(),
                        name: "skill-a".into(),
                        path: "/tmp/a".into(),
                        skill_type: "skill-folder".into(),
                        source: "GitHub".into(),
                        source_type: "deployment".into(),
                        content_source: "github".into(),
                        manager: "skillmate".into(),
                        update_strategy: "skillmate".into(),
                        size: "1 KB".into(),
                        modified: "".into(),
                        tags: vec!["1".into()],
                        description: "".into(),
                        readme: "".into(),
                        version: "1.0.0".into(),
                        content_hash: "sha256:test".into(),
                    },
                    origin: SkillOriginFields {
                        upstream_url: "".into(),
                        has_update: false,
                        origin_kind: "git".into(),
                        origin_locator: "".into(),
                        resolved_locator: "".into(),
                        tracking_ref: "".into(),
                        installed_ref: "".into(),
                        latest_ref: "".into(),
                        sync_state: "current".into(),
                        sync_message: "".into(),
                        lag_count: 0,
                        last_probe_at: None,
                        last_sync_at: None,
                        managed_by_app: false,
                        can_check: true,
                        can_sync: false,
                        symlink_source: Some("/tmp/skillmate/skills/skill-a".into()),
                    },
                    structure: SkillStructureFields {
                        structure_status: "complete".into(),
                        structure_features: vec!["skill_md".into()],
                        structure_warnings: vec![],
                        manifest_title: Some("skill-a".into()),
                        manifest_description: Some("desc".into()),
                    },
                }],
            }],
            vec![],
        );

        assert_eq!(export.version, 1);
        assert_eq!(export.tags.len(), 1);
        assert_eq!(export.scenarios.len(), 1);
        assert_eq!(export.skills.len(), 1);
        assert_eq!(export.skills[0].assistant, "Codex");
        assert_eq!(export.skills[0].path, "/tmp/skillmate/skills/skill-a");
    }

    #[test]
    fn current_manifest_exports_deployment_source_without_internal_library_record() {
        let db = test_db();
        let root = test_dir("library-manifest");
        let source = root.join("source");
        let library_root = root.join("library");
        let deployment_root = root.join("deployments");
        let library_path = library_root.join("writer");
        let deployment_path = deployment_root.join("writer");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&library_path).unwrap();
        fs::write(
            library_path.join("SKILL.md"),
            "---\nname: writer\ndescription: 写作\n---\n",
        )
        .unwrap();
        deploy_library_skill(&library_path, &deployment_path).unwrap();
        managed_state::mark_managed_skill(
            &library_root,
            managed_state::LIBRARY_OWNER_NAME,
            &library_path,
            &format!("local:{}", source.to_string_lossy()),
        )
        .unwrap();
        record_managed_path(&db, &library_root, &library_path, "library", None).unwrap();
        let skill_id =
            register_library_skill(&db, &library_path, &source.to_string_lossy(), "local", None)
                .unwrap();
        managed_state::mark_managed_skill(
            &deployment_root,
            "Codex",
            &deployment_path,
            &format!("symlink:{}", library_path.to_string_lossy()),
        )
        .unwrap();
        record_managed_path(&db, &deployment_root, &deployment_path, "global", None).unwrap();
        register_deployment(
            &db,
            &skill_id,
            &library_path,
            &deployment_path,
            "Codex",
            "global",
            None,
            "symlink",
        )
        .unwrap();

        let manifest = build_current_manifest(&db).unwrap();

        assert_eq!(manifest.skills.len(), 1);
        assert_eq!(manifest.skills[0].assistant, "Codex");
        assert_eq!(manifest.skills[0].source, source.to_string_lossy());
        assert_eq!(manifest.skills[0].install_mode.as_deref(), Some("copy"));
        assert_eq!(
            manifest.skills[0].content_hash,
            Some(managed_state::content_fingerprint(&library_path).unwrap())
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn merge_imported_library_upserts_tags_and_scenarios() {
        let db = test_db();
        let (tag_count, scenario_count) = merge_imported_library(
            &db,
            LibraryExport {
                version: 1,
                exported_at: "2026-04-20T00:00:00Z".into(),
                tags: vec![Tag {
                    id: "1".into(),
                    name: "AI".into(),
                    color: "#fff".into(),
                }],
                scenarios: vec![Scenario {
                    id: "s1".into(),
                    name: "写作".into(),
                    description: "desc".into(),
                    skill_ids: vec!["/tmp/a".into(), "/tmp/b".into()],
                    created_at: "2026-04-20".into(),
                }],
                skills: vec![],
            },
            false,
        )
        .unwrap();

        assert_eq!(tag_count, 1);
        assert_eq!(scenario_count, 1);

        let tag_name: String = db
            .query_row("SELECT name FROM tags WHERE id = '1'", [], |row| row.get(0))
            .unwrap();
        let skill_ids_json: String = db
            .query_row(
                "SELECT skill_ids_json FROM scenarios WHERE id = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tag_name, "AI");
        assert_eq!(
            serde_json::from_str::<Vec<String>>(&skill_ids_json).unwrap(),
            vec!["/tmp/a", "/tmp/b"]
        );
    }

    #[test]
    fn merge_imported_library_restores_skill_tag_mapping() {
        let db = test_db();
        let expected_path =
            database::database_path_key(&db, database::PathColumn::SkillTags, Path::new("/tmp/a"))
                .unwrap();
        merge_imported_library(
            &db,
            LibraryExport {
                version: 1,
                exported_at: "2026-04-20T00:00:00Z".into(),
                tags: vec![],
                scenarios: vec![],
                skills: vec![LibrarySkillRecord {
                    name: "skill-a".into(),
                    path: "/tmp/a".into(),
                    assistant: "Codex".into(),
                    source_type: "git".into(),
                    tags: vec!["1".into(), "2".into()],
                }],
            },
            false,
        )
        .unwrap();

        let stored_tags_json: String = db
            .query_row(
                "SELECT tags_json FROM skill_tags WHERE skill_path = ?",
                [expected_path],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Vec<String>>(&stored_tags_json).unwrap(),
            vec!["1", "2"]
        );
    }

    #[test]
    fn replace_import_clears_existing_records_before_restore() {
        let db = test_db();
        let expected_path = database::database_path_key(
            &db,
            database::PathColumn::SkillTags,
            Path::new("/tmp/new"),
        )
        .unwrap();
        db.execute(
            "INSERT INTO tags (id, name, color) VALUES ('old-tag', '旧标签', '#000')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO scenarios (id, name, description, skill_ids, created_at) VALUES ('old-scenario', '旧场景', '', '/tmp/old', '2026-04-19')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO skill_tags (skill_path, tags) VALUES ('/tmp/old', 'old-tag')",
            [],
        )
        .unwrap();

        merge_imported_library(
            &db,
            LibraryExport {
                version: 1,
                exported_at: "2026-04-20T00:00:00Z".into(),
                tags: vec![Tag {
                    id: "new-tag".into(),
                    name: "新标签".into(),
                    color: "#fff".into(),
                }],
                scenarios: vec![Scenario {
                    id: "new-scenario".into(),
                    name: "新场景".into(),
                    description: "".into(),
                    skill_ids: vec!["/tmp/new".into()],
                    created_at: "2026-04-20".into(),
                }],
                skills: vec![LibrarySkillRecord {
                    name: "skill-new".into(),
                    path: "/tmp/new".into(),
                    assistant: "Codex".into(),
                    source_type: "git".into(),
                    tags: vec!["new-tag".into()],
                }],
            },
            true,
        )
        .unwrap();

        let tag_count: i64 = db
            .query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0))
            .unwrap();
        let scenario_count: i64 = db
            .query_row("SELECT COUNT(*) FROM scenarios", [], |row| row.get(0))
            .unwrap();
        let skill_tag_count: i64 = db
            .query_row("SELECT COUNT(*) FROM skill_tags", [], |row| row.get(0))
            .unwrap();
        let restored_tags_json: String = db
            .query_row(
                "SELECT tags_json FROM skill_tags WHERE skill_path = ?",
                [expected_path],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(tag_count, 1);
        assert_eq!(scenario_count, 1);
        assert_eq!(skill_tag_count, 1);
        assert_eq!(
            serde_json::from_str::<Vec<String>>(&restored_tags_json).unwrap(),
            vec!["new-tag"]
        );
    }

    #[test]
    fn preview_import_library_counts_merge_changes() {
        let db = test_db();
        db.execute(
            "INSERT INTO tags (id, name, color) VALUES ('shared-tag', '共享标签', '#000')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO scenarios (id, name, description, skill_ids, created_at) VALUES ('shared-scenario', '共享场景', '', '/tmp/existing', '2026-04-20')",
            [],
        )
        .unwrap();

        let preview = preview_imported_library(
            &db,
            &LibraryExport {
                version: 1,
                exported_at: "2026-04-21T00:00:00Z".into(),
                tags: vec![
                    Tag {
                        id: "shared-tag".into(),
                        name: "共享标签".into(),
                        color: "#fff".into(),
                    },
                    Tag {
                        id: "new-tag".into(),
                        name: "新标签".into(),
                        color: "#123".into(),
                    },
                ],
                scenarios: vec![
                    Scenario {
                        id: "shared-scenario".into(),
                        name: "共享场景".into(),
                        description: "".into(),
                        skill_ids: vec!["/tmp/existing".into()],
                        created_at: "2026-04-21".into(),
                    },
                    Scenario {
                        id: "new-scenario".into(),
                        name: "新场景".into(),
                        description: "".into(),
                        skill_ids: vec!["/tmp/new".into()],
                        created_at: "2026-04-21".into(),
                    },
                ],
                skills: vec![
                    LibrarySkillRecord {
                        name: "skill-a".into(),
                        path: "/tmp/existing".into(),
                        assistant: "Codex".into(),
                        source_type: "git".into(),
                        tags: vec!["shared-tag".into()],
                    },
                    LibrarySkillRecord {
                        name: "skill-b".into(),
                        path: "/tmp/new".into(),
                        assistant: "Codex".into(),
                        source_type: "local".into(),
                        tags: vec!["new-tag".into()],
                    },
                    LibrarySkillRecord {
                        name: "skill-c".into(),
                        path: "/tmp/untagged".into(),
                        assistant: "Codex".into(),
                        source_type: "local".into(),
                        tags: vec![],
                    },
                ],
            },
            false,
        )
        .unwrap();

        assert!(!preview.replace_existing);
        assert_eq!(preview.tags_to_add, 1);
        assert_eq!(preview.tags_to_replace, 1);
        assert_eq!(preview.scenarios_to_add, 1);
        assert_eq!(preview.scenarios_to_replace, 1);
        assert_eq!(preview.skill_tag_writes, 2);
        assert_eq!(preview.existing_tags_to_remove, 0);
        assert_eq!(preview.existing_scenarios_to_remove, 0);
        assert_eq!(preview.existing_skill_tag_mappings_to_remove, 0);
    }

    #[test]
    fn preview_import_library_counts_replace_cleanup() {
        let db = test_db();
        db.execute(
            "INSERT INTO tags (id, name, color) VALUES ('shared-tag', '共享标签', '#000')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO tags (id, name, color) VALUES ('old-tag', '旧标签', '#111')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO scenarios (id, name, description, skill_ids, created_at) VALUES ('shared-scenario', '共享场景', '', '/tmp/existing', '2026-04-20')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO scenarios (id, name, description, skill_ids, created_at) VALUES ('old-scenario', '旧场景', '', '/tmp/old', '2026-04-20')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO skill_tags (skill_path, tags) VALUES ('/tmp/existing', 'shared-tag')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO skill_tags (skill_path, tags) VALUES ('/tmp/old', 'old-tag')",
            [],
        )
        .unwrap();

        let preview = preview_imported_library(
            &db,
            &LibraryExport {
                version: 1,
                exported_at: "2026-04-21T00:00:00Z".into(),
                tags: vec![
                    Tag {
                        id: "shared-tag".into(),
                        name: "共享标签".into(),
                        color: "#fff".into(),
                    },
                    Tag {
                        id: "new-tag".into(),
                        name: "新标签".into(),
                        color: "#123".into(),
                    },
                ],
                scenarios: vec![
                    Scenario {
                        id: "shared-scenario".into(),
                        name: "共享场景".into(),
                        description: "".into(),
                        skill_ids: vec!["/tmp/existing".into()],
                        created_at: "2026-04-21".into(),
                    },
                    Scenario {
                        id: "new-scenario".into(),
                        name: "新场景".into(),
                        description: "".into(),
                        skill_ids: vec!["/tmp/new".into()],
                        created_at: "2026-04-21".into(),
                    },
                ],
                skills: vec![LibrarySkillRecord {
                    name: "skill-a".into(),
                    path: "/tmp/new".into(),
                    assistant: "Codex".into(),
                    source_type: "git".into(),
                    tags: vec!["new-tag".into()],
                }],
            },
            true,
        )
        .unwrap();

        assert!(preview.replace_existing);
        assert_eq!(preview.tags_to_add, 1);
        assert_eq!(preview.tags_to_replace, 1);
        assert_eq!(preview.scenarios_to_add, 1);
        assert_eq!(preview.scenarios_to_replace, 1);
        assert_eq!(preview.skill_tag_writes, 1);
        assert_eq!(preview.existing_tags_to_remove, 2);
        assert_eq!(preview.existing_scenarios_to_remove, 2);
        assert_eq!(preview.existing_skill_tag_mappings_to_remove, 2);
    }

    #[test]
    fn scenario_manifest_preview_reports_changes_and_missing_refs() {
        let db = test_db();
        db.execute(
            "INSERT INTO scenarios (id, name, description, skill_ids, created_at) VALUES ('shared', '旧场景', '', '/tmp/known', '2026-04-20')",
            [],
        )
        .unwrap();
        let manifest = ScenarioManifest {
            version: 1,
            exported_at: "2026-04-21T00:00:00Z".into(),
            scenarios: vec![
                Scenario {
                    id: "shared".into(),
                    name: "共享场景".into(),
                    description: "".into(),
                    skill_ids: vec!["/tmp/known".into()],
                    created_at: "2026-04-21".into(),
                },
                Scenario {
                    id: "new".into(),
                    name: "新场景".into(),
                    description: "".into(),
                    skill_ids: vec!["/tmp/missing".into()],
                    created_at: "2026-04-21".into(),
                },
            ],
        };

        let preview =
            preview_scenario_manifest(&db, &manifest, false, &["/tmp/known".into()]).unwrap();

        assert!(!preview.replace_existing);
        assert_eq!(preview.scenarios_to_add, 1);
        assert_eq!(preview.scenarios_to_replace, 1);
        assert_eq!(preview.existing_scenarios_to_remove, 0);
        assert_eq!(preview.missing_skill_refs, vec!["/tmp/missing".to_string()]);
    }

    #[test]
    fn replace_scenario_manifest_clears_existing_scenarios_only() {
        let db = test_db();
        db.execute(
            "INSERT INTO scenarios (id, name, description, skill_ids, created_at) VALUES ('old', '旧场景', '', '/tmp/old', '2026-04-20')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO tags (id, name, color) VALUES ('keep-tag', '保留标签', '#fff')",
            [],
        )
        .unwrap();
        let manifest = ScenarioManifest {
            version: 1,
            exported_at: "2026-04-21T00:00:00Z".into(),
            scenarios: vec![Scenario {
                id: "new".into(),
                name: "新场景".into(),
                description: "desc".into(),
                skill_ids: vec!["/tmp/new".into()],
                created_at: "2026-04-21".into(),
            }],
        };

        let count = merge_scenario_manifest(&db, manifest, true).unwrap();

        assert_eq!(count, 1);
        let scenario_count: i64 = db
            .query_row("SELECT COUNT(*) FROM scenarios", [], |row| row.get(0))
            .unwrap();
        let tag_count: i64 = db
            .query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(scenario_count, 1);
        assert_eq!(tag_count, 1);
    }

    #[test]
    fn scenario_json_roundtrip_preserves_paths_with_commas() {
        let db = test_db();
        let paths = vec!["/tmp/project,one/skill".to_string(), "/tmp/two".to_string()];
        let paths_json = serde_json::to_string(&paths).unwrap();
        db.execute(
            "INSERT INTO scenarios (id, name, description, skill_ids, skill_ids_json, created_at)
             VALUES ('comma-path', '逗号路径', '', '', ?, '2026-07-12')",
            params![paths_json],
        )
        .unwrap();

        let scenarios = get_scenarios_from_db(&db).unwrap();

        assert_eq!(scenarios[0].skill_ids, paths);
    }

    #[test]
    fn scenario_reader_reports_corrupted_json_state() {
        let db = test_db();
        db.execute(
            "INSERT INTO scenarios (id, name, description, skill_ids, skill_ids_json, created_at)
             VALUES ('broken', '损坏场景', '', '', 'not-json', '2026-07-12')",
            [],
        )
        .unwrap();

        let error = get_scenarios_from_db(&db).unwrap_err();

        assert!(error.contains("场景 broken 的 skill_ids_json 损坏"));
    }

    #[test]
    fn library_reuse_only_accepts_the_registered_library_directory() {
        let root = test_dir("library-reuse-preview");
        let existing = root.join("writer");
        let unregistered = root.join("stray");
        let missing = root.join("missing");
        fs::create_dir_all(&existing).unwrap();
        fs::create_dir_all(&unregistered).unwrap();
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE library_skills (
                id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, library_path TEXT NOT NULL UNIQUE,
                source TEXT NOT NULL, source_kind TEXT NOT NULL, resolved_ref TEXT,
                content_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
             );",
        )
        .unwrap();
        let existing_key =
            database::database_path_key(&db, database::PathColumn::LibrarySkill, &existing)
                .unwrap();
        db.execute(
            "INSERT INTO library_skills VALUES ('skill-1', 'writer', ?, 'local', 'local', NULL,
             'hash', 'now', 'now')",
            [&existing_key],
        )
        .unwrap();
        let reason = "Target directory already exists";
        let mut preview = install_preview_error(
            reason,
            "local".to_string(),
            existing.to_string_lossy().to_string(),
        );
        for (source, target) in [
            (&existing, &existing),
            (&unregistered, &unregistered),
            (&missing, &missing),
        ] {
            preview.target_actions.push(skill_install::PreviewAction {
                action: "skip".to_string(),
                source: source.to_string_lossy().to_string(),
                target: target.to_string_lossy().to_string(),
                reason: reason.to_string(),
            });
            preview.conflicts.push(skill_install::PreviewConflict {
                target: target.to_string_lossy().to_string(),
                reason: "target_exists".to_string(),
            });
        }
        preview.package_detection.warnings = vec!["target_exists".to_string()];

        // 中文提示本身不能授权复用，必须存在对应目标的稳定冲突码。
        let mut unrelated = preview.clone();
        unrelated.target_actions[0].reason = "目标目录已存在".to_string();
        unrelated.conflicts[0].reason = "unsafe_paths".to_string();
        assert_eq!(
            reuse_library_preview(&db, unrelated).target_actions[0].action,
            "skip"
        );

        let preview = reuse_library_preview(&db, preview);

        assert_eq!(preview.target_actions[0].action, "keep");
        // 在库根下但未登记的目录不能复用，否则预览承诺成功、应用阶段必然回滚。
        assert_eq!(preview.target_actions[1].action, "skip");
        assert_eq!(preview.target_actions[2].action, "skip");
        assert_eq!(preview.conflicts.len(), 2);
        assert_eq!(preview.conflicts[0].target, unregistered.to_string_lossy());
        assert_eq!(preview.conflicts[1].target, missing.to_string_lossy());
        assert!(!preview.can_apply);
        assert!(preview
            .package_detection
            .warnings
            .contains(&"target_exists".to_string()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn alternate_discovery_target_ignores_primary_path_and_reports_existing_alias() {
        let root = test_dir("alternate-discovery-target");
        let primary = root.join("primary/writer");
        let alternate = root.join("alternate/writer");
        fs::create_dir_all(&primary).unwrap();
        fs::create_dir_all(&alternate).unwrap();

        let found = skill_library::find_existing_alternate_target(
            &primary,
            &[
                primary.clone(),
                alternate.clone(),
                root.join("missing/writer"),
            ],
        );

        assert_eq!(found.as_deref(), Some(alternate.as_path()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn install_plan_token_changes_when_policy_changes() {
        let target =
            std::env::temp_dir().join(format!("skillmate-policy-target-{}", generate_id()));
        let mut off_preview = install_preview_error(
            "测试预览",
            "local".to_string(),
            target.to_string_lossy().to_string(),
        );
        off_preview.structure_status = "complete".to_string();
        let mut strict_preview = off_preview.clone();
        let off = InstallPolicyConfig::default();
        let strict = InstallPolicyConfig {
            mode: install_policy::INSTALL_POLICY_TRUSTED_ONLY.to_string(),
            ..InstallPolicyConfig::default()
        };

        apply_policy_to_preview(&mut off_preview, "/tmp/source", "local", Ok(&off));
        apply_policy_to_preview(&mut strict_preview, "/tmp/source", "local", Ok(&strict));
        let off_preview = seal_install_preview(off_preview, "/tmp/source", "Codex", "copy", None);
        let strict_preview =
            seal_install_preview(strict_preview, "/tmp/source", "Codex", "copy", None);

        assert!(off_preview.install_policy.allowed);
        assert!(!strict_preview.install_policy.allowed);
        assert_ne!(off_preview.plan_token, strict_preview.plan_token);
    }
}