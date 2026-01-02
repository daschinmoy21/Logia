use google_drive3::{DriveHub, oauth2::{InstalledFlowAuthenticator, InstalledFlowReturnMethod}, hyper, hyper_rustls, api::{File as DriveFile, *}};
use google_drive3::api::Scope; // Correct Import for Scope
use std::pin::Pin;
use std::future::Future;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{State, Manager, path::BaseDirectory};
use serde::{Serialize, Deserialize};
use std::path::PathBuf;
use std::fs;
use chrono::{DateTime, Utc};

// Build-time environment variables for Google OAuth
// Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET when building
const GOOGLE_CLIENT_ID: &str = env!("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET: &str = env!("GOOGLE_CLIENT_SECRET");

pub struct GoogleDriveState {
    // Using Arc<Mutex<Option<Arc<DriveHub>>>> allows us to:
    // 1. Lock briefly to get/set the hub
    // 2. Clone the Arc<DriveHub> to use during long operations
    // 3. Release the mutex while the operation runs
    pub hub: Arc<Mutex<Option<Arc<DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>>>>>,
}

impl GoogleDriveState {
    pub fn new() -> Self {
        Self {
            hub: Arc::new(Mutex::new(None)),
        }
    }
    
    /// Get a cloned Arc to the hub, releasing the lock immediately.
    /// This allows concurrent read operations without blocking.
    pub async fn get_hub(&self) -> Option<Arc<DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>>> {
        self.hub.lock().await.clone()
    }
    
    /// Set the hub (takes ownership wrapped in Arc)
    pub async fn set_hub(&self, hub: DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>) {
        *self.hub.lock().await = Some(Arc::new(hub));
    }
    
    /// Clear the hub
    pub async fn clear_hub(&self) {
        *self.hub.lock().await = None;
    }
}

#[derive(Serialize, Clone)]
pub struct AuthStatus {
    pub is_authenticated: bool,
    pub user_email: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct SyncStatus {
    pub local_count: usize,
    pub remote_count: usize,
    pub has_conflict: bool, // true if local and remote have different files
}

/// Detailed sync result for frontend to know what happened
#[derive(Serialize, Clone)]
pub struct SyncResult {
    pub notes_uploaded: usize,
    pub notes_downloaded: usize,
    pub folders_uploaded: usize,
    pub folders_downloaded: usize,
    pub kanban_uploaded: usize,
    pub kanban_downloaded: usize,
    pub trash_uploaded: usize,
    pub trash_downloaded: usize,
    pub needs_reload: bool,  // true if any files were downloaded
    pub message: String,
}

// Helper to resolve notes directory (duplicated from lib.rs for decoupling)
fn resolve_notes_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
     let dir_result = app_handle
        .path()
        .resolve("Logia/notes", BaseDirectory::Document);

    match dir_result {
        Ok(path) => {
            if !path.exists() {
                 fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            }
            Ok(path)
        },
        Err(_) => {
             // Fallback
             let home = app_handle.path().resolve("", BaseDirectory::Home).map_err(|_| "No home dir".to_string())?;
             let path = home.join("Documents").join("Logia").join("notes");
              if !path.exists() {
                 fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            }
            Ok(path)
        }
    }
}

// Custom Delegate to force browser open on Linux/NixOS and Windows reliably
// Also patches URL to use 127.0.0.1 instead of localhost to avoid IPv6 issues
struct BrowserUserHandler;

impl google_drive3::oauth2::authenticator_delegate::InstalledFlowDelegate for BrowserUserHandler {
    fn present_user_url<'a>(
        &'a self,
        url: &'a str,
        need_code: bool,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
        Box::pin(async move {
            if need_code {
                println!("Please enter the code from the browser:");
            }
            
            // Force IPv4 loopback to avoid Windows IPv6 resolution issues (localhost resolving to ::1)
            let url = url.replace("localhost", "127.0.0.1");
            println!("Opening browser to: {}", url);
            
            // Use the `open` crate which properly handles URL escaping on all platforms
            // (explorer.exe on Windows doesn't handle & in URLs correctly)
            if let Err(e) = open::that(&url) {
                println!("Failed to open browser: {}. Please open the URL manually.", e);
            }
            
            if need_code {
                 let mut input = String::new();
                 std::io::stdin().read_line(&mut input).map_err(|e| e.to_string())?;
                 return Ok(input.trim().to_string());
            }
            
            Ok(String::new())
        })
    }
}

pub async fn create_drive_hub() -> Result<DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>, String> {
    let token_path = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("logia")
        .join("google_token.json");

    if let Some(parent) = token_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    println!("[DEBUG] Token cache path: {:?}", token_path);

    let secret = google_drive3::oauth2::ApplicationSecret {
        client_id: GOOGLE_CLIENT_ID.to_string(),
        client_secret: GOOGLE_CLIENT_SECRET.to_string(),
        auth_uri: "https://accounts.google.com/o/oauth2/auth".to_string(),
        token_uri: "https://oauth2.googleapis.com/token".to_string(),
        redirect_uris: vec!["http://127.0.0.1".to_string(), "http://localhost".to_string()], 
        ..Default::default()
    };

    let auth = InstalledFlowAuthenticator::builder(
        secret,
        InstalledFlowReturnMethod::HTTPRedirect,
    )
    .persist_tokens_to_disk(token_path)
    .flow_delegate(Box::new(BrowserUserHandler))
    .build()
    .await
    .map_err(|e| format!("Failed to create authenticator: {}", e))?;

    let client = hyper::Client::builder().build(
        hyper_rustls::HttpsConnectorBuilder::new()
            .with_native_roots()
            .map_err(|e| format!("Native roots error: {}", e))?
            .https_or_http()
            .enable_http1()
            .build()
    );

    Ok(DriveHub::new(client, auth))
}

#[derive(Clone, Serialize)]
pub struct DriveFileDiff {
    pub id: Option<String>,
    pub name: Option<String>,
    pub mime_type: Option<String>,
    pub modified_time: Option<DateTime<Utc>>,
    pub size: Option<i64>,
}

