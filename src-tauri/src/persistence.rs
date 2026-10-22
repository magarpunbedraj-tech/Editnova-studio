use crate::model::Project;
use std::{io::Write, path::Path};
pub fn atomic_save(path: &Path, p: &Project) -> Result<(), String> {
    p.validate()?;
    let parent = path.parent().ok_or("Invalid save path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(p).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn load(path: &Path) -> Result<Project, String> {
    if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > 10_000_000 {
        return Err("Project exceeds 10 MB safety limit".into());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let mut p: Project = serde_json::from_slice(&bytes)
        .map_err(|e| format!("This is not a readable EditNova project: {e}"))?;
    p.migrate();
    p.validate()?;
    Ok(p)
}

pub const MAX_RECENT: usize = 12;

/// Reads the recent-project list. A missing or damaged list is treated as empty.
pub fn load_recent(list: &Path) -> Vec<String> {
    std::fs::read(list)
        .ok()
        .and_then(|b| serde_json::from_slice::<Vec<String>>(&b).ok())
        .unwrap_or_default()
        .into_iter()
        .take(MAX_RECENT)
        .collect()
}

/// Moves `entry` to the front of the recent list and writes it atomically.
pub fn push_recent(list: &Path, entry: &str) -> Result<Vec<String>, String> {
    let mut items = load_recent(list);
    items.retain(|x| x != entry);
    items.insert(0, entry.to_string());
    items.truncate(MAX_RECENT);
    write_recent(list, &items)?;
    Ok(items)
}

pub fn remove_recent(list: &Path, entry: &str) -> Result<Vec<String>, String> {
    let mut items = load_recent(list);
    items.retain(|x| x != entry);
    write_recent(list, &items)?;
    Ok(items)
}

fn write_recent(list: &Path, items: &[String]) -> Result<(), String> {
    let parent = list.parent().ok_or("Invalid settings path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(items).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.persist(list).map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn project() -> Project {
        Project {
            version: crate::model::CURRENT_VERSION,
            name: "कथा".into(),
            width: 1920,
            height: 1080,
            fps: 30,
            media: vec![],
            clips: vec![],
        }
    }
    #[test]
    fn recovery_roundtrip_and_replace() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("recovery.novaproject");
        atomic_save(&f, &project()).unwrap();
        assert_eq!(load(&f).unwrap().name, "कथा");
        let mut p = project();
        p.name = "Revised".into();
        atomic_save(&f, &p).unwrap();
        assert_eq!(load(&f).unwrap().name, "Revised");
    }
    #[test]
    fn invalid_save_preserves_previous_file() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("project.novaproject");
        atomic_save(&f, &project()).unwrap();
        let mut p = project();
        p.version = 99;
        assert!(atomic_save(&f, &p).is_err());
        assert_eq!(load(&f).unwrap().name, "कथा");
    }
    #[test]
    fn corrupt_and_oversized_projects_rejected() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("corrupt.novaproject");
        std::fs::write(&f, b"{ incomplete").unwrap();
        assert!(load(&f).is_err());
        let out = std::fs::File::create(&f).unwrap();
        out.set_len(10_000_001).unwrap();
        assert!(load(&f).is_err());
    }
    #[test]
    fn recent_list_orders_dedupes_and_survives_damage() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("recent.json");
        assert!(load_recent(&f).is_empty());
        push_recent(&f, "a").unwrap();
        push_recent(&f, "b").unwrap();
        assert_eq!(push_recent(&f, "a").unwrap(), vec!["a", "b"]);
        for i in 0..20 {
            push_recent(&f, &i.to_string()).unwrap();
        }
        assert_eq!(load_recent(&f).len(), MAX_RECENT);
        assert_eq!(remove_recent(&f, "19").unwrap()[0], "18");
        std::fs::write(&f, b"not json").unwrap();
        assert!(load_recent(&f).is_empty());
    }
}
