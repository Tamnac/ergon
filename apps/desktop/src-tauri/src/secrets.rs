use keyring::{Entry, Error};

const SERVICE: &str = "app.ergon.desktop";

#[tauri::command]
pub async fn secret_get(key: String) -> Result<Option<String>, String> {
    match Entry::new(SERVICE, &key).and_then(|entry| entry.get_password()) {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/// Stores the secret, or deletes it if `value` is `None`.
#[tauri::command]
pub async fn secret_set(key: String, value: Option<String>) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    let result = match value {
        Some(value) => entry.set_password(&value),
        None => entry.delete_credential(),
    };
    match result {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
