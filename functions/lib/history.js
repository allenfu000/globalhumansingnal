import { normalizeLocalHistory } from "./storage-local.js";
import { fetchRecentSupabaseMessages } from "./storage-supabase.js";

function keyOf(item) {
  return `${item.role}::${item.content}::${item.ts}`;
}

export async function loadMergedHistory(options) {
  const sessionId = String(options?.sessionId || "").trim();
  const localRaw = options?.localHistory;
  const env = options?.env;
  const limit = Number(options?.limit || 16);
  const clampedLimit = Math.max(1, Math.min(limit, 24));

  const localHistory = normalizeLocalHistory(localRaw, clampedLimit);
  const cloudHistory = await fetchRecentSupabaseMessages(env, sessionId, clampedLimit);

  const merged = [];
  const seen = new Set();
  for (const item of [...localHistory, ...cloudHistory]) {
    const key = keyOf(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }

  merged.sort((a, b) => a.ts - b.ts);
  const recent = merged.length <= clampedLimit ? merged : merged.slice(-clampedLimit);

  return {
    messages: recent,
    localCount: localHistory.length,
    cloudCount: cloudHistory.length
  };
}

export function buildOpenAIConversation(historyMessages, currentMessage) {
  const input = [];
  for (const item of historyMessages || []) {
    input.push({
      role: item.role === "assistant" ? "assistant" : "user",
      content: [
        {
          type: "input_text",
          text: item.content
        }
      ]
    });
  }

  input.push({
    role: "user",
    content: [
      {
        type: "input_text",
        text: String(currentMessage || "").trim()
      }
    ]
  });

  return input;
}
