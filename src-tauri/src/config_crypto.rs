use std::fs;
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::Manager;
use keyring::Entry;
use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::{Aead, KeyInit};
use base64::{Engine as _, engine::general_purpose};
use rand::Rng;

use crate::atomic_write_file;

// Keyring service for the encryption master key
const KEYRING_SERVICE_MASTER: &str = "Logia";
const KEYRING_USERNAME_MASTER: &str = "encryption_master_key";

/// Get or create the per-installation encryption key.
///
/// **Design**: keyring is the primary store (Windows Credential Manager,
/// macOS Keychain, Linux Secret Service).  Only if keyring `set_password`
/// fails do we fall back to a local file `.encryption_key` with restrictive
/// Unix permissions (0o600).  The file fallback is less secure because the
/// key lives on disk in the clear, so we emit a warning when it is used.
fn get_or_create_encryption_key(app_handle: &tauri::AppHandle) -> Result<[u8; 32], String> {
    // 1. Try to get existing key from keyring (preferred)
    if let Ok(entry) = Entry::new(KEYRING_SERVICE_MASTER, KEYRING_USERNAME_MASTER) {
        if let Ok(key_b64) = entry.get_password() {
            if let Ok(key_bytes) = general_purpose::STANDARD.decode(&key_b64) {
                if key_bytes.len() == 32 {
                    let mut key = [0u8; 32];
                    key.copy_from_slice(&key_bytes);
                    return Ok(key);
                }
            }
        }
    }

    // 2. Key not in keyring — check file fallback
    let config_dir = get_config_directory(app_handle)?;
    let key_file = config_dir.join(".encryption_key");
    
    if key_file.exists() {
        if let Ok(content) = fs::read_to_string(&key_file) {
            if let Ok(key_bytes) = general_purpose::STANDARD.decode(content.trim()) {
                if key_bytes.len() == 32 {
                    let mut key = [0u8; 32];
                    key.copy_from_slice(&key_bytes);
                    // Try to migrate into keyring so future reads can skip the file
                    let key_b64 = general_purpose::STANDARD.encode(&key);
                    if let Ok(entry) = Entry::new(KEYRING_SERVICE_MASTER, KEYRING_USERNAME_MASTER) {
                        let _ = entry.set_password(&key_b64);
                    }
                    // Ensure restrictive permissions even on pre-existing file
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let _ = fs::set_permissions(&key_file, fs::Permissions::from_mode(0o600));
                    }
                    return Ok(key);
                }
            }
        }
    }

    // 3. No key exists — generate a new one
    let mut key = [0u8; 32];
    rand::thread_rng().fill(&mut key);
    let key_b64 = general_purpose::STANDARD.encode(&key);
    
    // Try to store in keyring first
    let keyring_ok = match Entry::new(KEYRING_SERVICE_MASTER, KEYRING_USERNAME_MASTER) {
        Ok(entry) => entry.set_password(&key_b64).is_ok(),
        Err(_) => false,
    };
    
    if !keyring_ok {
        // Keyring unavailable — fall back to file with restrictive permissions
        eprintln!("WARNING: OS keyring unavailable. Storing encryption key in file fallback ({}). This is less secure.", key_file.display());
        println!("WARNING: OS keyring unavailable — using .encryption_key file fallback (less secure)");
        
        fs::write(&key_file, &key_b64)
            .map_err(|e| format!("Failed to store encryption key: {}", e))?;
        
        // Set restrictive permissions on Unix (owner read/write only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Err(e) = fs::set_permissions(&key_file, fs::Permissions::from_mode(0o600)) {
                eprintln!("WARNING: Could not set restrictive permissions on {}: {}", key_file.display(), e);
            }
        }
    }
    
    Ok(key)
}

pub(crate) fn encrypt_api_key(app_handle: &tauri::AppHandle, plaintext: &str) -> Result<String, String> {
    let key_bytes = get_or_create_encryption_key(app_handle)?;
    let cipher_key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(cipher_key);
    
    // Generate random 12-byte nonce
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // Prepend nonce to ciphertext (nonce doesn't need to be secret)
    let mut combined = nonce_bytes.to_vec();
    combined.extend(ciphertext);
    
    Ok(general_purpose::STANDARD.encode(combined))
}

