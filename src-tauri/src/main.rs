#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![open_url, open_folder, reveal_in_finder, path_kind, save_text_file, read_text_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn path_kind(path: String) -> Result<String, String> {
    use std::fs;
    match fs::metadata(&path) {
        Ok(meta) => Ok(if meta.is_dir() { "folder" } else { "file" }.to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn graph_device_code_start(client_id: String) -> Result<serde_json::Value, String> {
    let scopes = "offline_access openid profile email https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read";
    let body = [("client_id", client_id.as_str()), ("scope", scopes)];
    let resp = reqwest::Client::new()
        .post("https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode")
        .form(&body)
        .send().await.map_err(|e| e.to_string())?;
    let json = resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(json)
}
#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), String> {
    use std::fs;
    fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    use std::fs;
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

// Microsoft Graph token model
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
struct GraphTokens {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    token_type: Option<String>,
}

fn graph_tokens_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app.path().app_config_dir().unwrap_or(std::env::temp_dir());
    let _ = std::fs::create_dir_all(&dir);
    dir.join("graph_tokens.json")
}
