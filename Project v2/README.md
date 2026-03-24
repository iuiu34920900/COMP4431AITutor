# AI Tutor — Full-Stack Application

An AI-powered tutor that classifies student intent (**explain** vs **hint**) and responds pedagogically, using the **Hugging Face Inference API** (free tier).

## Key Features

- **Multi-Agent Orchestration** — four specialised agents (Intent Classifier, RAG Retriever, Plugin, Tutor) coordinated by a central orchestrator
- **RAG (Retrieval-Augmented Generation)** — grounds answers in your lecture PDFs via sentence-similarity embeddings
- **Code Execution Sandbox** — detects code in student messages and runs it in an isolated Node.js VM; execution results are fed back to the tutor
- **Long-term Student Memory** — SQLite database tracks each student's past interactions so the tutor can personalise responses over time

### Models & APIs

- **Text model**: `Qwen/Qwen2.5-7B-Instruct` via OpenAI-compatible `/v1/chat/completions` on `router.huggingface.co`
- **Embeddings**: `sentence-transformers/all-MiniLM-L6-v2` via sentence-similarity API on `router.huggingface.co`

## Project Structure

```
Project/
├── backend/
│   ├── server.js          # Express server — /tutor endpoint
│   ├── orchestrator.js    # Multi-agent pipeline (Intent → RAG → Plugin → Tutor)
│   ├── systemPrompt.js    # Master Socratic / anti-jailbreak system prompt
│   ├── rag.js             # RAG module (load chunks, retrieve top-k via HF)
│   ├── plugin.js          # Code execution sandbox (Node.js VM)
│   ├── memory.js          # Long-term student memory (SQLite)
│   ├── preprocess.js      # PDF→chunks preprocessing script
│   ├── slides/            # Place lecture PDFs here
│   ├── vectorStore.json   # Generated chunk store (after preprocessing)
│   ├── memory.db          # SQLite database (auto-created at startup)
│   ├── package.json
│   ├── .env.example
│   └── .gitignore
├── frontend/
│   ├── public/index.html
│   ├── src/
│   │   ├── index.js
│   │   ├── TutorApp.js     # Main React component
│   │   └── TutorApp.css    # Styling
│   └── package.json
└── README.md
```

---

## Prerequisites

- **Node.js** ≥ 18
- A **Hugging Face API token** (free) — create an account at [huggingface.co](https://huggingface.co), then generate a token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)

---

## Quick Start (Local Development)

### 1. Backend

```bash
cd backend
cp .env.example .env         # then edit .env and paste your HF token
npm install
```

### 2. Preprocess Lecture Slides (RAG)

Place your PDF lecture slides into `backend/slides/`, then run:

```bash
npm run preprocess           # extracts text, splits into chunks → vectorStore.json
```

This creates `vectorStore.json`. Re-run whenever you add/update PDFs.

### 3. Start Backend

```bash
npm start                    # → http://localhost:4000
```

### 4. Frontend

```bash
cd frontend
npm install
npm start                    # → http://localhost:3000 (proxies /tutor to :4000)
```

Open **http://localhost:3000** and start asking questions!

---

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `HF_API_KEY` | backend `.env` | Your Hugging Face API token |
| `PORT` | backend `.env` (optional) | Server port (default 4000) |
| `REACT_APP_API_URL` | frontend `.env` (optional) | Override backend URL for production builds |

> **Security**: Never commit `.env` files. The `.gitignore` already excludes them.

---

## API Reference

### `POST /tutor`

**Request body** (JSON):
```json
{
  "input_text": "What is backpropagation?",
  "input_image": "<base64 string or data URI — optional>",
  "student_id": "alice123 (optional — enables long-term memory)"
}
```

**Response** (JSON):
```json
{
  "intent": "explain",
  "response": "** Visual Analysis **: ... ** Explanation **: ... ** Analogy **: ..."
}
```

---

## Deployment

### Backend → Render (recommended free tier)

1. Push `backend/` to a GitHub repo.
2. Create a new **Web Service** on [render.com](https://render.com).
3. Set **Root Directory** to `backend`.
4. **Build Command**: `npm install`
5. **Start Command**: `npm start`
6. Add environment variable `HF_API_KEY` in the Render dashboard.

### Backend → Heroku

```bash
cd backend
heroku create ai-tutor-api
heroku config:set HF_API_KEY=your_token_here
git push heroku main
```

### Frontend → Vercel

1. Push `frontend/` to a GitHub repo.
2. Import the repo on [vercel.com](https://vercel.com).
3. Set **Root Directory** to `frontend`.
4. Add environment variable:
   - `REACT_APP_API_URL` = `https://your-backend-url.onrender.com/tutor`
5. Deploy. Vercel auto-detects Create React App.

### Frontend → Netlify

1. Build locally: `cd frontend && npm run build`
2. Drag-and-drop the `build/` folder to [netlify.com](https://app.netlify.com/drop).
3. Or connect your repo and set:
   - **Base directory**: `frontend`
   - **Build command**: `npm run build`
   - **Publish directory**: `frontend/build`
   - Environment variable: `REACT_APP_API_URL` = your backend URL + `/tutor`

---

## System Prompt & Anti-Jailbreak

A master system prompt defined in `systemPrompt.js` is **prepended to every LLM call** made by the orchestrator (Intent Classifier, Tutor Agent). It enforces three behavioural conditions:

| Condition | Trigger | Behaviour |
|---|---|---|
| **1 — Anti-Jailbreak** | Student claims "emergency", "developer override", alternate persona, etc. | Politely denies and reaffirms academic-integrity rules. |
| **2 — Casual Chat** | Greetings, "thank you", non-academic small talk | Responds directly as a friendly tutor; does **not** trigger the RAG/Plugin workflow. |
| **3 — Academic Query** | Homework, debugging, concept questions, quiz requests | Triggers the full multi-agent orchestration pipeline (RAG → Plugin → Tutor). |

This ensures every response stays Socratic — the tutor **never** provides complete solutions or direct code fixes, regardless of how the student phrases the request.

---

## How It Works

1. The student types a question and/or uploads an image.
2. Frontend sends a `POST /tutor` request with text + base64 image.
3. The **orchestrator** runs four agents in sequence:
   - **Intent Classifier** — decides `explain` or `hint` (with the master system prompt).
   - **RAG Agent** — retrieves the top-3 most relevant lecture chunks.
   - **Plugin Agent** — detects and sandbox-executes any code in the message.
   - **Tutor Agent** — generates the final Socratic response using all gathered context (with the master system prompt).
4. If a `student_id` is provided, the interaction is saved to SQLite for long-term memory.
5. The structured response is returned and rendered with markdown-style formatting.

### RAG Pipeline

```
PDF slides → preprocess.js → vectorStore.json (text chunks)
                                      ↓
Student question → sentence-transformers/all-MiniLM-L6-v2 (similarity) → top-3 chunks
                                      ↓
                       Injected into user message as context → Qwen 2.5 generates answer
```

- **Embedding model**: `sentence-transformers/all-MiniLM-L6-v2` via HF sentence-similarity API
- **Chunk size**: ~300 tokens with 50-token overlap
- **Top-k**: 3 most relevant chunks retrieved per query
- If no `vectorStore.json` exists, RAG is gracefully skipped and the tutor answers from general knowledge.
