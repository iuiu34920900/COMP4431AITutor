const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "vectorStore.json");

const HF_SIM_URL =
  "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2";

// ── Load the chunk store from disk ──────────────────────────────────────────

let chunks = []; // [{ text, source }]

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) {
    console.warn("vectorStore.json not found — RAG disabled. Run: node preprocess.js");
    chunks = [];
    return;
  }
  const data = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  chunks = data.chunks || [];
  console.log(`RAG store loaded: ${chunks.length} chunks from ${new Set(chunks.map((c) => c.source)).size} file(s).`);
}

// ── Retrieve top-k relevant chunks via sentence-similarity ──────────────────

const BATCH_SIZE = 128; // max sentences per HF call

async function retrieveTopK(query, apiKey, k = 3) {
  if (chunks.length === 0) return [];

  const allScores = [];

  // Batch chunks to avoid payload limits
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const sentences = batch.map((c) => c.text);

    const res = await fetch(HF_SIM_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: { source_sentence: query, sentences },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Embedding API error (${res.status}): ${body}`);
    }

    const scores = await res.json(); // number[]
    scores.forEach((score, j) => {
      allScores.push({ index: i + j, score });
    });
  }

  // Sort descending by similarity and take top-k
  allScores.sort((a, b) => b.score - a.score);
  return allScores.slice(0, k).map((s) => ({
    text: chunks[s.index].text,
    source: chunks[s.index].source,
    score: s.score,
  }));
}

module.exports = { loadStore, retrieveTopK };
