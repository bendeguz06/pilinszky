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

async fn clankery() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::new();

    let req = ChatRequest {
        model: "qwen2.5:0.5b".to_string(),
        messages: vec![Message {
            role: "user".to_string(),
            content: "explain the daoist concept of wu wei in 1 sentence!".to_string(),
        }],
        stream: false,
    };

    let res = client
        .post("http://localhost:11434/api/chat")
        .json(&req)
        .send()
        .await?
        .error_for_status()?
        .json::<ChatResponse>()
        .await?;

    println!("{}", res.message.content);
    Ok(())
}
