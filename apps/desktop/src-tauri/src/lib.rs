mod db;
mod reminders;
mod secrets;
#[cfg(desktop)]
mod shell;

use tauri::Manager;
#[cfg(desktop)]
use tauri_plugin_autostart::MacosLauncher;
#[cfg(desktop)]
use tauri_plugin_window_state::StateFlags;

/// Passed by autostart so the app starts in the tray instead of opening a window.
#[cfg(desktop)]
const MINIMIZED: &str = "--minimized";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            shell::show_main(app);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![MINIMIZED]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            db::sql_exec,
            db::sql_query,
            secrets::secret_get,
            secrets::secret_set,
            reminders::set_reminders,
            shell::quick_add_shortcut_registered,
        ]);

    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(tauri_plugin_ergon_android::init())
        .invoke_handler(tauri::generate_handler![
            db::sql_exec,
            db::sql_query,
            secrets::secret_get,
            secrets::secret_set,
            reminders::set_reminders,
            reminders::allow_reminders,
            reminders::exact_alarms_allowed,
            reminders::open_exact_alarm_settings,
        ]);

    builder
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(db::Db::open(&dir.join("ergon.db"))?);
            #[cfg(desktop)]
            {
                shell::setup(app)?;
                reminders::setup(app);
                if !std::env::args().any(|arg| arg == MINIMIZED) {
                    shell::show_main(app.handle());
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Ergon")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                shell::show_main(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
