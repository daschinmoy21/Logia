use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::Manager;

/// File status in the sync manifest
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FileStatus {
    Synced,           // Local and cloud are identical
    LocalModified,    // Local changed since last sync
    CloudModified,    // Cloud changed since last sync
    Conflict,         // Both changed since last sync
    DeletedLocal,     // Deleted locally, exists in cloud
    DeletedCloud,     // Deleted in cloud, exists locally
    NewLocal,         // New local file, not in cloud
    NewCloud,         // New cloud file, not locally
}

/// State of a single file in the manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileState {
    pub local_hash: Option<String>,
    pub cloud_hash: Option<String>,
    pub local_modified: Option<DateTime<Utc>>,
    pub cloud_modified: Option<DateTime<Utc>>,
    pub status: FileStatus,
    pub cloud_file_id: Option<String>,  // Google Drive file ID
}

impl Default for FileState {
    fn default() -> Self {
        Self {
            local_hash: None,
            cloud_hash: None,
            local_modified: None,
            cloud_modified: None,
            status: FileStatus::Synced,
            cloud_file_id: None,
        }
    }
}

/// The sync manifest tracks all files across local and cloud
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncManifest {
    pub version: u32,
    pub device_id: String,
    pub last_sync: Option<DateTime<Utc>>,
    pub files: HashMap<String, FileState>,
}

impl Default for SyncManifest {
    fn default() -> Self {
        Self {
            version: 1,
            device_id: uuid::Uuid::new_v4().to_string(),
            last_sync: None,
            files: HashMap::new(),
        }
    }
}

/// A single pending sync action
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAction {
    pub path: String,           // Relative path like "notes/abc.json"
    pub status: FileStatus,
    pub local_modified: Option<DateTime<Utc>>,
    pub cloud_modified: Option<DateTime<Utc>>,
}

/// The sync plan contains all pending actions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPlan {
    pub uploads: Vec<SyncAction>,      // Files to upload to cloud
    pub downloads: Vec<SyncAction>,    // Files to download from cloud
    pub conflicts: Vec<SyncAction>,    // Files that need user resolution
    pub deletions_local: Vec<SyncAction>,   // Delete locally (file deleted in cloud)
    pub deletions_cloud: Vec<SyncAction>,   // Delete from cloud (file deleted locally)
}

impl Default for SyncPlan {
    fn default() -> Self {
        Self {
            uploads: Vec::new(),
            downloads: Vec::new(),
            conflicts: Vec::new(),
            deletions_local: Vec::new(),
            deletions_cloud: Vec::new(),
        }
    }
}

impl SyncPlan {
    pub fn has_conflicts(&self) -> bool {
        !self.conflicts.is_empty()
    }
    
    pub fn is_empty(&self) -> bool {
        self.uploads.is_empty() 
            && self.downloads.is_empty() 
            && self.conflicts.is_empty()
            && self.deletions_local.is_empty()
            && self.deletions_cloud.is_empty()
    }
    
    pub fn total_actions(&self) -> usize {
        self.uploads.len() 
            + self.downloads.len() 
            + self.conflicts.len()
            + self.deletions_local.len()
            + self.deletions_cloud.len()
    }
}

/// Compute SHA256 hash of file contents
pub fn compute_file_hash(path: &PathBuf) -> Result<String, String> {
    let contents = fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?;
    let mut hasher = Sha256::new();
    hasher.update(&contents);
    let result = hasher.finalize();
    Ok(format!("{:x}", result))
}

/// Get the path to the local manifest file
pub fn get_manifest_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let logia_dir = app_handle
        .path()
        .resolve("Logia", BaseDirectory::Document)
        .map_err(|_| "Could not resolve Logia directory")?;
    
    if !logia_dir.exists() {
        fs::create_dir_all(&logia_dir).map_err(|e| format!("Failed to create Logia dir: {}", e))?;
    }
    
    Ok(logia_dir.join("sync_manifest.json"))
}

/// Load the local manifest (or create a new one if it doesn't exist)
pub fn load_local_manifest(app_handle: &tauri::AppHandle) -> Result<SyncManifest, String> {
    let path = get_manifest_path(app_handle)?;
    
    if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read manifest: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse manifest: {}", e))
    } else {
        Ok(SyncManifest::default())
    }
}

