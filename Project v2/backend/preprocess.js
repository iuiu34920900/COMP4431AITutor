/**
 * preprocess.js — Extract text from PDFs in slides/ and build vectorStore.json
 *
 * Usage:
 *   node preprocess.js
 *
 * Reads every .pdf file in the slides/ folder, splits the text into ~300-token
 * chunks, and saves them to vectorStore.json for runtime RAG retrieval.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");

const SLIDES_DIR = path.join(__dirname, "slides");
const STORE_PATH = path.join(__dirname, "vectorStore.json");
const CHUNK_SIZE = 300; // approximate tokens per chunk (using word count as proxy)

// ── Split text into overlapping chunks of ~CHUNK_SIZE words ─────────────────

function chunkText(text, maxWords = CHUNK_SIZE, overlap = 50) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += maxWords - overlap) {
    const slice = words.slice(i, i + maxWords);
    if (slice.length < 20) break; // skip tiny trailing fragments
    chunks.push(slice.join(" "));
  }
  return chunks;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(SLIDES_DIR)) {
    fs.mkdirSync(SLIDES_DIR, { recursive: true });
    console.log(`Created slides/ folder. Place your PDF lecture slides there, then re-run.`);
    return;
  }

  const pdfFiles = fs
    .readdirSync(SLIDES_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"));

  if (pdfFiles.length === 0) {
    console.log("No PDF files found in slides/. Add your lecture PDFs and re-run.");
    return;
  }

  const allChunks = [];

  for (const file of pdfFiles) {
    const filePath = path.join(SLIDES_DIR, file);
    console.log(`Processing: ${file}`);
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);

    const text = data.text
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!text) {
      console.warn(`  ⚠ No text extracted from ${file} — skipped.`);
      continue;
    }

    const chunks = chunkText(text);
    console.log(`  → ${chunks.length} chunk(s) (${data.numpages} pages, ~${text.split(/\s+/).length} words)`);

    for (const chunk of chunks) {
      allChunks.push({ text: chunk, source: file });
    }
  }

  if (allChunks.length === 0) {
    console.log("No text chunks produced. Check that your PDFs contain selectable text.");
    return;
  }

  fs.writeFileSync(STORE_PATH, JSON.stringify({ chunks: allChunks }, null, 2));
  console.log(`\n✅ vectorStore.json created — ${allChunks.length} chunks from ${pdfFiles.length} file(s).`);
}

main().catch((err) => {
  console.error("Preprocessing failed:", err);
  process.exit(1);
});
