use serde::{Deserialize, Serialize};
mod clanker;
mod commands;
#[derive(Debug, Deserialize)]
struct Input {
    user: String,
    prompt: String,
}
#[derive(Debug, Serialize)]
struct Output {
    answer: String,
}

#[tauri::command]
async fn ask(input: Input) -> Output {
    Output {
        answer: format!("User {} asked: {}", input.user, input.prompt),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![commands::greet, ask, clanker::clankery])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
