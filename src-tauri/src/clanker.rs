use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    stream: bool,
}

#[derive(Serialize, Deserialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    message: Message,
}

#[tauri::command]
pub async fn clankery(prompt: String) -> Result<String, String> {
    let client = Client::new();

    let req = ChatRequest {
        model: "qwen2.5:0.5b".to_string(),
        messages: vec![Message {
            role: "user".to_string(),
            content: prompt,
        }],
        stream: false,
    };

    let res = client
        .post("http://localhost:11434/api/chat")
        .json(&req)
        .send()
        .await
        .map_err(|e| e.to_string())? // Convert reqwest errors to String
        .error_for_status()
        .map_err(|e| e.to_string())? // Convert status errors to String
        .json::<ChatResponse>()
        .await
        .map_err(|e| e.to_string())?; // Convert serde_json errors to String

    Ok(res.message.content)
}