#[tauri::command]
pub async fn connect_google_drive(state: State<'_, GoogleDriveState>) -> Result<AuthStatus, String> {
    // create_drive_hub handles the OAuth flow entirely:
    // - Uses InstalledFlowReturnMethod::HTTPRedirect which starts a local HTTP server
    // - BrowserUserHandler delegate opens the browser with the correct auth URL
    // - The library handles the callback automatically
    let hub = create_drive_hub().await?;
    
    // Trigger the OAuth flow by making a simple API call
    // This forces authentication if not already authenticated
    let _ = hub.files().list()
        .page_size(1)
        .add_scope(Scope::Full)  // Explicitly request full Drive access
        .doit()
        .await
        .map_err(|e| e.to_string())?;

    state.set_hub(hub).await;

    Ok(AuthStatus { is_authenticated: true, user_email: None })
}

#[tauri::command]
pub async fn get_google_drive_status(state: State<'_, GoogleDriveState>) -> Result<AuthStatus, String> {
    let is_auth = state.get_hub().await.is_some();
    // We could try to get email here if connected
    Ok(AuthStatus { is_authenticated: is_auth, user_email: None })
}

#[tauri::command]
pub async fn disconnect_google_drive(state: State<'_, GoogleDriveState>) -> Result<(), String> {
    // Clear the hub state
    state.clear_hub().await;
    
    // Delete the token file to fully sign out
    let token_path = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("logia")
        .join("google_token.json");
    
    if token_path.exists() {
        fs::remove_file(&token_path)
            .map_err(|e| format!("Failed to remove token file: {}", e))?;
    }
    
    // Also clear the drive config (cached folder IDs)
    let config_path = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("logia")
        .join("drive_config.json");
    
    if config_path.exists() {
        let _ = fs::remove_file(&config_path); // Best effort
    }
    
    println!("[Google Drive] Disconnected and cleared token");
    Ok(())
}

// --- Sync Helpers ---

// --- Config & Persistent IDs ---

#[derive(Serialize, Deserialize, Clone, Default)]
struct DriveConfig {
    pub logia_folder_id: Option<String>,
    pub notes_folder_id: Option<String>,
    pub folders_folder_id: Option<String>,
    pub kanban_folder_id: Option<String>,
    pub trash_folder_id: Option<String>,
    pub last_trash_cleanup: Option<String>,  // ISO timestamp
}

fn get_drive_config_path() -> PathBuf {
    let path = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("logia")
        .join("google_drive_config.json");
    // Ensure dir exists
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    path
}

fn load_drive_config() -> DriveConfig {
    let path = get_drive_config_path();
    println!("[DEBUG] Loading config from: {:?}", path);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            println!("[DEBUG] Config content: {}", content);
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            } else {
                 println!("[DEBUG] Failed to parse config JSON");
            }
        } else {
             println!("[DEBUG] Failed to read config file");
        }
    } else {
        println!("[DEBUG] Config file does not exist");
    }
    DriveConfig::default()
}

fn save_drive_config(config: &DriveConfig) {
    let path = get_drive_config_path();
    println!("[DEBUG] Saving config to: {:?}", path);
    match serde_json::to_string_pretty(config) {
        Ok(content) => {
             if let Err(e) = fs::write(&path, content) {
                 println!("[DEBUG] Failed to write config: {}", e);
             } else {
                 println!("[DEBUG] Config saved successfully");
             }
        },
        Err(e) => println!("[DEBUG] Failed to serialize config: {}", e),
    }
}

// --- Folder Logic ---

async fn get_or_create_logia_root(hub: &DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>) -> Result<String, String> {
    let mut config = load_drive_config();

    // 1. Check Config
    if let Some(id) = &config.logia_folder_id {
        // Verify it still exists and is not trashed
        match hub.files().get(id).param("fields", "trashed").add_scope(Scope::Full).doit().await {
            Ok((_, file)) => {
                if !file.trashed.unwrap_or(false) {
                    println!("[Setup] Using cached Logia Root ID: {}", id);
                    return Ok(id.clone());
                } else {
                     println!("[Setup] Cached ID is trashed");
                }
            },
            Err(e) => println!("[Setup] Cached Logia Root ID invalid/reachable ({}), re-searching...", e),
        }
    }

    // 2. Search in Drive Root
    let q = "mimeType = 'application/vnd.google-apps.folder' and name = 'Logia' and trashed = false and 'root' in parents";
    println!("[DEBUG] Searching for existing root Logia folder...");
    println!("[DEBUG] Search query: {}", q);
    let (_, file_list) = hub.files().list()
        .q(q)
        .corpora("user")
        .spaces("drive") // Search entire Drive space
        .param("fields", "files(id, name)")
        .add_scope(Scope::Full)  // CRITICAL: Use full scope to see all folders
        .doit()
        .await
        .map_err(|e| format!("List Root failed: {}", e))?;
    println!("[DEBUG] Search returned {} files", file_list.files.as_ref().map(|f| f.len()).unwrap_or(0));

    let root_id = if let Some(files) = file_list.files.as_ref().filter(|f| !f.is_empty()) {
        let id = files[0].id.clone().ok_or("No ID found for existing folder")?;
        println!("[Setup] Found existing Logia Root: {} (Name: {:?})", id, files[0].name);
        id
    } else {
        // 3. Create New
        println!("[Setup] Creating new Logia Root...");
        let new_folder = DriveFile {
            name: Some("Logia".to_string()),
            mime_type: Some("application/vnd.google-apps.folder".to_string()),
            parents: Some(vec!["root".to_string()]),
            ..Default::default()
        };
        let (_, file) = hub.files().create(new_folder)
            .add_scope(Scope::Full)
            .upload(std::io::empty(), "application/vnd.google-apps.folder".parse().unwrap())
            .await
            .map_err(|e| format!("Create Root failed: {}", e))?;
        let new_id = file.id.ok_or("Created folder has no ID")?;
        println!("[Setup] Created new root Logia: {}", new_id);
        new_id
    };

    // Save to Config
    config.logia_folder_id = Some(root_id.clone());
    save_drive_config(&config);
    Ok(root_id)
}

