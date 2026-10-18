//! Notifications for upcoming reminders. The page hands over the next few with
//! `set_reminders`; they are shown from here, so they work offline and while the window is
//! hidden. Desktop keeps them in a thread, Android in alarms that outlive the process.

#[cfg(desktop)]
mod desktop;

use serde::{Deserialize, Serialize};

/// A reminder due at `at`, in Unix milliseconds.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Reminder {
    pub id: String,
    pub at: u64,
    pub text: String,
}

#[cfg(desktop)]
pub use desktop::setup;

#[cfg(desktop)]
#[tauri::command]
pub fn set_reminders(
    scheduler: tauri::State<'_, std::sync::Arc<desktop::Scheduler>>,
    reminders: Vec<Reminder>,
) {
    scheduler.set(reminders);
}

#[cfg(target_os = "android")]
mod android {
    use tauri_plugin_ergon_android::AndroidExt;

    use super::Reminder;

    #[tauri::command]
    pub async fn set_reminders(
        app: tauri::AppHandle,
        reminders: Vec<Reminder>,
    ) -> Result<(), String> {
        app.android()
            .set_reminders(&reminders)
            .map_err(|e| e.to_string())
    }

    /// Asks for the permission to show notifications, which the user may deny.
    #[tauri::command]
    pub async fn allow_reminders(app: tauri::AppHandle) -> Result<(), String> {
        match app.android().allow_notifications() {
            Ok(true) => Ok(()),
            Ok(false) => Err(
                "Notifications are blocked for Ergon. Allow them in the system settings.".into(),
            ),
            Err(error) => Err(error.to_string()),
        }
    }

    #[tauri::command]
    pub async fn exact_alarms_allowed(app: tauri::AppHandle) -> Result<bool, String> {
        app.android()
            .exact_alarms_allowed()
            .map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub async fn open_exact_alarm_settings(app: tauri::AppHandle) -> Result<(), String> {
        app.android()
            .open_exact_alarm_settings()
            .map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "android")]
pub use android::*;
