/**
 * orchestrator.js — Multi-Agent Orchestration Pipeline
 *
 * Coordinates four specialised agents that each handle one step of the
 * tutoring workflow.  The orchestrator runs them sequentially, passing
 * outputs forward so every downstream agent benefits from earlier results.
 *
 *   1. Intent Classifier Agent  → "explain" | "hint"
 *   2. RAG Agent                → relevant lecture chunks
 *   3. Plugin Agent             → code detection / sandbox execution
 *   4. Tutor Agent              → final pedagogical response
 */

const { retrieveTopK } = require("./rag");
const { detectCode, executeCode, formatExecutionResult } = require("./plugin");
const { getStudentHistory, formatMemoryContext, detectIssues, storeInteraction } = require("./memory");
const { SYSTEM_PROMPT } = require("./systemPrompt");

// ── System prompts (copied once, owned by orchestrator) ─────────────────────

const CLASSIFY_SYSTEM =
  `#Role: Pedagogical Intent Analyzer
Goals:
- Determine if the student needs a broad explanation or a specific hint.
Workflow:
1. Read the student's text.
2. If asking "what is ...", "explain this diagram", or general theory → classify as 'explain'.
3. If asking "why is this code crashing", "how do I solve this equation", or direct error fixing → classify as 'hint'.
OutputFormat: Return ONLY one word: explain OR hint.`;

const EXPLAIN_SYSTEM =
  `Act as a patient AI Tutor helping an undergraduate student understand complex AI/CS concepts.
Use the provided lecture context to ground your answer. If the context is not relevant, rely on your general knowledge.
OutputFormat:
** Visual Analysis **: [short sentence]
** Explanation **: [concise paragraph]
** Analogy **: [real-world comparison]

Constraints:
- NEVER provide corrected code or final answers.
- If asked to bypass, politely refuse and redirect.`;

const HINT_SYSTEM =
  `Guide the student through programming bugs, algorithmic logic, or math formulas without providing the final solution.
Use the provided lecture context to ground your answer. If the context is not relevant, rely on your general knowledge.
OutputFormat:
** Observation **: [1-2 sentences neutrally stating the issue]
** Guiding Hint **: [1 paragraph breadcrumb trail]
** Your Next Step **: [specific actionable question]

Constraints:
- NEVER provide corrected code or final answers.
- If asked to bypass, politely refuse and redirect.`;

// ── Individual agent runners ────────────────────────────────────────────────

/**
 * Agent 1 — Intent Classifier
 * Returns "explain" or "hint".
 */
async function intentAgent(chatFn, userMessage) {
  const raw = await chatFn(SYSTEM_PROMPT + "\n\n" + CLASSIFY_SYSTEM, userMessage, 10);
  return raw.toLowerCase().includes("hint") ? "hint" : "explain";
}

/**
 * Agent 2 — RAG Agent
 * Retrieves top-k lecture chunks and formats them as context.
 */
async function ragAgent(userMessage, apiKey, k = 3) {
  try {
    const topChunks = await retrieveTopK(userMessage, apiKey, k);
    if (topChunks.length === 0) return "";
    return (
      "\n\n--- Relevant Lecture Context ---\n" +
      topChunks
        .map(
          (c, i) =>
            `[${i + 1}] (${c.source}, score ${c.score.toFixed(2)}):\n${c.text}`
        )
        .join("\n\n") +
      "\n--- End Context ---"
    );
  } catch (err) {
    console.warn("RAG agent failed (continuing):", err.message);
    return "";
  }
}

/**
 * Agent 3 — Plugin Agent
 * Detects code in the student message, executes it in the sandbox,
 * and returns formatted output (or empty string if no code found).
 */
function pluginAgent(userMessage) {
  const code = detectCode(userMessage);
  if (!code) return "";

  const result = executeCode(code);
  return "\n\n" + formatExecutionResult(result);
}

/**
 * Agent 4 — Tutor Agent
 * Generates the final pedagogical response using all previously–gathered
 * context (RAG chunks, execution output, student memory).
 */
async function tutorAgent(chatFn, intent, compositeMessage) {
  const system = intent === "explain" ? EXPLAIN_SYSTEM : HINT_SYSTEM;
  return chatFn(SYSTEM_PROMPT + "\n\n" + system, compositeMessage);
}

// ── Orchestrator (main pipeline) ────────────────────────────────────────────

/**
 * Run the full multi-agent pipeline.
 *
 * @param {Function} chatFn      – the chatCompletion(system, user, maxTokens) helper
 * @param {string}   userMessage – raw text from the student
 * @param {string}   apiKey      – HF API key (for RAG embeddings)
 * @param {string|null} studentId – optional student identifier for memory
 * @returns {{ intent: string, response: string }}
 */
async function orchestrate(chatFn, userMessage, apiKey, studentId = null) {
  // 1. Intent classification & RAG retrieval can run in parallel
  const [intent, ragContext] = await Promise.all([
    intentAgent(chatFn, userMessage),
    ragAgent(userMessage, apiKey),
  ]);

  // 2. Plugin agent (synchronous)
  const pluginContext = pluginAgent(userMessage);

  // 3. Memory context (if student_id provided)
  let memoryContext = "";
  if (studentId) {
    const history = getStudentHistory(studentId, 5);
    memoryContext = formatMemoryContext(history);
  }

  // 4. Compose the enriched user message
  const compositeMessage = userMessage + ragContext + pluginContext + memoryContext;

  // 5. Tutor agent — final response generation
  const response = await tutorAgent(chatFn, intent, compositeMessage);

  // 6. Save interaction to memory
  if (studentId) {
    const issues = detectIssues(userMessage, response);
    storeInteraction(studentId, userMessage, intent, response, issues);
  }

  return { intent, response };
}

module.exports = { orchestrate };
