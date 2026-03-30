mod db;
mod models;
mod parser;
mod yougile;

use tauri::{
    menu::MenuItem,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

#[cfg(desktop)]
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::db::{
    add_checklist_item, create_checklist, create_column, create_tag, create_task, delete_checklist,
    delete_checklist_item, delete_column, delete_tag, delete_task, get_checklists, get_columns,
    get_settings, get_subtasks, get_tags, get_task_tags, get_tasks, get_yougile_sync_state,
    init_database, open_linked_note, reorder_columns, set_task_tags, update_checklist_item,
    update_column, update_settings, update_tag, update_task, update_task_status, update_theme,
    update_yougile_enabled, update_yougile_sync_state, DatabaseState,
};

fn to_tauri_error(message: impl Into<String>) -> tauri::Error {
    tauri::Error::from(std::io::Error::other(message.into()))
}

fn main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    app.get_webview_window("main")
        .ok_or_else(|| to_tauri_error("Main window is not available"))
}

// ── macOS: NSPanel for quick-capture window ─────────────────────────────────

#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(CapturePanel {
        config: {
            can_become_key_window: true
        }
    })
}

#[cfg(target_os = "macos")]
fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    use tauri_nspanel::ManagerExt;
    let panel = app
        .get_webview_panel("main")
        .map_err(|_| to_tauri_error("Panel not found"))?;
    panel.show_and_make_key();
    Ok(())
}

#[cfg(target_os = "macos")]
fn hide_main_window(app: &AppHandle) -> tauri::Result<()> {
    use tauri_nspanel::ManagerExt;
    let panel = app
        .get_webview_panel("main")
        .map_err(|_| to_tauri_error("Panel not found"))?;
    panel.hide();
    Ok(())
}

// ── Non-macOS: standard Tauri window ────────────────────────────────────────

#[cfg(not(target_os = "macos"))]
fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    let window = main_window(app)?;
    if window.is_minimized()? {
        window.unminimize()?;
    }
    window.show()?;
    window.set_focus()?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn hide_main_window(app: &AppHandle) -> tauri::Result<()> {
    let window = main_window(app)?;
    window.hide()?;
    Ok(())
}

// ── Shortcuts, tray, window behavior ────────────────────────────────────────

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

    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_handle.hide();
        }
    });

    Ok(())
}

/// Convert the main window to an NSPanel so it can overlay fullscreen apps.
/// Falls back to a normal window if panel conversion fails (e.g. unsupported macOS version).
#[cfg(target_os = "macos")]
fn setup_capture_panel(app: &AppHandle) -> tauri::Result<()> {
    use tauri_nspanel::{CollectionBehavior, PanelLevel, WebviewWindowExt};

    let window = main_window(app)?;
    let panel = match window.to_panel::<CapturePanel>() {
        Ok(p) => p,
        Err(e) => {
            log::warn!(
                "Failed to convert capture window to NSPanel, falling back to normal window: {e:?}"
            );
            return Ok(());
        }
    };

    // Preserve existing style mask, add NonactivatingPanel so it won't steal
    // activation from the fullscreen app
    let existing_mask = panel.as_panel().styleMask();
    panel.set_style_mask(
        existing_mask | tauri_nspanel::objc2_app_kit::NSWindowStyleMask::NonactivatingPanel,
    );

    // CanJoinAllSpaces + FullScreenAuxiliary = appear over fullscreen apps on all spaces
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .full_screen_auxiliary()
            .into(),
    );

    // PopUpMenu level (101) — high enough to render above fullscreen app content
    panel.set_level(PanelLevel::PopUpMenu.value());

    // Panel behaviors
    panel.set_floating_panel(true);
    panel.set_hides_on_deactivate(false);

    // Override cancelOperation: with a no-op so that pressing Esc in the webview
    // doesn't trigger the NSPanel's native "cancel → hide" behavior.
    // JavaScript handles Esc itself (insert→normal mode, or hide via IPC).
    unsafe {
        use tauri_nspanel::objc2::runtime::{AnyObject, Sel};

        extern "C" fn noop_cancel(_this: *mut AnyObject, _sel: Sel, _sender: *mut AnyObject) {
            // Intentionally empty
        }

        let obj_ptr =
            (panel.as_panel() as *const tauri_nspanel::objc2_app_kit::NSPanel).cast::<AnyObject>();
        let class = tauri_nspanel::objc2::ffi::object_getClass(obj_ptr.cast());
        let sel = Sel::register(c"cancelOperation:");
        let imp: unsafe extern "C-unwind" fn() = std::mem::transmute(noop_cancel as *const ());
        tauri_nspanel::objc2::ffi::class_replaceMethod(
            class.cast_mut(),
            sel,
            imp,
            c"v@:@".as_ptr(),
        );
    }

    Ok(())
}

#[tauri::command]
fn show_window(app: AppHandle) -> Result<String, String> {
    show_main_window(&app).map_err(|error| error.to_string())?;

    Ok("Window is visible.".to_string())
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

    let theme = app.state::<DatabaseState>().current_theme();

    let mut builder = WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Jot Settings")
    .inner_size(850.0, 600.0)
    .center()
    .resizable(false);

    if let Some(theme) = theme {
        builder = builder.theme(Some(theme));
    }

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
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

    let theme = app.state::<DatabaseState>().current_theme();

    let mut builder = WebviewWindowBuilder::new(
        &app,
        "dashboard",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Jot Dashboard")
    .inner_size(1000.0, 700.0)
    .center()
    .resizable(true);

    if let Some(theme) = theme {
        builder = builder.theme(Some(theme));
    }

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    builder
        .build()
        .map_err(|error| format!("Failed to build dashboard window: {error}"))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
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
        );

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    #[cfg(not(target_os = "macos"))]
    let builder = builder;

    builder
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

            #[cfg(target_os = "macos")]
            if let Err(e) = setup_capture_panel(app.handle()) {
                log::warn!("NSPanel setup failed, using normal window: {e}");
            }

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
            update_task,
            delete_task,
            open_linked_note,
            get_columns,
            create_column,
            update_column,
            delete_column,
            reorder_columns,
            update_theme,
            update_yougile_enabled,
            get_yougile_sync_state,
            update_yougile_sync_state,
            get_checklists,
            create_checklist,
            add_checklist_item,
            update_checklist_item,
            delete_checklist,
            delete_checklist_item,
            get_tags,
            create_tag,
            update_tag,
            delete_tag,
            get_task_tags,
            set_task_tags,
            get_subtasks,
            yougile::commands::yougile_login,
            yougile::commands::yougile_add_account,
            yougile::commands::yougile_remove_account,
            yougile::commands::yougile_get_accounts,
            yougile::commands::yougile_get_projects,
            yougile::commands::yougile_get_boards,
            yougile::commands::yougile_get_columns,
            yougile::commands::yougile_get_users,
            yougile::commands::yougile_get_all_users,
            yougile::commands::yougile_get_string_stickers,
            yougile::commands::yougile_get_sprint_stickers,
            yougile::commands::yougile_get_tasks,
            yougile::commands::yougile_get_board_tasks,
            yougile::commands::yougile_create_task,
            yougile::commands::yougile_update_task,
            yougile::commands::yougile_move_task,
            yougile::commands::yougile_delete_task,
            yougile::commands::yougile_get_chat_messages,
            yougile::commands::yougile_send_chat_message,
            yougile::commands::yougile_upload_file,
            yougile::commands::yougile_upload_file_path,
            yougile::commands::yougile_download_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