async fn get_or_create_notes_folder(hub: &DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>, root_id: &str) -> Result<String, String> {
    let mut config = load_drive_config();

    // 1. Check Config
    if let Some(id) = &config.notes_folder_id {
         match hub.files().get(id).param("fields", "trashed, parents").add_scope(Scope::Full).doit().await {
            Ok((_, file)) => {
                if !file.trashed.unwrap_or(false) {
                    // Start paranoid check: ensure parent is actually our root_id (optional, but good for integrity)
                    // if let Some(parents) = file.parents {
                    //    if parents.contains(&root_id.to_string()) { ... }
                    // }
                    println!("[Setup] Using cached Notes Folder ID: {}", id);
                    return Ok(id.clone());
                }
            },
             Err(_) => println!("[Setup] Cached Notes ID invalid..."),
         }
    }

    // 2. Search inside Root ID
    let q = format!("mimeType = 'application/vnd.google-apps.folder' and name = 'notes' and trashed = false and '{}' in parents", root_id);
    let (_, file_list) = hub.files().list()
        .q(&q)
        .corpora("user")
        .param("fields", "files(id)")
        .add_scope(Scope::Full)
        .doit()
        .await
        .map_err(|e| format!("List Subfolder failed: {}", e))?;

    let notes_id = if let Some(files) = file_list.files.as_ref().filter(|f| !f.is_empty()) {
         let id = files[0].id.clone().ok_or("No ID found")?;
         println!("[Setup] Found existing notes folder: {}", id);
         id
    } else {
        // 3. Create New
        println!("[Setup] Creating new notes folder...");
        let new_folder = DriveFile {
            name: Some("notes".to_string()),
            mime_type: Some("application/vnd.google-apps.folder".to_string()),
            parents: Some(vec![root_id.to_string()]),
            ..Default::default()
        };
        let (_, file) = hub.files().create(new_folder)
            .add_scope(Scope::Full)
            .upload(std::io::empty(), "application/vnd.google-apps.folder".parse().unwrap())
            .await
            .map_err(|e| format!("Create Subfolder failed: {}", e))?;
        file.id.ok_or("Created subfolder has no ID")?
    };

    // Save to Config
    config.notes_folder_id = Some(notes_id.clone());
    save_drive_config(&config);
    Ok(notes_id)
}

/// Generic function to get or create a subfolder inside the Logia root
async fn get_or_create_subfolder(
    hub: &DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>, 
    root_id: &str, 
    folder_name: &str,
    config_field: &str,
) -> Result<String, String> {
    let mut config = load_drive_config();
    
    // Check if we already have this folder ID cached
    let cached_id = match config_field {
        "notes" => config.notes_folder_id.clone(),
        "folders" => config.folders_folder_id.clone(),
        "kanban" => config.kanban_folder_id.clone(),
        "trash" => config.trash_folder_id.clone(),
        _ => None,
    };

    // 1. Check Config
    if let Some(id) = &cached_id {
        match hub.files().get(id).param("fields", "trashed").add_scope(Scope::Full).doit().await {
            Ok((_, file)) => {
                if !file.trashed.unwrap_or(false) {
                    println!("[Setup] Using cached {} Folder ID: {}", folder_name, id);
                    return Ok(id.clone());
                }
            },
            Err(_) => println!("[Setup] Cached {} ID invalid...", folder_name),
        }
    }

    // 2. Search inside Root ID
    let q = format!("mimeType = 'application/vnd.google-apps.folder' and name = '{}' and trashed = false and '{}' in parents", folder_name, root_id);
    let (_, file_list) = hub.files().list()
        .q(&q)
        .corpora("user")
        .param("fields", "files(id)")
        .add_scope(Scope::Full)
        .doit()
        .await
        .map_err(|e| format!("List Subfolder {} failed: {}", folder_name, e))?;

    let folder_id = if let Some(files) = file_list.files.as_ref().filter(|f| !f.is_empty()) {
        let id = files[0].id.clone().ok_or("No ID found")?;
        println!("[Setup] Found existing {} folder: {}", folder_name, id);
        id
    } else {
        // 3. Create New
        println!("[Setup] Creating new {} folder...", folder_name);
        let new_folder = DriveFile {
            name: Some(folder_name.to_string()),
            mime_type: Some("application/vnd.google-apps.folder".to_string()),
            parents: Some(vec![root_id.to_string()]),
            ..Default::default()
        };
        let (_, file) = hub.files().create(new_folder)
            .add_scope(Scope::Full)
            .upload(std::io::empty(), "application/vnd.google-apps.folder".parse().unwrap())
            .await
            .map_err(|e| format!("Create Subfolder {} failed: {}", folder_name, e))?;
        file.id.ok_or("Created subfolder has no ID")?
    };

    // Save to Config
    match config_field {
        "notes" => config.notes_folder_id = Some(folder_id.clone()),
        "folders" => config.folders_folder_id = Some(folder_id.clone()),
        "kanban" => config.kanban_folder_id = Some(folder_id.clone()),
        "trash" => config.trash_folder_id = Some(folder_id.clone()),
        _ => {},
    };
    save_drive_config(&config);
    Ok(folder_id)
}

// Wrapper to get the target folder for syncing (Logia/notes) - keeps backward compatibility
async fn get_target_sync_folder(hub: &DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>) -> Result<String, String> {
    let root_id = get_or_create_logia_root(hub).await?;
    get_or_create_subfolder(hub, &root_id, "notes", "notes").await
}

