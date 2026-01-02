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
    pub hub: Arc<Mutex<Option<DriveHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>>>>,
}

impl GoogleDriveState {
    pub fn new() -> Self {
        Self {
            hub: Arc::new(Mutex::new(None)),
        }
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
        redirect_uris: vec!["http://localhost:8080".to_string()],
        ..Default::default()
    };

    let auth = InstalledFlowAuthenticator::builder(
        secret,
        InstalledFlowReturnMethod::HTTPRedirect,
    )
    .persist_tokens_to_disk(token_path)
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
    let hub = create_drive_hub().await?;
    // Manually open the browser for OAuth since the library's automatic opening doesn't work on Windows
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/auth?client_id={}&redirect_uri=http://localhost:8080&scope=https://www.googleapis.com/auth/drive&response_type=code&access_type=offline",
        GOOGLE_CLIENT_ID
    );
    if let Err(e) = open::that(&auth_url) {
        println!("Failed to open browser: {}", e);
    }
    // CRITICAL: Add full scope to ensure we request https://www.googleapis.com/auth/drive
    // This triggers the OAuth flow with the correct scope on first run
    let _ = hub.files().list()
        .page_size(1)
        .add_scope(Scope::Full)  // Explicitly request full Drive access
        .doit()
        .await
        .map_err(|e| e.to_string())?;

    *state.hub.lock().await = Some(hub);

    Ok(AuthStatus { is_authenticated: true, user_email: None })
}

#[tauri::command]
pub async fn get_google_drive_status(state: State<'_, GoogleDriveState>) -> Result<AuthStatus, String> {
    let hub_opt = state.hub.lock().await;
    let is_auth = hub_opt.is_some();
    // We could try to get email here if connected
    Ok(AuthStatus { is_authenticated: is_auth, user_email: None })
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
    let hub_opt = state.hub.lock().await;
    let hub = hub_opt.as_ref().ok_or("Not connected")?; // Note: This holds the lock for the whole sync? Ideally verify connection then release lock, but DriveHub is not Clone easily without the Arc. 
    // Actually DriveHub uses Arc internally for client/auth so it is cheap to clone? No, DriveHub does not implement Clone. 
    // We'll keep the lock or we need to handle this better. Since sync is single-threaded per user request, holding the lock is fine for now but blocks other drive ops.
    
    let logia_folder_id = get_target_sync_folder(hub).await?;

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
                     upload_file(hub, &path, &name, &logia_folder_id, Some(&remote_file.id.as_ref().unwrap())).await?;
                 } else if remote_modified.signed_duration_since(local_modified).num_seconds() > 2 {
                     // Remote is newer -> Download
                     println!("Downloading newer remote: {}", name);
                     download_file(hub, &remote_file.id.as_ref().unwrap(), &path).await?;
                 }
                 // Else: synced
             } else {
                 // Not in remote -> Upload (New)
                 println!("Uploading new file: {}", name);
                 upload_file(hub, &path, &name, &logia_folder_id, None).await?;
             }
        }
    }

    // Loop remaining Remote (Download if missing locally)
    for (name, remote_file) in remote_map {
        if !processed_remotes.contains(&name) {
            // Missing locally
            println!("Downloading missing local: {}", name);
            let target_path = notes_dir.join(&name);
            download_file(hub, &remote_file.id.unwrap(), &target_path).await?;
        }
    }

    Ok("Sync completed successfully".to_string())
}

#[tauri::command]
pub async fn check_sync_status(app_handle: tauri::AppHandle, state: State<'_, GoogleDriveState>) -> Result<SyncStatus, String> {
    let hub_opt = state.hub.lock().await;
    let hub = hub_opt.as_ref().ok_or("Not connected")?;
    
    let logia_folder_id = get_target_sync_folder(hub).await?;

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
    let hub_opt = state.hub.lock().await;
    let hub = hub_opt.as_ref().ok_or("Not connected")?;
    
    let logia_folder_id = get_target_sync_folder(hub).await?;
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
            download_file(hub, &id, &target_path).await?;
        }
    }

    Ok(format!("Downloaded {} files from cloud", file_count))
}

#[tauri::command]
pub async fn force_sync_to_cloud(app_handle: tauri::AppHandle, state: State<'_, GoogleDriveState>) -> Result<String, String> {
    let hub_opt = state.hub.lock().await;
    let hub = hub_opt.as_ref().ok_or("Not connected")?;
    
    let logia_folder_id = get_target_sync_folder(hub).await?;
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
            upload_file(hub, &path, &name, &logia_folder_id, None).await?;
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
                        // Remote is newer -> Download
                        download_file(hub, remote_file.id.as_ref().unwrap(), &path).await?;
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
pub async fn sync_all_to_google_drive(app_handle: tauri::AppHandle, state: State<'_, GoogleDriveState>) -> Result<String, String> {
    let hub_opt = state.hub.lock().await;
    let hub = hub_opt.as_ref().ok_or("Not connected")?;
    
    let (_root_id, notes_id, folders_id, kanban_id, trash_id) = get_all_sync_folders(hub).await?;

    // Sync notes/
    let notes_dir = resolve_notes_path(&app_handle)?;
    let (notes_up, notes_down) = sync_directory(hub, &notes_dir, &notes_id).await?;
    println!("[Sync] Notes: {} uploaded, {} downloaded", notes_up, notes_down);

    // Sync folders/
    let folders_dir = app_handle.path().resolve("Logia/folders", tauri::path::BaseDirectory::Document)
        .map_err(|_| "Could not resolve folders directory")?;
    if !folders_dir.exists() {
        let _ = fs::create_dir_all(&folders_dir);
    }
    let (folders_up, folders_down) = sync_directory(hub, &folders_dir, &folders_id).await?;
    println!("[Sync] Folders: {} uploaded, {} downloaded", folders_up, folders_down);

    // Sync kanban/ (special: single data.json file)
    let kanban_dir = app_handle.path().resolve("Logia/kanban", tauri::path::BaseDirectory::Document)
        .map_err(|_| "Could not resolve kanban directory")?;
    if !kanban_dir.exists() {
        let _ = fs::create_dir_all(&kanban_dir);
    }
    let (kanban_up, kanban_down) = sync_directory(hub, &kanban_dir, &kanban_id).await?;
    println!("[Sync] Kanban: {} uploaded, {} downloaded", kanban_up, kanban_down);

    // Sync trash/
    let trash_dir = app_handle.path().resolve("Logia/trash", tauri::path::BaseDirectory::Document)
        .map_err(|_| "Could not resolve trash directory")?;
    if !trash_dir.exists() {
        let _ = fs::create_dir_all(&trash_dir);
    }
    let (trash_up, trash_down) = sync_directory(hub, &trash_dir, &trash_id).await?;
    println!("[Sync] Trash: {} uploaded, {} downloaded", trash_up, trash_down);

    let total_up = notes_up + folders_up + kanban_up + trash_up;
    let total_down = notes_down + folders_down + kanban_down + trash_down;
    
    Ok(format!("Sync complete: {} uploaded, {} downloaded", total_up, total_down))
}

/// Cleans up trash items older than 14 days
#[tauri::command]
pub async fn cleanup_old_trash(app_handle: tauri::AppHandle, state: State<'_, GoogleDriveState>) -> Result<usize, String> {
    let hub_opt = state.hub.lock().await;
    let hub = hub_opt.as_ref().ok_or("Not connected")?;
    
    let root_id = get_or_create_logia_root(hub).await?;
    let trash_id = get_or_create_subfolder(hub, &root_id, "trash", "trash").await?;
    
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
