mod db;
mod models;
mod parser;

use tauri::{
    menu::MenuItem,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

#[cfg(desktop)]
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::db::{
    create_task, delete_task, get_settings, get_tasks, init_database, open_linked_note,
    update_settings, update_task_status,
};

fn to_tauri_error(message: impl Into<String>) -> tauri::Error {
    tauri::Error::from(std::io::Error::other(message.into()))
}

fn main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    app.get_webview_window("main")
        .ok_or_else(|| to_tauri_error("Main window is not available"))
}

fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    let window = main_window(app)?;

    if window.is_minimized()? {
        window.unminimize()?;
    }

    window.show()?;
    window.set_focus()?;

    Ok(())
}

fn hide_main_window(app: &AppHandle) -> tauri::Result<()> {
    let window = main_window(app)?;

    window.hide()?;

    Ok(())
}

#[cfg(desktop)]
fn register_main_shortcut(app: &AppHandle) -> tauri::Result<()> {
    let capture_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    let dashboard_shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);

    let global_shortcut = app.global_shortcut();

    global_shortcut
        .register(capture_shortcut)
        .map_err(|error| to_tauri_error(error.to_string()))?;

    global_shortcut
        .register(dashboard_shortcut)
        .map_err(|error| to_tauri_error(error.to_string()))?;

    Ok(())
}

#[cfg(desktop)]
fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Show Jot", true, None::<&str>)?;
    let dashboard_item = MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide", "Hide Jot", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu =
        tauri::menu::Menu::with_items(app, &[&show_item, &dashboard_item, &hide_item, &quit_item])?;

    TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                let _ = show_main_window(app);
            }
            "dashboard" => {
                let _ = open_dashboard_window(app.clone());
            }
            "hide" => {
                let _ = hide_main_window(app);
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn setup_main_window_behavior(app: &AppHandle) -> tauri::Result<()> {
    let window = main_window(app)?;
    let window_handle = window.clone();

    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window_handle.hide();
        }
        _ => {}
    });

    Ok(())
}

#[tauri::command]
fn show_window(app: AppHandle) -> Result<String, String> {
    show_main_window(&app).map_err(|error| error.to_string())?;

    Ok("Window is visible and focused.".to_string())
}

#[tauri::command]
fn hide_window(app: AppHandle) -> Result<String, String> {
    hide_main_window(&app).map_err(|error| error.to_string())?;

    Ok("Window is hidden.".to_string())
}

#[tauri::command]
fn open_settings_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Jot Settings")
    .inner_size(850.0, 600.0)
    .center()
    .resizable(false)
    .hidden_title(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay);
    }

    builder
        .build()
        .map_err(|error| format!("Failed to build settings window: {error}"))?;

    Ok(())
}

#[tauri::command]
fn open_dashboard_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("dashboard") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(
        &app,
        "dashboard",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Jot Dashboard")
    .inner_size(1000.0, 700.0)
    .center()
    .resizable(true)
    .hidden_title(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay);
    }

    builder
        .build()
        .map_err(|error| format!("Failed to build dashboard window: {error}"))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let capture_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
                    let dashboard_shortcut =
                        Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);

                    if event.state() == ShortcutState::Pressed {
                        if shortcut == &capture_shortcut {
                            let _ = show_main_window(app);
                        } else if shortcut == &dashboard_shortcut {
                            let _ = open_dashboard_window(app.clone());
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            init_database(app.handle()).map_err(to_tauri_error)?;
            setup_main_window_behavior(app.handle())?;

            #[cfg(desktop)]
            {
                setup_tray(app.handle())?;
                register_main_shortcut(app.handle())?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            show_window,
            hide_window,
            open_settings_window,
            open_dashboard_window,
            create_task,
            get_tasks,
            get_settings,
            update_settings,
            update_task_status,
            delete_task,
            open_linked_note
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