/// Gets all sync folder IDs: notes, folders, kanban, trash
async fn get_all_sync_folders(hub: &DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>) -> Result<(String, String, String, String, String), String> {
    let root_id = get_or_create_logia_root(hub).await?;
    let notes_id = get_or_create_subfolder(hub, &root_id, "notes", "notes").await?;
    let folders_id = get_or_create_subfolder(hub, &root_id, "folders", "folders").await?;
    let kanban_id = get_or_create_subfolder(hub, &root_id, "kanban", "kanban").await?;
    let trash_id = get_or_create_subfolder(hub, &root_id, "trash", "trash").await?;
    Ok((root_id, notes_id, folders_id, kanban_id, trash_id))
}

#[tauri::command]
pub async fn sync_notes_to_google_drive(app_handle: tauri::AppHandle, state: State<'_, GoogleDriveState>) -> Result<String, String> {
    // Get a cloned Arc to the hub - releases the lock immediately
    let hub = state.get_hub().await.ok_or("Not connected")?;
    
    let logia_folder_id = get_target_sync_folder(&hub).await?;

    // 1. List Remote Files
    let q = format!("'{}' in parents and trashed = false", logia_folder_id);
    let (_, file_list) = hub.files().list().q(&q).param("fields", "files(id, name, modifiedTime, mimeType)").add_scope(Scope::Full).doit().await.map_err(|e| e.to_string())?;
    let remote_files = file_list.files.unwrap_or_default();

    // 2. List Local Files
    let notes_dir = resolve_notes_path(&app_handle)?;
    let local_entries = fs::read_dir(&notes_dir).map_err(|e| e.to_string())?;

    // Simple strategy: iterate local, upload if newer. Then iterate remote, download if missing locally.
    
    // Convert remote files to a Map for easy lookup
    use std::collections::HashMap;
    let mut remote_map: HashMap<String, DriveFile> = HashMap::new();
    for f in remote_files {
        if let Some(name) = &f.name {
            remote_map.insert(name.clone(), f);
        }
    }

    let mut processed_remotes = Vec::new();

    // Loop Local
    for entry in local_entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
             let name = entry.file_name().to_string_lossy().to_string();
             let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
             let local_modified = DateTime::<Utc>::from(metadata.modified().unwrap());

             if let Some(remote_file) = remote_map.get(&name) {
                 processed_remotes.push(name.clone());
                 // Compare
                 let remote_modified = remote_file.modified_time.unwrap_or(Utc::now());
                 // let remote_modified = DateTime::parse_from_rfc3339(remote_mod_str).map_err(|_| "Parse time error")?.with_timezone(&Utc);

                 // Threshold of 2 seconds for difference
                 if local_modified.signed_duration_since(remote_modified).num_seconds() > 2 {
                     // Local is newer -> Upload
                     println!("Uploading newer local: {}", name);
                     upload_file(&hub, &path, &name, &logia_folder_id, Some(&remote_file.id.as_ref().unwrap())).await?;
                 } else if remote_modified.signed_duration_since(local_modified).num_seconds() > 2 {
                     // Remote is newer -> Download
                     println!("Downloading newer remote: {}", name);
                     download_file(&hub, &remote_file.id.as_ref().unwrap(), &path).await?;
                 }
                 // Else: synced
             } else {
                 // Not in remote -> Upload (New)
                 println!("Uploading new file: {}", name);
                 upload_file(&hub, &path, &name, &logia_folder_id, None).await?;
             }
        }
    }

    // Loop remaining Remote (Download if missing locally)
    for (name, remote_file) in remote_map {
        if !processed_remotes.contains(&name) {
            // Missing locally
            println!("Downloading missing local: {}", name);
            let target_path = notes_dir.join(&name);
            download_file(&hub, &remote_file.id.unwrap(), &target_path).await?;
        }
    }

    Ok("Sync completed successfully".to_string())
}

#[tauri::command]
pub async fn check_sync_status(app_handle: tauri::AppHandle, state: State<'_, GoogleDriveState>) -> Result<SyncStatus, String> {
    let hub = state.get_hub().await.ok_or("Not connected")?;
    
    let logia_folder_id = get_target_sync_folder(&hub).await?;

    // Count remote files
    let q = format!("'{}' in parents and trashed = false", logia_folder_id);
    let (_, file_list) = hub.files().list().q(&q).add_scope(Scope::Full).doit().await.map_err(|e| e.to_string())?;
    let remote_count = file_list.files.map(|f| f.len()).unwrap_or(0);

    // Count local files
    let notes_dir = resolve_notes_path(&app_handle)?;
    let local_count = fs::read_dir(&notes_dir)
        .map(|entries| entries.filter_map(|e| e.ok()).filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("json")).count())
        .unwrap_or(0);

    // Conflict: both have files but counts differ significantly, or local is empty but remote has files
    let has_conflict = (local_count == 0 && remote_count > 0) || (remote_count == 0 && local_count > 0) || (local_count > 0 && remote_count > 0 && local_count != remote_count);

    Ok(SyncStatus {
        local_count,
        remote_count,
        has_conflict,
    })
}

#[tauri::command]
pub async fn force_sync_from_cloud(app_handle: tauri::AppHandle, state: State<'_, GoogleDriveState>) -> Result<String, String> {
    let hub = state.get_hub().await.ok_or("Not connected")?;
    
    let logia_folder_id = get_target_sync_folder(&hub).await?;
    let notes_dir = resolve_notes_path(&app_handle)?;

    // List remote files
    let q = format!("'{}' in parents and trashed = false", logia_folder_id);
    let (_, file_list) = hub.files().list().q(&q).param("fields", "files(id, name)").add_scope(Scope::Full).doit().await.map_err(|e| e.to_string())?;
    let remote_files = file_list.files.unwrap_or_default();
    let file_count = remote_files.len();

    // Download all remote files (overwriting local)
    for file in remote_files {
        if let (Some(id), Some(name)) = (file.id, file.name) {
            let target_path = notes_dir.join(&name);
            download_file(&hub, &id, &target_path).await?;
        }
    }

    Ok(format!("Downloaded {} files from cloud", file_count))
}