pub(crate) fn decrypt_api_key(app_handle: &tauri::AppHandle, encrypted: &str) -> Result<String, String> {
    let key_bytes = get_or_create_encryption_key(app_handle)?;
    let cipher_key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(cipher_key);

    let combined = general_purpose::STANDARD.decode(encrypted)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;
    
    if combined.len() < 12 {
        return Err("Invalid encrypted data: too short".to_string());
    }
    
    // Extract nonce (first 12 bytes) and ciphertext (rest)
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher.decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))?;

    String::from_utf8(plaintext)
        .map_err(|e| format!("UTF-8 decode failed: {}", e))
}

fn get_config_directory(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app_handle
        .path()
        .resolve("Logia", BaseDirectory::AppConfig)
        .map_err(|_| "Could not find config directory")?;

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory:{}", e))?;
    }

    Ok(config_dir)
}

// Keyring helpers: try keyring first, fallback to encrypted config file when unavailable
fn try_get_keyring(service: &str, username: &str) -> Option<String> {
    if let Ok(entry) = Entry::new(service, username) {
        if let Ok(pw) = entry.get_password() {
            return Some(pw);
        }
    }
    None
}

fn try_set_keyring(service: &str, username: &str, secret: &str) -> bool {
    if let Ok(entry) = Entry::new(service, username) {
        return entry.set_password(secret).is_ok();
    }
    false
}

fn try_delete_keyring(service: &str, username: &str) -> bool {
    if let Ok(entry) = Entry::new(service, username) {
        // older/newer API differences: try both methods if available
        let _ = entry.delete_credential();
        // delete_credential returns Result<(), _> in some versions; ignore errors
        return true;
    }
    false
}

// Service used for storing AI provider API keys
const KEYRING_SERVICE: &str = "Logia";

/// Provider ids come from the frontend; keep them to a safe charset because
/// they end up in keyring usernames and config.json field names.
fn validate_provider(provider: &str) -> Result<(), String> {
    let ok = !provider.is_empty()
        && provider.len() <= 32
        && provider
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    if ok {
        Ok(())
    } else {
        Err(format!("Invalid provider id: {}", provider))
    }
}

/// Google keeps its original storage names so existing installs keep working.
fn keyring_username(provider: &str) -> String {
    if provider == "google" {
        "google_api_key".to_string()
    } else {
        format!("ai_key_{}", provider)
    }
}

fn encrypted_field(provider: &str) -> String {
    if provider == "google" {
        "encrypted_google_api_key".to_string()
    } else {
        format!("encrypted_ai_key_{}", provider)
    }
}

/// Legacy plain-text field (only Google ever used one).
fn legacy_plain_field(provider: &str) -> Option<&'static str> {
    if provider == "google" {
        Some("google_api_key")
    } else {
        None
    }
}

fn read_config(config_file: &PathBuf) -> serde_json::Value {
    fs::read_to_string(config_file)
        .ok()
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .unwrap_or(serde_json::json!({}))
}

fn write_config(config_file: &PathBuf, config: &serde_json::Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    atomic_write_file(config_file, &content)
}

