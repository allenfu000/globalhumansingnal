const ALLOWED_ROLES = new Set(["user", "assistant", "system"]);

function normalizeContent(value) {
  return String(value || "").trim();
}

function normalizeTs(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) {
    return Date.now();
  }
  return Math.floor(n);
}

export function normalizeLocalHistory(input, limit = 16) {
  if (!Array.isArray(input)) {
    return [];
  }

  const safe = [];
  for (const item of input) {
    const role = String(item?.role || "").trim();
    const content = normalizeContent(item?.content);
    if (!ALLOWED_ROLES.has(role) || !content) {
      continue;
    }
    safe.push({
      role,
      content,
      ts: normalizeTs(item?.ts),
      source: "local"
    });
  }

  safe.sort((a, b) => a.ts - b.ts);
  if (safe.length <= limit) {
    return safe;
  }
  return safe.slice(-limit);
}