/// Save the manifest to local disk
pub fn save_local_manifest(app_handle: &tauri::AppHandle, manifest: &SyncManifest) -> Result<(), String> {
    let path = get_manifest_path(app_handle)?;
    let content = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write manifest: {}", e))
}

/// Scan all local files and compute their current state
pub fn scan_local_files(app_handle: &tauri::AppHandle) -> Result<HashMap<String, (String, DateTime<Utc>)>, String> {
    let mut files = HashMap::new();
    
    let subdirs = ["notes", "folders", "kanban", "trash"];
    
    for subdir in subdirs {
        let dir_path = app_handle
            .path()
            .resolve(&format!("Logia/{}", subdir), BaseDirectory::Document)
            .map_err(|_| format!("Could not resolve {} directory", subdir))?;
        
        if !dir_path.exists() {
            continue;
        }
        
        if let Ok(entries) = fs::read_dir(&dir_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("json") {
                    let filename = entry.file_name().to_string_lossy().to_string();
                    let rel_path = format!("{}/{}", subdir, filename);
                    
                    if let Ok(hash) = compute_file_hash(&path) {
                        if let Ok(metadata) = fs::metadata(&path) {
                            if let Ok(modified) = metadata.modified() {
                                let modified_dt = DateTime::<Utc>::from(modified);
                                files.insert(rel_path, (hash, modified_dt));
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(files)
}

/// Compare local state against manifest to find changes
pub fn detect_local_changes(
    manifest: &SyncManifest,
    local_files: &HashMap<String, (String, DateTime<Utc>)>,
) -> SyncManifest {
    let mut updated_manifest = manifest.clone();
    
    // Check each local file
    for (path, (hash, modified)) in local_files {
        if let Some(state) = updated_manifest.files.get_mut(path) {
            // File exists in manifest - check if changed
            if state.local_hash.as_ref() != Some(hash) {
                // Local file changed
                state.local_hash = Some(hash.clone());
                state.local_modified = Some(*modified);
                
                // Determine new status
                if state.status == FileStatus::Synced {
                    state.status = FileStatus::LocalModified;
                } else if state.status == FileStatus::CloudModified {
                    state.status = FileStatus::Conflict;
                }
            }
        } else {
            // New file not in manifest
            updated_manifest.files.insert(path.clone(), FileState {
                local_hash: Some(hash.clone()),
                cloud_hash: None,
                local_modified: Some(*modified),
                cloud_modified: None,
                status: FileStatus::NewLocal,
                cloud_file_id: None,
            });
        }
    }
    
    // Check for deleted local files
    let local_paths: std::collections::HashSet<_> = local_files.keys().collect();
    for (path, state) in updated_manifest.files.iter_mut() {
        if !local_paths.contains(path) && state.local_hash.is_some() {
            // File was in manifest but no longer exists locally
            state.local_hash = None;
            state.local_modified = None;
            
            if state.cloud_hash.is_some() {
                state.status = FileStatus::DeletedLocal;
            }
        }
    }
    
    updated_manifest
}

/// Build a sync plan from the manifest
pub fn build_sync_plan(manifest: &SyncManifest) -> SyncPlan {
    let mut plan = SyncPlan::default();
    
    for (path, state) in &manifest.files {
        let action = SyncAction {
            path: path.clone(),
            status: state.status.clone(),
            local_modified: state.local_modified,
            cloud_modified: state.cloud_modified,
        };
        
        match state.status {
            FileStatus::Synced => {
                // Nothing to do
            }
            FileStatus::LocalModified | FileStatus::NewLocal => {
                plan.uploads.push(action);
            }
            FileStatus::CloudModified | FileStatus::NewCloud => {
                plan.downloads.push(action);
            }
            FileStatus::Conflict => {
                plan.conflicts.push(action);
            }
            FileStatus::DeletedLocal => {
                plan.deletions_cloud.push(action);
            }
            FileStatus::DeletedCloud => {
                plan.deletions_local.push(action);
            }
        }
    }
    
    plan
}
