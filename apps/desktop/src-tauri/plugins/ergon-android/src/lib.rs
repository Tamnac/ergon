//! Android services the shell needs: the Keystore for secrets, and reminders as exact alarms
//! with the permissions they depend on. The Kotlin side is in `android/`.

use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Runtime};

pub struct Android<R: Runtime>(PluginHandle<R>);

#[derive(Serialize)]
struct Key<'a> {
    key: &'a str,
}

#[derive(Serialize)]
struct Secret<'a> {
    key: &'a str,
    value: Option<&'a str>,
}

#[derive(Deserialize)]
struct Value {
    value: Option<String>,
}

#[derive(Serialize)]
struct Reminders<'a, T> {
    reminders: &'a [T],
}

#[derive(Deserialize)]
struct Allowed {
    allowed: bool,
}

impl<R: Runtime> Android<R> {
    pub fn secret_get(&self, key: &str) -> tauri::Result<Option<String>> {
        let found: Value = self.0.run_mobile_plugin("secretGet", Key { key })?;
        Ok(found.value)
    }

    /// Stores the secret, or deletes it if `value` is `None`.
    pub fn secret_set(&self, key: &str, value: Option<&str>) -> tauri::Result<()> {
        Ok(self.0.run_mobile_plugin("secretSet", Secret { key, value })?)
    }

    /// Asks for the permission to show notifications, if the system requires one. Returns
    /// whether notifications are allowed.
    pub fn allow_notifications(&self) -> tauri::Result<bool> {
        let state: Allowed = self.0.run_mobile_plugin("allowNotifications", ())?;
        Ok(state.allowed)
    }

    /// Makes the alarms match `reminders`: each has `id`, `at` (Unix milliseconds) and `text`.
    /// The system shows them when due, even while the app is closed.
    pub fn set_reminders<T: Serialize>(&self, reminders: &[T]) -> tauri::Result<()> {
        Ok(self
            .0
            .run_mobile_plugin("setReminders", Reminders { reminders })?)
    }

    /// Whether alarms may fire at their exact time. Without it they can be late by minutes.
    pub fn exact_alarms_allowed(&self) -> tauri::Result<bool> {
        let state: Allowed = self.0.run_mobile_plugin("exactAlarmsAllowed", ())?;
        Ok(state.allowed)
    }

    /// Opens the system page where the user grants the exact alarm permission.
    pub fn open_exact_alarm_settings(&self) -> tauri::Result<()> {
        Ok(self.0.run_mobile_plugin("openExactAlarmSettings", ())?)
    }
}

pub trait AndroidExt<R: Runtime> {
    fn android(&self) -> &Android<R>;
}

impl<R: Runtime, T: Manager<R>> AndroidExt<R> for T {
    fn android(&self) -> &Android<R> {
        self.state::<Android<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ergon-android")
        .setup(|app, api| {
            let handle = api.register_android_plugin("app.ergon.plugin", "ErgonPlugin")?;
            app.manage(Android(handle));
            Ok(())
        })
        .build()
}