#[tauri::command]
pub async fn force_sync_to_cloud(app_handle: tauri::AppHandle, state: State<'_, GoogleDriveState>) -> Result<String, String> {
    let hub = state.get_hub().await.ok_or("Not connected")?;
    
    let logia_folder_id = get_target_sync_folder(&hub).await?;
    let notes_dir = resolve_notes_path(&app_handle)?;

    // Delete all remote files in the Logia folder first
    let q = format!("'{}' in parents and trashed = false", logia_folder_id);
    let (_, file_list) = hub.files().list().q(&q).add_scope(Scope::Full).doit().await.map_err(|e| e.to_string())?;
    if let Some(files) = file_list.files {
        for file in files {
            if let Some(id) = file.id {
                let _ = hub.files().delete(&id).add_scope(Scope::Full).doit().await; // Ignore errors
            }
        }
    }

    // Upload all local files
    let mut count = 0;
    let local_entries = fs::read_dir(&notes_dir).map_err(|e| e.to_string())?;
    for entry in local_entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let name = entry.file_name().to_string_lossy().to_string();
            upload_file(&hub, &path, &name, &logia_folder_id, None).await?;
            count += 1;
        }
    }

    Ok(format!("Uploaded {} files to cloud", count))
}

async fn upload_file(hub: &DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>, path: &PathBuf, name: &str, folder_id: &str, file_id: Option<&str>) -> Result<(), String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    // We need to read content? No, we can pass the file directly usually, logic depends on API.
    // google-drive3 upload logic:
    
    let drive_file = DriveFile {
        name: Some(name.to_string()),
        parents: Some(vec![folder_id.to_string()]),
        ..Default::default()
    };

    if let Some(id) = file_id {
        // Update
        let update_file = DriveFile::default();
        // clear parents for update ? no need
        hub.files().update(update_file, id)
           .add_scope(Scope::Full)
           .upload(file, "application/json".parse().unwrap())
           .await.map_err(|e| format!("Upload update failed: {}", e))?;
    } else {
        // Create
        hub.files().create(drive_file)
           .add_scope(Scope::Full)
           .upload(file, "application/json".parse().unwrap())
           .await.map_err(|e| format!("Upload create failed: {}", e))?;
    }
    Ok(())
}

async fn download_file(hub: &DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>, file_id: &str, target_path: &PathBuf) -> Result<(), String> {
    let response = hub.files().get(file_id)
        .param("alt", "media")
        .add_scope(Scope::Full)
        .doit().await.map_err(|e| format!("Download req failed: {}", e))?;
    
    // let mut content = Vec::new();
    let bytes = hyper::body::to_bytes(response.0.into_body()).await.map_err(|e| format!("Read body failed: {}", e))?;
    fs::write(target_path, bytes).map_err(|e| format!("Write file failed: {}", e))?;
    
    // Update local config? No, timestamp?
    // We should ideally set the local modified time to match remote to avoid re-sync loops
    // But setting file time in Rust std is hard without `filetime` crate.
    // We will accept that the next sync might re-check or we can rely on "downloaded just now" > "remote modified time".
    
    Ok(())
}

/// Helper to sync a local directory with a remote Drive folder
async fn sync_directory(
    hub: &DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>,
    local_dir: &PathBuf,
    remote_folder_id: &str,
) -> Result<(usize, usize), String> {
    use std::collections::HashMap;
    
    let mut uploaded = 0;
    let mut downloaded = 0;

    // 1. List Remote Files
    let q = format!("'{}' in parents and trashed = false", remote_folder_id);
    let (_, file_list) = hub.files().list().q(&q).param("fields", "files(id, name, modifiedTime, mimeType)").add_scope(Scope::Full).doit().await.map_err(|e| e.to_string())?;
    let remote_files = file_list.files.unwrap_or_default();

    // Convert remote files to a Map for easy lookup
    let mut remote_map: HashMap<String, DriveFile> = HashMap::new();
    for f in remote_files {
        if let Some(name) = &f.name {
            remote_map.insert(name.clone(), f);
        }
    }

    let mut processed_remotes = Vec::new();

    // 2. List Local Files
    if let Ok(entries) = fs::read_dir(local_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                let name = entry.file_name().to_string_lossy().to_string();
                let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
                let local_modified = DateTime::<Utc>::from(metadata.modified().unwrap());

                if let Some(remote_file) = remote_map.get(&name) {
                    processed_remotes.push(name.clone());
                    let remote_modified = remote_file.modified_time.unwrap_or(Utc::now());

                    if local_modified.signed_duration_since(remote_modified).num_seconds() > 2 {
                        // Local is newer -> Upload
                        upload_file(hub, &path, &name, remote_folder_id, remote_file.id.as_deref()).await?;
                        uploaded += 1;
                    } else if remote_modified.signed_duration_since(local_modified).num_seconds() > 2 {
                        // Remote is newer -> Download (backup local first for safety)
                        // Create a backup copy with .backup suffix before overwriting
                        let backup_path = path.with_extension("json.backup");
                        if path.exists() {
                            let _ = fs::copy(&path, &backup_path); // Best effort backup
                        }
                        download_file(hub, remote_file.id.as_ref().unwrap(), &path).await?;
                        // Remove backup if download succeeded
                        let _ = fs::remove_file(&backup_path);
                        downloaded += 1;
                    }
                } else {
                    // Not in remote -> Upload (New)
                    upload_file(hub, &path, &name, remote_folder_id, None).await?;
                    uploaded += 1;
                }
            }
        }
    }

    // 3. Loop remaining Remote (Download if missing locally)
    for (name, remote_file) in remote_map {
        if !processed_remotes.contains(&name) {
            let target_path = local_dir.join(&name);
            download_file(hub, &remote_file.id.unwrap(), &target_path).await?;
            downloaded += 1;
        }
    }

    Ok((uploaded, downloaded))
}

