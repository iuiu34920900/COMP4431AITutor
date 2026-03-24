require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { loadStore } = require("./rag");
const { initMemory } = require("./memory");
const { orchestrate } = require("./orchestrator");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const HF_API_KEY = process.env.HF_API_KEY;
if (!HF_API_KEY) {
  console.error("HF_API_KEY is not set. Create a .env file with your Hugging Face token.");
  process.exit(1);
}

// ── Model config ────────────────────────────────────────────────────────────

const TEXT_MODEL = "Qwen/Qwen2.5-7B-Instruct";
const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";

// ── Helper: call HF via OpenAI-compatible chat completions ──────────────────

async function chatCompletion(systemPrompt, userMessage, maxTokens = 1024) {
  const res = await fetch(HF_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Hugging Face API error (${res.status}): ${body}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (text) return text.trim();
  throw new Error("Unexpected API response format: " + JSON.stringify(data));
}

// ── POST /tutor ──────────────────────────────────────────────────────────────

app.post("/tutor", async (req, res) => {
  try {
    const { input_text, input_image, student_id } = req.body;

    if (!input_text && !input_image) {
      return res
        .status(400)
        .json({ error: "At least one of input_text or input_image is required." });
    }

    // Build the user message, noting any uploaded image
    let userMessage = input_text || "";
    if (input_image) {
      userMessage += "\n\n[The student also uploaded an image/screenshot related to their question.]";
    }

    // Run the multi-agent orchestration pipeline
    const result = await orchestrate(chatCompletion, userMessage, HF_API_KEY, student_id || null);

    return res.json(result);
  } catch (err) {
    console.error("Tutor endpoint error:", err);
    return res.status(500).json({ error: "Failed to generate AI response. " + err.message });
  }
});

// ── Start server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4001;

// Initialise subsystems then start
loadStore();
initMemory();

app.listen(PORT, () => {
  console.log(`AI Tutor backend running on http://localhost:${PORT}`);
});
