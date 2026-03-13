const DEFAULT_TABLE = "gs_control_messages";

function getSupabaseConfig(env = process.env) {
  return {
    url: String(env.SUPABASE_URL || "").trim(),
    serviceRoleKey: String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
    table: String(env.SUPABASE_MESSAGES_TABLE || DEFAULT_TABLE).trim()
  };
}

function buildHeaders(serviceRoleKey) {
  return {
    "Content-Type": "application/json",
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`
  };
}

export async function insertCloudMessage(record, env = process.env) {
  const { url, serviceRoleKey, table } = getSupabaseConfig(env);
  if (!url || !serviceRoleKey) {
    return { ok: false, reason: "supabase_not_configured" };
  }

  const payload = {
    session_id: String(record?.session_id || ""),
    role: String(record?.role || ""),
    content: String(record?.content || ""),
    source: String(record?.source || "gs-control"),
    created_at: new Date().toISOString()
  };

  const endpoint = `${url}/rest/v1/${encodeURIComponent(table)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...buildHeaders(serviceRoleKey),
      Prefer: "return=minimal"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, reason: "insert_failed", detail: text };
  }

  return { ok: true };
}