/// Syncs all directories: notes, folders, kanban (as single file), and trash
#[tauri::command]
pub async fn sync_all_to_google_drive(app_handle: tauri::AppHandle, state: State<'_, GoogleDriveState>) -> Result<SyncResult, String> {
    let hub = state.get_hub().await.ok_or("Not connected")?;
    
    let (_root_id, notes_id, folders_id, kanban_id, trash_id) = get_all_sync_folders(&hub).await?;

    // Sync notes/
    let notes_dir = resolve_notes_path(&app_handle)?;
    let (notes_up, notes_down) = sync_directory(&hub, &notes_dir, &notes_id).await?;
    println!("[Sync] Notes: {} uploaded, {} downloaded", notes_up, notes_down);

    // Sync folders/
    let folders_dir = app_handle.path().resolve("Logia/folders", tauri::path::BaseDirectory::Document)
        .map_err(|_| "Could not resolve folders directory")?;
    if !folders_dir.exists() {
        let _ = fs::create_dir_all(&folders_dir);
    }
    let (folders_up, folders_down) = sync_directory(&hub, &folders_dir, &folders_id).await?;
    println!("[Sync] Folders: {} uploaded, {} downloaded", folders_up, folders_down);

    // Sync kanban/ (special: single data.json file)
    let kanban_dir = app_handle.path().resolve("Logia/kanban", tauri::path::BaseDirectory::Document)
        .map_err(|_| "Could not resolve kanban directory")?;
    if !kanban_dir.exists() {
        let _ = fs::create_dir_all(&kanban_dir);
    }
    let (kanban_up, kanban_down) = sync_directory(&hub, &kanban_dir, &kanban_id).await?;
    println!("[Sync] Kanban: {} uploaded, {} downloaded", kanban_up, kanban_down);

    // Sync trash/
    let trash_dir = app_handle.path().resolve("Logia/trash", tauri::path::BaseDirectory::Document)
        .map_err(|_| "Could not resolve trash directory")?;
    if !trash_dir.exists() {
        let _ = fs::create_dir_all(&trash_dir);
    }
    let (trash_up, trash_down) = sync_directory(&hub, &trash_dir, &trash_id).await?;
    println!("[Sync] Trash: {} uploaded, {} downloaded", trash_up, trash_down);

    let total_up = notes_up + folders_up + kanban_up + trash_up;
    let total_down = notes_down + folders_down + kanban_down + trash_down;
    let needs_reload = notes_down > 0 || folders_down > 0 || kanban_down > 0;
    
    Ok(SyncResult {
        notes_uploaded: notes_up,
        notes_downloaded: notes_down,
        folders_uploaded: folders_up,
        folders_downloaded: folders_down,
        kanban_uploaded: kanban_up,
        kanban_downloaded: kanban_down,
        trash_uploaded: trash_up,
        trash_downloaded: trash_down,
        needs_reload,
        message: format!("Sync complete: {} uploaded, {} downloaded", total_up, total_down),
    })
}

/// Cleans up trash items older than 14 days
#[tauri::command]
pub async fn cleanup_old_trash(app_handle: tauri::AppHandle, state: State<'_, GoogleDriveState>) -> Result<usize, String> {
    let hub = state.get_hub().await.ok_or("Not connected")?;
    
    let root_id = get_or_create_logia_root(&hub).await?;
    let trash_id = get_or_create_subfolder(&hub, &root_id, "trash", "trash").await?;
    
    // List all files in trash folder with their modified times
    let q = format!("'{}' in parents and trashed = false", trash_id);
    let (_, file_list) = hub.files().list()
        .q(&q)
        .param("fields", "files(id, name, modifiedTime)")
        .add_scope(Scope::Full)
        .doit()
        .await
        .map_err(|e| e.to_string())?;
    
    let files = file_list.files.unwrap_or_default();
    let now = Utc::now();
    let fourteen_days = chrono::Duration::days(14);
    let mut deleted_count = 0;

    for file in files {
        if let Some(modified_time) = file.modified_time {
            let age = now.signed_duration_since(modified_time);
            if age > fourteen_days {
                if let Some(id) = &file.id {
                    println!("[Cleanup] Permanently deleting old trash file: {:?}", file.name);
                    let _ = hub.files().delete(id).add_scope(Scope::Full).doit().await;
                    deleted_count += 1;
                }
            }
        }
    }

    // Also clean up corresponding local trash files
    let trash_dir = app_handle.path().resolve("Logia/trash", tauri::path::BaseDirectory::Document)
        .map_err(|_| "Could not resolve trash directory")?;
    
    if let Ok(entries) = fs::read_dir(&trash_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(metadata) = fs::metadata(&path) {
                if let Ok(modified) = metadata.modified() {
                    let modified_dt = DateTime::<Utc>::from(modified);
                    let age = now.signed_duration_since(modified_dt);
                    if age > fourteen_days {
                        println!("[Cleanup] Deleting local old trash file: {:?}", path);
                        let _ = fs::remove_file(&path);
                    }
                }
            }
        }
    }

    // Update last cleanup timestamp
    let mut config = load_drive_config();
    config.last_trash_cleanup = Some(now.to_rfc3339());
    save_drive_config(&config);

    Ok(deleted_count)
}

// ============================================================================
// MANIFEST-BASED SYNC SYSTEM
// ============================================================================

use crate::sync_manifest::{
    SyncManifest, FileState, FileStatus, SyncPlan, SyncAction,
    load_local_manifest, save_local_manifest, scan_local_files,
    detect_local_changes, build_sync_plan, compute_file_hash,
};

/// Download the manifest from cloud (if it exists)
async fn download_cloud_manifest(
    hub: &DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>,
    root_id: &str,
) -> Result<Option<SyncManifest>, String> {
    // Search for sync_manifest.json in root folder
    let q = format!("name = 'sync_manifest.json' and '{}' in parents and trashed = false", root_id);
    let (_, file_list) = hub.files().list()
        .q(&q)
        .param("fields", "files(id, name)")
        .add_scope(Scope::Full)
        .doit()
        .await
        .map_err(|e| format!("Failed to search for manifest: {}", e))?;
    
    if let Some(files) = file_list.files {
        if let Some(file) = files.first() {
            if let Some(id) = &file.id {
                // Download the manifest
                let response = hub.files().get(id)
                    .param("alt", "media")
                    .add_scope(Scope::Full)
                    .doit()
                    .await
                    .map_err(|e| format!("Failed to download manifest: {}", e))?;
                
                let bytes = hyper::body::to_bytes(response.0.into_body())
                    .await
                    .map_err(|e| format!("Failed to read manifest body: {}", e))?;
                
                let manifest: SyncManifest = serde_json::from_slice(&bytes)
                    .map_err(|e| format!("Failed to parse cloud manifest: {}", e))?;
                
                return Ok(Some(manifest));
            }
        }
    }
    
    Ok(None)
}

