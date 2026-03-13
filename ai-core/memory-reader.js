import { readLocalChat } from "../sync/local-sync.js";

export async function readMemorySnapshot(options = {}) {
  const sessionId = String(options.session_id || "").trim();
  const limit = Number(options.limit || 20);
  const max = Math.max(1, Math.min(limit, 100));

  const localMessages = await readLocalChat();
  const filtered = sessionId
    ? localMessages.filter((item) => String(item?.session_id || "") === sessionId)
    : localMessages;

  const recent = filtered.slice(-max);
  return {
    session_id: sessionId,
    count: recent.length,
    messages: recent
  };
}
