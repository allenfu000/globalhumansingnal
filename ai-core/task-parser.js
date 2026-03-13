export function parseTaskInstruction(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return {
      ok: false,
      reason: "empty_text",
      task: null
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ok: true,
      reason: "",
      task: parsed
    };
  } catch {
    return {
      ok: false,
      reason: "not_json",
      task: {
        action: "note",
        instruction: raw
      }
    };
  }
}