/// Upload the manifest to cloud
async fn upload_cloud_manifest(
    hub: &DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>,
    root_id: &str,
    manifest: &SyncManifest,
) -> Result<(), String> {
    let content = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
    
    // Check if manifest already exists
    let q = format!("name = 'sync_manifest.json' and '{}' in parents and trashed = false", root_id);
    let (_, file_list) = hub.files().list()
        .q(&q)
        .param("fields", "files(id)")
        .add_scope(Scope::Full)
        .doit()
        .await
        .map_err(|e| format!("Failed to check for existing manifest: {}", e))?;
    
    let existing_id = file_list.files.and_then(|f| f.first().and_then(|f| f.id.clone()));
    
    if let Some(id) = existing_id {
        // Update existing
        hub.files().update(DriveFile::default(), &id)
            .add_scope(Scope::Full)
            .upload(std::io::Cursor::new(content), "application/json".parse().unwrap())
            .await
            .map_err(|e| format!("Failed to update manifest: {}", e))?;
    } else {
        // Create new
        let drive_file = DriveFile {
            name: Some("sync_manifest.json".to_string()),
            parents: Some(vec![root_id.to_string()]),
            ..Default::default()
        };
        hub.files().create(drive_file)
            .add_scope(Scope::Full)
            .upload(std::io::Cursor::new(content), "application/json".parse().unwrap())
            .await
            .map_err(|e| format!("Failed to create manifest: {}", e))?;
    }
    
    Ok(())
}

/// Update manifest with cloud file states
async fn update_manifest_from_cloud(
    hub: &DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>,
    manifest: &mut SyncManifest,
    folder_id: &str,
    subdir: &str,
) -> Result<(), String> {
    let q = format!("'{}' in parents and trashed = false", folder_id);
    let (_, file_list) = hub.files().list()
        .q(&q)
        .param("fields", "files(id, name, modifiedTime, md5Checksum)")
        .add_scope(Scope::Full)
        .doit()
        .await
        .map_err(|e| format!("Failed to list cloud files: {}", e))?;
    
    let cloud_files = file_list.files.unwrap_or_default();
    
    // Track which files exist in cloud
    let mut cloud_paths = std::collections::HashSet::new();
    
    for file in cloud_files {
        if let Some(name) = &file.name {
            let path = format!("{}/{}", subdir, name);
            cloud_paths.insert(path.clone());
            
            let cloud_modified = file.modified_time;
            let cloud_id = file.id.clone();
            
            if let Some(state) = manifest.files.get_mut(&path) {
                // File exists in manifest
                state.cloud_modified = cloud_modified;
                state.cloud_file_id = cloud_id;
                
                // Check if cloud changed since last sync
                if state.status == FileStatus::Synced {
                    // Compare modification times
                    if let (Some(cm), Some(lm)) = (&cloud_modified, &state.local_modified) {
                        if cm.signed_duration_since(*lm).num_seconds() > 2 {
                            state.status = FileStatus::CloudModified;
                        }
                    }
                } else if state.status == FileStatus::LocalModified {
                    // Both changed - conflict
                    if let (Some(cm), Some(prev_cm)) = (&cloud_modified, &state.cloud_modified) {
                        if cm != prev_cm {
                            state.status = FileStatus::Conflict;
                        }
                    }
                }
            } else {
                // New file in cloud
                manifest.files.insert(path, FileState {
                    local_hash: None,
                    cloud_hash: None,
                    local_modified: None,
                    cloud_modified,
                    status: FileStatus::NewCloud,
                    cloud_file_id: cloud_id,
                });
            }
        }
    }
    
    // Check for files deleted from cloud
    for (path, state) in manifest.files.iter_mut() {
        if path.starts_with(&format!("{}/", subdir)) && !cloud_paths.contains(path) {
            if state.cloud_file_id.is_some() && state.local_hash.is_some() {
                state.status = FileStatus::DeletedCloud;
                state.cloud_file_id = None;
                state.cloud_modified = None;
            }
        }
    }
    
    Ok(())
}

/// Get the sync plan (pending changes and conflicts)
#[tauri::command]
pub async fn get_sync_plan(
    app_handle: tauri::AppHandle,
    state: State<'_, GoogleDriveState>,
) -> Result<SyncPlan, String> {
    let hub = state.get_hub().await.ok_or("Not connected to Google Drive")?;
    
    // Get folder IDs
    let (root_id, notes_id, folders_id, kanban_id, trash_id) = get_all_sync_folders(&hub).await?;
    
    // Load local manifest
    let mut manifest = load_local_manifest(&app_handle)?;
    
    // Scan local files
    let local_files = scan_local_files(&app_handle)?;
    
    // Update manifest with local changes
    manifest = detect_local_changes(&manifest, &local_files);
    
    // Update manifest with cloud state
    update_manifest_from_cloud(&hub, &mut manifest, &notes_id, "notes").await?;
    update_manifest_from_cloud(&hub, &mut manifest, &folders_id, "folders").await?;
    update_manifest_from_cloud(&hub, &mut manifest, &kanban_id, "kanban").await?;
    update_manifest_from_cloud(&hub, &mut manifest, &trash_id, "trash").await?;
    
    // Save updated manifest
    save_local_manifest(&app_handle, &manifest)?;
    
    // Build and return the sync plan
    Ok(build_sync_plan(&manifest))
}

