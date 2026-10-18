#[cfg(desktop)]
mod store {
    use keyring::{Entry, Error};

    const SERVICE: &str = "app.ergon.desktop";

    pub fn get(key: &str) -> Result<Option<String>, String> {
        match Entry::new(SERVICE, key).and_then(|entry| entry.get_password()) {
            Ok(value) => Ok(Some(value)),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn set(key: &str, value: Option<&str>) -> Result<(), String> {
        let entry = Entry::new(SERVICE, key).map_err(|e| e.to_string())?;
        let result = match value {
            Some(value) => entry.set_password(value),
            None => entry.delete_credential(),
        };
        match result {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

/// The Android Keystore, through the Kotlin plugin.
#[cfg(target_os = "android")]
mod store {
    pub fn get(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
        use tauri_plugin_ergon_android::AndroidExt;
        app.android().secret_get(key).map_err(|e| e.to_string())
    }

    pub fn set(app: &tauri::AppHandle, key: &str, value: Option<&str>) -> Result<(), String> {
        use tauri_plugin_ergon_android::AndroidExt;
        app.android()
            .secret_set(key, value)
            .map_err(|e| e.to_string())
    }
}

#[cfg(desktop)]
#[tauri::command]
pub async fn secret_get(key: String) -> Result<Option<String>, String> {
    store::get(&key)
}

/// Stores the secret, or deletes it if `value` is `None`.
#[cfg(desktop)]
#[tauri::command]
pub async fn secret_set(key: String, value: Option<String>) -> Result<(), String> {
    store::set(&key, value.as_deref())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn secret_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    store::get(&app, &key)
}

/// Stores the secret, or deletes it if `value` is `None`.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn secret_set(
    app: tauri::AppHandle,
    key: String,
    value: Option<String>,
) -> Result<(), String> {
    store::set(&app, &key, value.as_deref())
}
