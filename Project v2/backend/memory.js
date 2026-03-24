/**
 * memory.js — Long-term Student Memory (SQLite)
 *
 * Stores past interactions per student so the tutor can adapt over time.
 * Each interaction records: question, intent, response, and any detected issues.
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "memory.db");
let db;

// ── Initialise database and tables ──────────────────────────────────────────

function initMemory() {
  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS interactions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id  TEXT    NOT NULL,
      question    TEXT    NOT NULL,
      intent      TEXT    NOT NULL,
      response    TEXT    NOT NULL,
      issues      TEXT,
      created_at  TEXT    DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_student ON interactions(student_id)
  `);

  console.log("Student memory database ready.");
}

// ── Store a new interaction ─────────────────────────────────────────────────

function storeInteraction(studentId, question, intent, response, issues = null) {
  const stmt = db.prepare(
    `INSERT INTO interactions (student_id, question, intent, response, issues)
     VALUES (?, ?, ?, ?, ?)`
  );
  stmt.run(studentId, question, intent, response, issues);
}

// ── Retrieve recent interactions for a student ──────────────────────────────

function getStudentHistory(studentId, limit = 5) {
  const stmt = db.prepare(
    `SELECT question, intent, response, issues, created_at
     FROM interactions
     WHERE student_id = ?
     ORDER BY id DESC
     LIMIT ?`
  );
  return stmt.all(studentId, limit).reverse(); // chronological order
}

// ── Format history as context string for the LLM ────────────────────────────

function formatMemoryContext(history) {
  if (!history || history.length === 0) return "";

  const entries = history.map((h, i) => {
    let entry = `[${i + 1}] (${h.created_at}) Intent: ${h.intent}\n   Q: ${truncate(h.question, 120)}`;
    if (h.issues) entry += `\n   Issues detected: ${h.issues}`;
    return entry;
  });

  return (
    "\n\n--- Student Memory (past interactions) ---\n" +
    entries.join("\n") +
    "\n--- End Memory ---"
  );
}

function truncate(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max) + "...";
}

// ── Detect misconceptions / issues from the tutor response ──────────────────

function detectIssues(question, response) {
  // Simple heuristic: look for patterns in tutor output that signal misconceptions
  const issues = [];
  const lower = (question + " " + response).toLowerCase();

  if (lower.includes("common mistake") || lower.includes("misconception"))
    issues.push("misconception noted");
  if (lower.includes("confused") || lower.includes("mixing up"))
    issues.push("confusion detected");
  if (lower.includes("error") && lower.includes("runtime"))
    issues.push("runtime error in submitted code");
  if (lower.includes("notation") && (lower.includes("wrong") || lower.includes("incorrect")))
    issues.push("notation issue");

  return issues.length > 0 ? issues.join("; ") : null;
}

module.exports = { initMemory, storeInteraction, getStudentHistory, formatMemoryContext, detectIssues };
