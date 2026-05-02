use std::fs::OpenOptions;
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};
use serde_json::json;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn now_ms() -> u128 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|value| value.as_millis())
    .unwrap_or(0)
}

fn write_debug_log(line: &str) {
  if let Ok(mut file) = OpenOptions::new()
    .create(true)
    .append(true)
    .open("C:\\Users\\Аслан\\TeachEye\\debug-ffe9af.log")
  {
    let _ = file.write_all(line.as_bytes());
  }
}

fn write_agent_debug_log(line: &str) {
  if let Ok(mut file) = OpenOptions::new()
    .create(true)
    .append(true)
    .open("C:\\Users\\Аслан\\TeachEye\\debug-d405cf.log")
  {
    let _ = file.write_all(line.as_bytes());
  }
}

#[tauri::command]
fn append_debug_log(line: String) -> Result<(), String> {
  let mut file = OpenOptions::new()
    .create(true)
    .append(true)
    .open("C:\\Users\\Аслан\\TeachEye\\debug-ffe9af.log")
    .map_err(|error| error.to_string())?;
  file.write_all(line.as_bytes()).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_surface_window(
  app: tauri::AppHandle,
  label: String,
  role: String,
  surface: String,
) -> Result<(), String> {
  write_agent_debug_log(
    format!(
      "{{\"sessionId\":\"d405cf\",\"runId\":\"pre-fix\",\"hypothesisId\":\"H5\",\"location\":\"src-tauri/src/lib.rs:43\",\"message\":\"open_surface_window_called\",\"data\":{{\"label\":\"{}\",\"role\":\"{}\",\"surface\":\"{}\"}},\"timestamp\":{}}}\n",
      label,
      role,
      surface,
      now_ms()
    )
    .as_str(),
  );
  write_debug_log(
    format!(
      "{{\"sessionId\":\"ffe9af\",\"runId\":\"pre-fix\",\"hypothesisId\":\"H1\",\"location\":\"src-tauri/src/lib.rs:24\",\"message\":\"open_surface_window:begin\",\"data\":{{\"label\":\"{}\",\"role\":\"{}\",\"surface\":\"{}\"}},\"timestamp\":{}}}\n",
      label,
      role,
      surface,
      now_ms()
    )
    .as_str(),
  );
  if let Some(window) = app.get_webview_window(&label) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    write_debug_log(
      format!(
        "{{\"sessionId\":\"ffe9af\",\"runId\":\"pre-fix\",\"hypothesisId\":\"H4\",\"location\":\"src-tauri/src/lib.rs:35\",\"message\":\"open_surface_window:existing\",\"data\":{{\"label\":\"{}\"}},\"timestamp\":{}}}\n",
        label,
        now_ms()
      )
      .as_str(),
    );
    return Ok(());
  }

  // Load exactly `index.html` (no `?query` / extra path junk). `?` in the App URL breaks resolution on the
  // custom protocol and yields a blank webview. Window kind is injected before page script runs.
  let (title, width, height) = match (role.as_str(), surface.as_str()) {
    ("student", _) => ("TeachEye Student", 1440.0, 920.0),
    ("teacher", "control") => ("TeachEye Teacher Control", 1500.0, 980.0),
    _ => ("TeachEye Teacher Board", 1680.0, 1020.0),
  };

  let initialization_script = format!(
    "window.__TEACHEYE_WINDOW_PARAMS__ = {};",
    json!({ "role": role, "surface": surface })
  );

  let result = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
    .title(title)
    .inner_size(width, height)
    .min_inner_size(1100.0, 720.0)
    .resizable(true)
    .initialization_script(&initialization_script)
    .build();

  match result {
    Ok(_) => {
      write_agent_debug_log(
        format!(
          "{{\"sessionId\":\"d405cf\",\"runId\":\"pre-fix\",\"hypothesisId\":\"H5\",\"location\":\"src-tauri/src/lib.rs:98\",\"message\":\"open_surface_window_built\",\"data\":{{\"label\":\"{}\",\"role\":\"{}\",\"surface\":\"{}\",\"url\":\"index.html\"}},\"timestamp\":{}}}\n",
          label,
          role,
          surface,
          now_ms()
        )
        .as_str(),
      );
      write_debug_log(
        format!(
          "{{\"sessionId\":\"ffe9af\",\"runId\":\"pre-fix\",\"hypothesisId\":\"H1\",\"location\":\"src-tauri/src/lib.rs:69\",\"message\":\"open_surface_window:built\",\"data\":{{\"label\":\"{}\",\"role\":\"{}\",\"surface\":\"{}\"}},\"timestamp\":{}}}\n",
          label,
          role,
          surface,
          now_ms()
        )
        .as_str(),
      );
      Ok(())
    }
    Err(error) => {
      write_agent_debug_log(
        format!(
          "{{\"sessionId\":\"d405cf\",\"runId\":\"pre-fix\",\"hypothesisId\":\"H5\",\"location\":\"src-tauri/src/lib.rs:113\",\"message\":\"open_surface_window_failed\",\"data\":{{\"label\":\"{}\",\"error\":\"{}\"}},\"timestamp\":{}}}\n",
          label,
          error.to_string().replace('\"', "'"),
          now_ms()
        )
        .as_str(),
      );
      write_debug_log(
        format!(
          "{{\"sessionId\":\"ffe9af\",\"runId\":\"pre-fix\",\"hypothesisId\":\"H1\",\"location\":\"src-tauri/src/lib.rs:80\",\"message\":\"open_surface_window:error\",\"data\":{{\"label\":\"{}\",\"error\":\"{}\"}},\"timestamp\":{}}}\n",
          label,
          error.to_string().replace('\"', "'"),
          now_ms()
        )
        .as_str(),
      );
      Err(error.to_string())
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![append_debug_log, open_surface_window])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
