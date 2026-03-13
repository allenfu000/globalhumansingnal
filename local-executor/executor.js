import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isSubPath(parent, child) {
  const normalizedParent = normalizeSlashes(path.resolve(parent)).toLowerCase();
  const normalizedChild = normalizeSlashes(path.resolve(child)).toLowerCase();
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

export function resolveSafePath(projectRoot, relativeFile) {
  if (typeof relativeFile !== "string" || !relativeFile.trim()) {
    throw new Error("file is required");
  }
  const sanitized = relativeFile.trim();
  const absolute = path.resolve(projectRoot, sanitized);
  if (!isSubPath(projectRoot, absolute)) {
    throw new Error("blocked: file path escapes project root");
  }
  return absolute;
}

async function ensureParentDir(filePath) {
  const parent = path.dirname(filePath);
  await fs.mkdir(parent, { recursive: true });
}

async function readSmallText(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`file too large (${stat.size} bytes)`);
  }
  return fs.readFile(filePath, "utf8");
}

async function writeText(filePath, content) {
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, content, "utf8");
}

function safeArg(value) {
  return String(value || "").replace(/\r|\n/g, " ").trim();
}

function runCommand(projectRoot, command, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const cp = spawn(command, {
      cwd: projectRoot,
      shell: true,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      cp.kill("SIGTERM");
      reject(new Error(`command timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    cp.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    cp.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    cp.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    cp.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: Number(code ?? 1), stdout, stderr });
    });
  });
}

function ensureAllowedCommand(command) {
  const text = safeArg(command).toLowerCase();
  if (!text) {
    throw new Error("command is required");
  }
  const allowedPrefixes = [
    "npm run ",
    "npm test",
    "npm install",
    "node ",
    "pnpm ",
    "yarn ",
    "python ",
    "git status",
    "git diff"
  ];
  const blockedTokens = [
    "&& del ",
    " rd /s",
    " rmdir ",
    "format ",
    "shutdown",
    "powershell -enc",
    "curl ",
    "invoke-webrequest"
  ];
  for (const token of blockedTokens) {
    if (text.includes(token)) {
      throw new Error(`blocked command token: ${token.trim()}`);
    }
  }
  const matched = allowedPrefixes.some((prefix) => text.startsWith(prefix));
  if (!matched) {
    throw new Error("command is not in allowlist");
  }
  return text;
}

export async function executeInstruction(projectRoot, payload) {
  const action = String(payload?.action || "").trim();
  const instruction = String(payload?.instruction || "").trim();

  if (!action) {
    throw new Error("action is required");
  }

  if (action === "create_file") {
    const relativeFile = String(payload?.file || "").trim();
    const absolute = resolveSafePath(projectRoot, relativeFile);
    const content = String(payload?.content || "");
    await writeText(absolute, content);
    return {
      ok: true,
      action,
      file: relativeFile,
      message: "file created",
      bytes: Buffer.byteLength(content, "utf8")
    };
  }

  if (action === "edit_file") {
    const relativeFile = String(payload?.file || "").trim();
    const absolute = resolveSafePath(projectRoot, relativeFile);
    const mode = String(payload?.edit_mode || "").trim().toLowerCase() || "replace_all";

    if (mode === "replace_text") {
      const find = String(payload?.find || "");
      const replace = String(payload?.replace || "");
      if (!find) {
        throw new Error("find is required for replace_text");
      }
      const source = await readSmallText(absolute);
      if (!source.includes(find)) {
        throw new Error("find text not found");
      }
      const updated = source.replace(find, replace);
      await writeText(absolute, updated);
      return {
        ok: true,
        action,
        file: relativeFile,
        message: "file edited with replace_text",
        instruction
      };
    }

    if (mode === "append") {
      const appendText = String(payload?.append || "");
      if (!appendText) {
        throw new Error("append is required for append mode");
      }
      const source = await fs.readFile(absolute, "utf8").catch(() => "");
      const updated = source + appendText;
      await writeText(absolute, updated);
      return {
        ok: true,
        action,
        file: relativeFile,
        message: "file edited with append",
        instruction
      };
    }

    const content = String(payload?.content || "");
    if (!content) {
      throw new Error("content is required for replace_all");
    }
    await writeText(absolute, content);
    return {
      ok: true,
      action,
      file: relativeFile,
      message: "file replaced",
      bytes: Buffer.byteLength(content, "utf8"),
      instruction
    };
  }

  if (action === "run_script") {
    const command = ensureAllowedCommand(payload?.command || payload?.instruction || "");
    const result = await runCommand(projectRoot, command);
    return {
      ok: result.code === 0,
      action,
      command,
      exit_code: result.code,
      stdout: result.stdout.slice(0, 12000),
      stderr: result.stderr.slice(0, 12000)
    };
  }

  throw new Error(`unsupported action: ${action}`);
}
