use crate::app_core::generate_id;
use crate::database::{database_path_key, parse_legacy_list, PathColumn};
use crate::skill_library::resolve_library_path;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Scenario {
    pub id: String,
    pub name: String,
    pub description: String,
    pub skill_ids: Vec<String>,
    pub created_at: String,
}

pub fn get_all_tags_from_db(db: &Connection) -> Result<Vec<Tag>, String> {
    let mut statement = db
        .prepare("SELECT id, name, color FROM tags")
        .map_err(|error| error.to_string())?;
    let tags = statement
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(tags)
}

pub fn update_tag_in_db(db: &Connection, tag_id: &str, name: &str, color: &str) -> Result<Tag, String> {
    let changed = db
        .execute(
            "UPDATE tags SET name = ?, color = ? WHERE id = ?",
            params![name, color, tag_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("标签不存在".to_string());
    }
    Ok(Tag {
        id: tag_id.to_string(),
        name: name.to_string(),
        color: color.to_string(),
    })
}

pub fn delete_tag_in_db(db: &Connection, tag_id: &str) -> Result<String, String> {
    let transaction = db
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let assignments = {
        let mut statement = transaction
            .prepare("SELECT skill_path, COALESCE(tags, ''), tags_json FROM skill_tags")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows
    };

    for (skill_path, legacy_tags, tags_json) in assignments {
        let mut tag_ids = serde_json::from_str::<Vec<String>>(&tags_json)
            .map_err(|error| format!("Skill {} 的 tags_json 损坏: {}", skill_path, error))?;
        if !tag_ids.iter().any(|id| id == tag_id)
            && !parse_legacy_list(&legacy_tags)
                .iter()
                .any(|id| id == tag_id)
        {
            continue;
        }
        tag_ids.retain(|id| id != tag_id);
        let mut legacy_tag_ids = parse_legacy_list(&legacy_tags);
        legacy_tag_ids.retain(|id| id != tag_id);
        transaction
            .execute(
                "UPDATE skill_tags SET tags = ?, tags_json = ? WHERE skill_path = ?",
                params![
                    legacy_tag_ids.join(","),
                    serde_json::to_string(&tag_ids).map_err(|error| error.to_string())?,
                    skill_path
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    let changed = transaction
        .execute("DELETE FROM tags WHERE id = ?", params![tag_id])
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("标签不存在".to_string());
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok("已删除".to_string())
}

pub fn update_skill_tags_in_db(
    db: &Connection,
    skill_path: &Path,
    tags: &[String],
) -> Result<String, String> {
    let metadata_path = resolve_library_path(db, skill_path)?;
    let metadata_key = database_path_key(db, PathColumn::SkillTags, &metadata_path)?;
    let tags_json = serde_json::to_string(tags).map_err(|error| error.to_string())?;
    db.execute(
        "INSERT INTO skill_tags (skill_path, tags, tags_json) VALUES (?, '', ?)
         ON CONFLICT(skill_path) DO UPDATE SET tags = '', tags_json = excluded.tags_json",
        params![metadata_key, tags_json],
    )
    .map_err(|error| error.to_string())?;
    Ok("已更新".to_string())
}

pub fn get_scenarios_from_db(db: &Connection) -> Result<Vec<Scenario>, String> {
    let mut statement = db
        .prepare("SELECT id, name, COALESCE(description, ''), skill_ids_json, COALESCE(skill_ids, ''), COALESCE(created_at, '') FROM scenarios")
        .map_err(|error| error.to_string())?;
    let records = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    records
        .into_iter()
        .map(
            |(id, name, description, skill_ids_json, legacy_skill_ids, created_at)| {
                let mut skill_ids = serde_json::from_str::<Vec<String>>(&skill_ids_json)
                    .map_err(|error| format!("场景 {} 的 skill_ids_json 损坏: {}", id, error))?;
                if skill_ids.is_empty() && !legacy_skill_ids.is_empty() {
                    skill_ids = parse_legacy_list(&legacy_skill_ids);
                }
                Ok(Scenario {
                    id,
                    name,
                    description,
                    skill_ids,
                    created_at,
                })
            },
        )
        .collect()
}

pub fn add_tag_in_db(db: &Connection, name: &str, color: &str) -> Result<Tag, String> {
    let id = generate_id();
    db.execute(
        "INSERT INTO tags (id, name, color) VALUES (?, ?, ?)",
        params![id, name, color],
    )
    .map_err(|error| error.to_string())?;
    Ok(Tag {
        id,
        name: name.to_string(),
        color: color.to_string(),
    })
}

pub fn create_scenario_in_db(
    db: &Connection,
    name: &str,
    description: &str,
    skill_ids: &[String],
) -> Result<Scenario, String> {
    let id = generate_id();
    let created_at = chrono::Local::now().format("%Y-%m-%d").to_string();
    let skill_ids_json =
        serde_json::to_string(skill_ids).map_err(|error| error.to_string())?;
    db.execute("INSERT INTO scenarios (id, name, description, skill_ids, skill_ids_json, created_at) VALUES (?, ?, ?, '', ?, ?)", params![id, name, description, skill_ids_json, created_at]).map_err(|error| error.to_string())?;
    Ok(Scenario {
        id,
        name: name.to_string(),
        description: description.to_string(),
        skill_ids: skill_ids.to_vec(),
        created_at,
    })
}

pub fn delete_scenario_in_db(db: &Connection, scenario_id: &str) -> Result<String, String> {
    db.execute("DELETE FROM scenarios WHERE id = ?", params![scenario_id])
        .map_err(|error| error.to_string())?;
    Ok("已删除".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deployment_tags_are_stored_on_the_library_copy() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE skill_tags (
                skill_path TEXT PRIMARY KEY, tags TEXT, tags_json TEXT NOT NULL DEFAULT '[]'
             );
             CREATE TABLE skill_deployments (
                target_path TEXT PRIMARY KEY, skill_id TEXT NOT NULL, library_path TEXT NOT NULL,
                assistant TEXT NOT NULL, scope TEXT NOT NULL, project_path TEXT,
                deploy_mode TEXT NOT NULL, deployed_at TEXT NOT NULL
             );",
        )
        .unwrap();
        let library_path = Path::new("/tmp/skillmate/skills/writer");
        let deployment_path = Path::new("/tmp/.agents/skills/writer");
        let expected_path = database_path_key(&db, PathColumn::SkillTags, library_path).unwrap();
        db.execute(
            "INSERT INTO skill_deployments VALUES (?, 'writer-id', ?, 'Codex', 'global', NULL,
             'symlink', 'now')",
            params![
                deployment_path.to_string_lossy().to_string(),
                library_path.to_string_lossy().to_string()
            ],
        )
        .unwrap();

        update_skill_tags_in_db(&db, deployment_path, &["writing".to_string()]).unwrap();

        let stored_path = db
            .query_row("SELECT skill_path FROM skill_tags", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap();
        assert_eq!(stored_path, expected_path);
    }

    #[test]
    fn update_tag_changes_name_and_color() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL);
             INSERT INTO tags VALUES ('tag-one', '旧名称', '#111111');",
        )
        .unwrap();

        let tag = update_tag_in_db(&db, "tag-one", "新名称", "#abcdef").unwrap();

        assert_eq!(tag.name, "新名称");
        assert_eq!(tag.color, "#abcdef");
        let stored = db
            .query_row(
                "SELECT name, color FROM tags WHERE id = 'tag-one'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .unwrap();
        assert_eq!(stored, ("新名称".to_string(), "#abcdef".to_string()));
    }

    #[test]
    fn delete_tag_removes_skill_assignments() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL);
             CREATE TABLE skill_tags (
                skill_path TEXT PRIMARY KEY, tags TEXT, tags_json TEXT NOT NULL DEFAULT '[]'
             );
             INSERT INTO tags VALUES ('tag-one', '待删除', '#111111');
             INSERT INTO tags VALUES ('tag-two', '保留', '#222222');
             INSERT INTO skill_tags VALUES ('/tmp/a', 'tag-one,tag-two', '[\"tag-one\",\"tag-two\"]');
             INSERT INTO skill_tags VALUES ('/tmp/b', 'tag-two', '[\"tag-two\"]');",
        )
        .unwrap();

        delete_tag_in_db(&db, "tag-one").unwrap();

        let tag_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM tags WHERE id = 'tag-one'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tag_count, 0);
        let assignment = db
            .query_row(
                "SELECT tags, tags_json FROM skill_tags WHERE skill_path = '/tmp/a'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .unwrap();
        assert_eq!(
            assignment,
            ("tag-two".to_string(), "[\"tag-two\"]".to_string())
        );
        let untouched: String = db
            .query_row(
                "SELECT tags_json FROM skill_tags WHERE skill_path = '/tmp/b'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(untouched, "[\"tag-two\"]");
    }
}
