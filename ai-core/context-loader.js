import fs from "node:fs/promises";
import path from "node:path";

const CONTEXT_FILE = path.resolve(process.cwd(), "memory/context/current-context.json");

async function ensureContextFile() {
  await fs.mkdir(path.dirname(CONTEXT_FILE), { recursive: true });
  try {
    await fs.access(CONTEXT_FILE);
  } catch {
    await fs.writeFile(
      CONTEXT_FILE,
      JSON.stringify(
        {
          session_id: "",
          updated_at: "",
          summary: "",
          recent_topics: [],
          pending_tasks: []
        },
        null,
        2
      ),
      "utf8"
    );
  }
}

export async function loadContext() {
  await ensureContextFile();
  const raw = await fs.readFile(CONTEXT_FILE, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return {
      session_id: "",
      updated_at: "",
      summary: "",
      recent_topics: [],
      pending_tasks: []
    };
  }
}

export async function saveContext(nextContext) {
  await ensureContextFile();
  const payload = {
    session_id: String(nextContext?.session_id || ""),
    updated_at: new Date().toISOString(),
    summary: String(nextContext?.summary || ""),
    recent_topics: Array.isArray(nextContext?.recent_topics) ? nextContext.recent_topics : [],
    pending_tasks: Array.isArray(nextContext?.pending_tasks) ? nextContext.pending_tasks : []
  };
  await fs.writeFile(CONTEXT_FILE, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}
