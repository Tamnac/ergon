use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

use tauri::{App, AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Opens the window with the add input focused.
const QUICK_ADD_SHORTCUT: &str = "CommandOrControl+Shift+Space";
const QUICK_ADD_EVENT: &str = "quick-add";

/// Whether the quick-add shortcut was registered; another app may already own it.
pub struct ShortcutStatus(AtomicBool);

#[tauri::command]
pub fn quick_add_shortcut_registered(status: State<'_, ShortcutStatus>) -> bool {
    status.0.load(Ordering::Relaxed)
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn quick_add(app: &AppHandle) {
    show_main(app);
    let _ = app.emit(QUICK_ADD_EVENT, ());
}

/// Tray icon with menu, and the global quick-add shortcut.
pub fn setup(app: &App) -> tauri::Result<()> {
    let add = MenuItem::with_id(app, "add", "New todo", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Ergon", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&add, &open, &quit])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("Ergon")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "add" => quick_add(app),
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    let registered = app
        .global_shortcut()
        .on_shortcut(QUICK_ADD_SHORTCUT, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                quick_add(app);
            }
        });
    if let Err(error) = &registered {
        eprintln!("could not register {QUICK_ADD_SHORTCUT}: {error}");
    }
    app.manage(ShortcutStatus(AtomicBool::new(registered.is_ok())));
    Ok(())
}
