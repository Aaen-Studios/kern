// ---------------------------------------------------------------------------
// File search
// ---------------------------------------------------------------------------

/// Check if a path matches a simple glob pattern (supports * wildcard).
fn glob_match(path: &str, pattern: &str) -> bool {
    if pattern == "*" { return true; }
    // Simple implementation: if pattern contains *, check if path contains the non-star parts
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 1 {
        // No wildcard, do exact match
        return path.contains(&parts[0]);
    }
    // Check if all parts exist in order
    let mut pos = 0;
    for part in parts {
        if part.is_empty() { continue; }
        if let Some(idx) = path[pos..].find(part) {
            pos += idx + part.len();
        } else {
            return false;
        }
    }
    true
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub rel_path: String,
    pub line_number: Option<u32>,
    pub line_preview: Option<String>,
}

#[tauri::command]
pub fn search_files(
    app_handle: AppHandle,
    id: String,
    query: String,
    mode: String,
    include: Option<String>,
    exclude: Option<String>,
) -> Result<Vec<SearchMatch>, String> {
    let cfg = config::load_config(&app_handle)?;
    let instance = cfg
        .servers
        .get(&id)
        .ok_or_else(|| format!("server '{}' not found", id))?;
    let root = std::path::Path::new(&instance.path);
    let include_pattern = include.as_deref().unwrap_or("*");
    let exclude_patterns: Vec<&str> = exclude
        .as_deref()
        .map(|e| e.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();
    let mut results: Vec<SearchMatch> = Vec::new();
    let query_lower = query.to_lowercase();
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() { continue; }
        let rel_path = path.strip_prefix(root)
            .map(|p| p.to_string_lossy().replace("\\", "/"))
            .unwrap_or_default();
        let path_lower = rel_path.to_lowercase();
        if !glob_match(&path_lower, include_pattern) { continue; }
        if exclude_patterns.iter().any(|p| glob_match(&path_lower, p)) { continue; }
        if mode == "filenames" || mode == "both" {
            if path_lower.contains(&query_lower) {
                if !results.iter().any(|r| r.rel_path == rel_path) {
                    results.push(SearchMatch { rel_path: rel_path.clone(), line_number: None, line_preview: None });
                }
            }
        }
        if mode == "contents" || mode == "both" {
            if let Ok(content) = std::fs::read_to_string(path) {
                let mut line_num: u32 = 1;
                for line in content.lines() {
                    if line.to_lowercase().contains(&query_lower) {
                        let preview: String = if line.len() > 200 { format!("{}...", &line[..197]) } else { line.to_string() };
                        if !results.iter().any(|r| r.rel_path == rel_path && r.line_number == Some(line_num)) {
                            results.push(SearchMatch { rel_path: rel_path.clone(), line_number: Some(line_num), line_preview: Some(preview) });
                        }
                    }
                    line_num = line_num.saturating_add(1);
                }
            }
        }
    }
    Ok(results)
}

#[tauri::command]
pub fn get_file_from_backup(
    app_handle: AppHandle,
    id: String,
    backup_name: String,
    rel_path: String,
) -> Result<Option<String>, String> {
    let cfg = config::load_config(&app_handle)?;
    let instance = cfg.servers.get(&id).ok_or_else(|| format!("server '{}' not found", id))?;
    let backup_path = std::path::PathBuf::from(&instance.path).join("backups").join(&backup_name);
    if !backup_path.exists() { return Err(format!("backup '{}' not found", backup_name)); }
    let file = std::fs::File::open(&backup_path).map_err(|e| format!("failed to open backup: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("invalid backup archive: {}", e))?;
    let entry_name = rel_path.replace("\\", "/");
    let mut found = None;
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            let name = f.name().replace("\\", "/");
            if name == entry_name { found = Some(i); break; }
        }
    }
    let index = match found { Some(i) => i, None => return Ok(None) };
    let mut file = archive.by_index(index).map_err(|e| format!("failed to read archive entry: {}", e))?;
    let mut content = String::new();
    std::io::Read::read_to_string(&mut file, &mut content).map_err(|e| format!("failed to read file from backup: {}", e))?;
    Ok(Some(content))
}

#[tauri::command]
pub fn read_file_bytes(app_handle: AppHandle, id: String, rel_path: String) -> Result<String, String> {
    let cfg = config::load_config(&app_handle)?;
    let instance = cfg.servers.get(&id).ok_or_else(|| format!("server '{}' not found", id))?;
    let target = resolve_path(&instance.path, &rel_path)?;
    if !target.is_file() { return Err(format!("'{}' is not a file or does not exist", rel_path)); }
    let bytes = std::fs::read(&target).map_err(|e| format!("failed to read '{}': {}", rel_path, e))?;
    Ok(base64_encode(&bytes))
}

fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((bytes.len() + 2) / 3 * 4);
    let mut i = 0;
    while i < bytes.len() {
        let b0 = bytes[i] as usize;
        if i + 1 >= bytes.len() {
            result.push(ALPHABET[b0 >> 2] as char);
            result.push(ALPHABET[(b0 & 0x3) << 4] as char);
            result.push('=');
            result.push('=');
        } else if i + 2 >= bytes.len() {
            let b1 = bytes[i + 1] as usize;
            result.push(ALPHABET[b0 >> 2] as char);
            result.push(ALPHABET[((b0 & 0x3) << 4) | (b1 >> 4)] as char);
            result.push(ALPHABET[(b1 & 0xf) << 2] as char);
            result.push('=');
        } else {
            let b1 = bytes[i + 1] as usize;
            let b2 = bytes[i + 2] as usize;
            result.push(ALPHABET[b0 >> 2] as char);
            result.push(ALPHABET[((b0 & 0x3) << 4) | (b1 >> 4)] as char);
            result.push(ALPHABET[((b1 & 0xf) << 2) | (b2 >> 6)] as char);
            result.push(ALPHABET[b2 & 0x3f] as char);
        }
        i += 3;
    }
    result
}