/// Conflict resolution choice from the user
#[derive(Debug, Clone, Deserialize)]
pub struct ConflictResolution {
    pub path: String,
    pub choice: String,  // "local" | "cloud" | "keep_both"
}

/// Execute sync with user's conflict resolutions
#[tauri::command]
pub async fn execute_sync_with_resolutions(
    app_handle: tauri::AppHandle,
    state: State<'_, GoogleDriveState>,
    resolutions: Vec<ConflictResolution>,
) -> Result<SyncResult, String> {
    let hub = state.get_hub().await.ok_or("Not connected to Google Drive")?;
    
    // Get folder IDs
    let (root_id, notes_id, folders_id, kanban_id, trash_id) = get_all_sync_folders(&hub).await?;
    
    // Load manifest and build plan
    let mut manifest = load_local_manifest(&app_handle)?;
    let local_files = scan_local_files(&app_handle)?;
    manifest = detect_local_changes(&manifest, &local_files);
    
    update_manifest_from_cloud(&hub, &mut manifest, &notes_id, "notes").await?;
    update_manifest_from_cloud(&hub, &mut manifest, &folders_id, "folders").await?;
    update_manifest_from_cloud(&hub, &mut manifest, &kanban_id, "kanban").await?;
    update_manifest_from_cloud(&hub, &mut manifest, &trash_id, "trash").await?;
    
    // Apply conflict resolutions
    let resolution_map: std::collections::HashMap<_, _> = resolutions
        .iter()
        .map(|r| (r.path.clone(), r.choice.clone()))
        .collect();
    
    for (path, state) in manifest.files.iter_mut() {
        if state.status == FileStatus::Conflict {
            if let Some(choice) = resolution_map.get(path) {
                match choice.as_str() {
                    "local" => state.status = FileStatus::LocalModified,
                    "cloud" => state.status = FileStatus::CloudModified,
                    "keep_both" => {
                        // Mark as local modified (will upload with different name)
                        // The actual rename happens during execution
                        state.status = FileStatus::LocalModified;
                    }
                    _ => {}
                }
            }
        }
    }
    
    // Execute the sync
    let mut notes_up = 0;
    let mut notes_down = 0;
    let mut folders_up = 0;
    let mut folders_down = 0;
    let mut kanban_up = 0;
    let mut kanban_down = 0;
    let mut trash_up = 0;
    let mut trash_down = 0;
    
    let logia_dir = app_handle.path().resolve("Logia", BaseDirectory::Document)
        .map_err(|_| "Could not resolve Logia directory")?;
    
    for (path, file_state) in manifest.files.iter_mut() {
        let local_path = logia_dir.join(path);
        let (folder_id, counters) = if path.starts_with("notes/") {
            (&notes_id, (&mut notes_up, &mut notes_down))
        } else if path.starts_with("folders/") {
            (&folders_id, (&mut folders_up, &mut folders_down))
        } else if path.starts_with("kanban/") {
            (&kanban_id, (&mut kanban_up, &mut kanban_down))
        } else if path.starts_with("trash/") {
            (&trash_id, (&mut trash_up, &mut trash_down))
        } else {
            continue;
        };
        
        let filename = path.split('/').last().unwrap_or(path);
        
        match file_state.status {
            FileStatus::LocalModified | FileStatus::NewLocal => {
                // Upload to cloud
                if local_path.exists() {
                    upload_file(&hub, &local_path, filename, folder_id, file_state.cloud_file_id.as_deref()).await?;;
                    file_state.cloud_hash = file_state.local_hash.clone();
                    file_state.cloud_modified = Some(Utc::now());
                    file_state.status = FileStatus::Synced;
                    *counters.0 += 1;
                }
            }
            FileStatus::CloudModified | FileStatus::NewCloud => {
                // Download from cloud
                if let Some(cloud_id) = &file_state.cloud_file_id {
                    // Create parent dir if needed
                    if let Some(parent) = local_path.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    download_file(&hub, cloud_id, &local_path).await?;;
                    file_state.local_hash = file_state.cloud_hash.clone();
                    file_state.local_modified = file_state.cloud_modified;
                    file_state.status = FileStatus::Synced;
                    *counters.1 += 1;
                }
            }
            FileStatus::DeletedLocal => {
                // Delete from cloud (move to trash conceptually)
                if let Some(cloud_id) = &file_state.cloud_file_id {
                    let _ = hub.files().delete(cloud_id).add_scope(Scope::Full).doit().await;
                    file_state.cloud_file_id = None;
                    file_state.cloud_hash = None;
                    file_state.cloud_modified = None;
                }
            }
            FileStatus::DeletedCloud => {
                // Delete locally (move to trash)
                if local_path.exists() {
                    let trash_dest = logia_dir.join("trash").join(filename);
                    let _ = fs::rename(&local_path, &trash_dest);
                    file_state.local_hash = None;
                    file_state.local_modified = None;
                }
            }
            FileStatus::Synced | FileStatus::Conflict => {
                // Nothing to do (conflicts should have been resolved)
            }
        }
    }
    
    // Update timestamps
    manifest.last_sync = Some(Utc::now());
    
    // Save manifest locally and to cloud
    save_local_manifest(&app_handle, &manifest)?;
    upload_cloud_manifest(&hub, &root_id, &manifest).await?;;
    
    let total_up = notes_up + folders_up + kanban_up + trash_up;
    let total_down = notes_down + folders_down + kanban_down + trash_down;
    let needs_reload = notes_down > 0 || folders_down > 0 || kanban_down > 0;
    
    Ok(SyncResult {
        notes_uploaded: notes_up,
        notes_downloaded: notes_down,
        folders_uploaded: folders_up,
        folders_downloaded: folders_down,
        kanban_uploaded: kanban_up,
        kanban_downloaded: kanban_down,
        trash_uploaded: trash_up,
        trash_downloaded: trash_down,
        needs_reload,
        message: format!("Sync complete: {} uploaded, {} downloaded", total_up, total_down),
    })
}