fn has_key_for(app_handle: &tauri::AppHandle, provider: &str) -> Result<bool, String> {
    validate_provider(provider)?;
    if try_get_keyring(KEYRING_SERVICE, &keyring_username(provider)).is_some() {
        return Ok(true);
    }
    let config_file = get_config_directory(app_handle)?.join("config.json");
    if config_file.exists() {
        let config = read_config(&config_file);
        if config.get(encrypted_field(provider)).is_some() {
            return Ok(true);
        }
        if let Some(legacy) = legacy_plain_field(provider) {
            if config.get(legacy).is_some() {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn get_key_for(app_handle: &tauri::AppHandle, provider: &str) -> Result<String, String> {
    validate_provider(provider)?;
    let username = keyring_username(provider);
    // Try keyring first (Windows Credential Manager, macOS Keychain, Linux Secret Service)
    if let Some(pw) = try_get_keyring(KEYRING_SERVICE, &username) {
        return Ok(pw);
    }

    // Fallback: encrypted copy in config.json
    let config_file = get_config_directory(app_handle)?.join("config.json");
    if config_file.exists() {
        let config = read_config(&config_file);

        if let Some(encrypted_key) = config.get(encrypted_field(provider)).and_then(|v| v.as_str()) {
            let key = decrypt_api_key(app_handle, encrypted_key)?;
            // Try to migrate into keyring for future
            let _ = try_set_keyring(KEYRING_SERVICE, &username, &key);
            return Ok(key);
        }

        // Legacy: plain key — migrate to keyring + encrypted form
        if let Some(legacy) = legacy_plain_field(provider) {
            if let Some(plain_key) = config.get(legacy).and_then(|v| v.as_str()) {
                if try_set_keyring(KEYRING_SERVICE, &username, plain_key) {
                    let mut updated_config = config.clone();
                    if let Some(obj) = updated_config.as_object_mut() {
                        obj.remove(legacy);
                        if let Ok(encrypted) = encrypt_api_key(app_handle, plain_key) {
                            obj.insert(encrypted_field(provider), serde_json::Value::String(encrypted));
                        }
                    }
                    let _ = write_config(&config_file, &updated_config);
                }
                return Ok(plain_key.to_string());
            }
        }
    }

    Err("API key not configured".to_string())
}

fn save_key_for(app_handle: &tauri::AppHandle, provider: &str, key: &str) -> Result<(), String> {
    validate_provider(provider)?;
    let keyring_ok = try_set_keyring(KEYRING_SERVICE, &keyring_username(provider), key);

    // Always persist an encrypted copy to config.json as a fallback for
    // dev/reload scenarios and machines without a keyring.
    let encrypted_key = encrypt_api_key(app_handle, key)?;
    let config_file = get_config_directory(app_handle)?.join("config.json");
    let mut config = read_config(&config_file);
    if let Some(obj) = config.as_object_mut() {
        obj.insert(encrypted_field(provider), serde_json::Value::String(encrypted_key));
        if let Some(legacy) = legacy_plain_field(provider) {
            obj.remove(legacy);
        }
    }

    let result = write_config(&config_file, &config);
    if keyring_ok {
        // Keyring holds the key; the config copy is best-effort.
        Ok(())
    } else {
        result
    }
}

fn remove_key_for(app_handle: &tauri::AppHandle, provider: &str) -> Result<(), String> {
    validate_provider(provider)?;
    let _ = try_delete_keyring(KEYRING_SERVICE, &keyring_username(provider));

    let config_file = get_config_directory(app_handle)?.join("config.json");
    if config_file.exists() {
        let mut config = read_config(&config_file);
        if let Some(obj) = config.as_object_mut() {
            obj.remove(&encrypted_field(provider));
            if let Some(legacy) = legacy_plain_field(provider) {
                obj.remove(legacy);
            }
        }
        write_config(&config_file, &config)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn has_ai_key(provider: String, app_handle: tauri::AppHandle) -> Result<bool, String> {
    has_key_for(&app_handle, &provider)
}

/// Which of the given providers have a stored key.
#[tauri::command]
pub async fn ai_keys_status(
    providers: Vec<String>,
    app_handle: tauri::AppHandle,
) -> Result<std::collections::HashMap<String, bool>, String> {
    let mut out = std::collections::HashMap::new();
    for p in providers {
        let has = has_key_for(&app_handle, &p).unwrap_or(false);
        out.insert(p, has);
    }
    Ok(out)
}

#[tauri::command]
pub async fn get_ai_key(provider: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    get_key_for(&app_handle, &provider)
}

#[tauri::command]
pub async fn save_ai_key(provider: String, key: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    save_key_for(&app_handle, &provider, &key)
}

#[tauri::command]
pub async fn remove_ai_key(provider: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    remove_key_for(&app_handle, &provider)
}

// Google-specific commands kept for backwards compatibility.

#[tauri::command]
pub async fn has_google_api_key(app_handle: tauri::AppHandle) -> Result<bool, String> {
    has_key_for(&app_handle, "google")
}

#[tauri::command]
pub async fn get_google_api_key(app_handle: tauri::AppHandle) -> Result<String, String> {
    get_key_for(&app_handle, "google")
}

#[tauri::command]
pub async fn save_google_api_key(key: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    save_key_for(&app_handle, "google", &key)
}

#[tauri::command]
pub async fn remove_google_api_key(app_handle: tauri::AppHandle) -> Result<(), String> {
    remove_key_for(&app_handle, "google")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_ids_are_validated() {
        assert!(validate_provider("openai").is_ok());
        assert!(validate_provider("open-router_2").is_ok());
        assert!(validate_provider("").is_err());
        assert!(validate_provider("../etc").is_err());
        assert!(validate_provider("OpenAI").is_err());
    }

    #[test]
    fn google_keeps_legacy_storage_names() {
        assert_eq!(keyring_username("google"), "google_api_key");
        assert_eq!(encrypted_field("google"), "encrypted_google_api_key");
        assert_eq!(keyring_username("openai"), "ai_key_openai");
        assert_eq!(encrypted_field("openai"), "encrypted_ai_key_openai");
        assert_eq!(legacy_plain_field("openai"), None);
    }
}
