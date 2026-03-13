import fs from "node:fs/promises";
import path from "node:path";

const CHAT_FILE = path.resolve(process.cwd(), "memory/local/chat.json");

async function ensureChatFile() {
  await fs.mkdir(path.dirname(CHAT_FILE), { recursive: true });
  try {
    await fs.access(CHAT_FILE);
  } catch {
    await fs.writeFile(CHAT_FILE, "[]", "utf8");
  }
}

export async function readLocalChat() {
  await ensureChatFile();
  const raw = await fs.readFile(CHAT_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendLocalChat(record) {
  const role = String(record?.role || "").trim();
  const content = String(record?.content || "").trim();
  if (!role || !content) {
    return { ok: false, reason: "invalid_record" };
  }

  const messages = await readLocalChat();
  messages.push({
    session_id: String(record?.session_id || ""),
    role,
    content,
    source: "local",
    created_at: new Date().toISOString()
  });
  await fs.writeFile(CHAT_FILE, JSON.stringify(messages, null, 2), "utf8");
  return { ok: true, count: messages.length };
}
