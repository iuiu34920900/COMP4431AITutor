/**
 * plugin.js — Code Execution Sandbox Plugin
 *
 * Safely executes student-submitted code in an isolated Node.js VM context.
 * Captures stdout, stderr, runtime errors, and stack traces.
 * Returns structured execution results for the tutor LLM to reason about.
 */

const vm = require("vm");

const TIMEOUT_MS = 5000; // max execution time
const MAX_OUTPUT_LEN = 2000; // truncate long outputs

/**
 * Detect whether the user message contains code to execute.
 * Looks for fenced code blocks (```...```) or common code patterns.
 */
function detectCode(text) {
  if (!text) return null;

  // Extract fenced code block
  const fenced = text.match(/```(?:\w*)\n?([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  // Heuristic: lines that look like JS/Python code
  const codePatterns = /^\s*(function |const |let |var |class |import |def |for |while |if |print\(|console\.log)/m;
  if (codePatterns.test(text)) {
    // Extract contiguous code-like lines
    const lines = text.split("\n");
    const codeLines = [];
    let inCode = false;
    for (const line of lines) {
      if (codePatterns.test(line) || (inCode && /^\s/.test(line))) {
        codeLines.push(line);
        inCode = true;
      } else if (inCode && line.trim() === "") {
        codeLines.push(line);
      } else {
        inCode = false;
      }
    }
    if (codeLines.length >= 2) return codeLines.join("\n").trim();
  }

  return null;
}

/**
 * Execute JavaScript code in a sandboxed VM context.
 * Returns { stdout, stderr, error, exitedCleanly }.
 */
function executeCode(code) {
  const output = { stdout: "", stderr: "", error: null, exitedCleanly: false };

  // Build a fake console that captures output
  const fakeConsole = {
    log: (...args) => { output.stdout += args.map(String).join(" ") + "\n"; },
    error: (...args) => { output.stderr += args.map(String).join(" ") + "\n"; },
    warn: (...args) => { output.stderr += "[warn] " + args.map(String).join(" ") + "\n"; },
    info: (...args) => { output.stdout += args.map(String).join(" ") + "\n"; },
  };

  // Minimal sandbox — no access to require, process, fs, etc.
  const sandbox = {
    console: fakeConsole,
    Math,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    Date,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    Promise,
    setTimeout: undefined,   // blocked
    setInterval: undefined,  // blocked
    require: undefined,      // blocked
    process: undefined,      // blocked
    global: undefined,       // blocked
  };

  try {
    const context = vm.createContext(sandbox);
    const script = new vm.Script(code, { filename: "student-code.js" });
    script.runInContext(context, { timeout: TIMEOUT_MS });
    output.exitedCleanly = true;
  } catch (err) {
    output.error = {
      name: err.name || "Error",
      message: err.message || String(err),
      stack: cleanStack(err.stack),
    };
  }

  // Truncate large outputs
  output.stdout = truncate(output.stdout, MAX_OUTPUT_LEN);
  output.stderr = truncate(output.stderr, MAX_OUTPUT_LEN);

  return output;
}

function cleanStack(stack) {
  if (!stack) return "";
  // Remove internal VM frames, keep only student-code lines
  return stack
    .split("\n")
    .filter((l) => !l.includes("node:vm") && !l.includes("node:internal"))
    .slice(0, 8)
    .join("\n");
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max) + "\n...[truncated]";
}

/**
 * Format execution results as context for the LLM.
 */
function formatExecutionResult(result) {
  const parts = ["--- Code Execution Result ---"];

  if (result.stdout) parts.push(`Stdout:\n${result.stdout}`);
  if (result.stderr) parts.push(`Stderr:\n${result.stderr}`);

  if (result.error) {
    parts.push(`Runtime Error: ${result.error.name}: ${result.error.message}`);
    if (result.error.stack) parts.push(`Stack Trace:\n${result.error.stack}`);
  }

  if (result.exitedCleanly && !result.stdout && !result.stderr) {
    parts.push("Code executed without output or errors.");
  }

  parts.push("--- End Execution Result ---");
  return parts.join("\n");
}

module.exports = { detectCode, executeCode, formatExecutionResult };
