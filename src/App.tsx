import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [clankeryResponse, setClankeryResponse] = useState("");
  const [clankeryPrompt, setClankeryPrompt] = useState("");

  async function handleClankery() {
    try {
      const response = await invoke<string>("clankery", { prompt: clankeryPrompt });
      setClankeryResponse(response);
      setClankeryPrompt("");
    } catch (error) {
      setClankeryResponse(`Error: ${error}`);
    }
  }

  return (
    <main className="app-container">
      {clankeryResponse && <div className="response">{clankeryResponse}</div>}
      
      <div className="input-section">
        <input
          id="clankery-input"
          onChange={(e) => setClankeryPrompt(e.currentTarget.value)}
          onKeyPress={(e) => e.key === "Enter" && handleClankery()}
          placeholder="Ask something..."
          value={clankeryPrompt}
        />
        <button onClick={handleClankery}>Ask</button>
      </div>
    </main>
  );
}

export default App;
