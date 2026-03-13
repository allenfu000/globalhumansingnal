const SUPABASE_TIMEOUT_MS = 12000;

function getSupabaseConfig(env) {
  const url = String(env?.SUPABASE_URL || "").trim();
  const key = String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const table = String(env?.SUPABASE_MESSAGES_TABLE || "gs_control_messages").trim();
  return { url, key, table };
}

function isSupabaseReady(env) {
  const { url, key } = getSupabaseConfig(env);
  return Boolean(url && key);
}

function createHeaders(key) {
  return {
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${key}`
  };
}

async function safeFetchJson(url, options, timeoutMs = SUPABASE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function insertSupabaseMessage(env, row) {
  if (!isSupabaseReady(env)) {
    return { ok: false, skipped: true, reason: "supabase_not_configured" };
  }
  const { url, key, table } = getSupabaseConfig(env);

  const payload = {
    session_id: String(row?.session_id || ""),
    role: String(row?.role || ""),
    content: String(row?.content || ""),
    source: "gs-control",
    message_type: String(row?.message_type || "normal_text"),
    mode: String(row?.mode || "normal"),
    attachments: Array.isArray(row?.attachments) ? row.attachments : [],
    meta: row?.meta && typeof row.meta === "object" ? row.meta : {},
    created_at: new Date(Number(row?.ts || Date.now())).toISOString()
  };

  if (!payload.session_id || !payload.role || !payload.content) {
    return { ok: false, skipped: true, reason: "invalid_row" };
  }

  const endpoint = `${url}/rest/v1/${encodeURIComponent(table)}`;
  const result = await safeFetchJson(endpoint, {
    method: "POST",
    headers: {
      ...createHeaders(key),
      Prefer: "return=minimal"
    },
    body: JSON.stringify(payload)
  });

  return {
    ok: result.ok,
    status: result.status,
    error: result.ok ? "" : (result.data?.message || "insert_failed")
  };
}

export async function insertSupabaseTask(env, row) {
  if (!isSupabaseReady(env)) {
    return { ok: false, skipped: true, reason: "supabase_not_configured" };
  }
  const { url, key } = getSupabaseConfig(env);
  const table = String(env?.SUPABASE_TASKS_TABLE || "gs_control_tasks").trim();

  const payload = {
    session_id: String(row?.session_id || ""),
    title: String(row?.title || "未命名任务"),
    status: String(row?.status || "pending"),
    task_content: String(row?.task_content || ""),
    source: String(row?.source || "gs-control"),
    created_at: new Date(Number(row?.ts || Date.now())).toISOString(),
    updated_at: new Date(Number(row?.ts || Date.now())).toISOString()
  };

  if (!payload.session_id || !payload.task_content) {
    return { ok: false, skipped: true, reason: "invalid_task_row" };
  }

  const endpoint = `${url}/rest/v1/${encodeURIComponent(table)}`;
  const result = await safeFetchJson(endpoint, {
    method: "POST",
    headers: {
      ...createHeaders(key),
      Prefer: "return=minimal"
    },
    body: JSON.stringify(payload)
  });

  return {
    ok: result.ok,
    status: result.status,
    error: result.ok ? "" : (result.data?.message || "insert_task_failed")
  };
}

export async function fetchRecentSupabaseTasks(env, sessionId, limit = 30) {
  if (!isSupabaseReady(env)) {
    return [];
  }
  const sid = String(sessionId || "").trim();
  if (!sid) {
    return [];
  }

  const { url, key } = getSupabaseConfig(env);
  const table = String(env?.SUPABASE_TASKS_TABLE || "gs_control_tasks").trim();
  const endpoint = new URL(`${url}/rest/v1/${encodeURIComponent(table)}`);
  endpoint.searchParams.set("select", "id,session_id,title,status,task_content,created_at,updated_at");
  endpoint.searchParams.set("session_id", `eq.${sid}`);
  endpoint.searchParams.set("order", "created_at.desc");
  endpoint.searchParams.set("limit", String(Math.max(1, Math.min(limit, 80))));

  const result = await safeFetchJson(endpoint.toString(), {
    method: "GET",
    headers: createHeaders(key)
  });

  if (!result.ok || !Array.isArray(result.data)) {
    return [];
  }

  return result.data.map((item) => ({
    id: String(item?.id || ""),
    session_id: String(item?.session_id || ""),
    title: String(item?.title || "开发任务"),
    status: String(item?.status || "pending"),
    task_content: String(item?.task_content || ""),
    created_at: String(item?.created_at || ""),
    updated_at: String(item?.updated_at || "")
  }));
}

export async function fetchRecentSupabaseMessages(env, sessionId, limit = 16) {
  if (!isSupabaseReady(env)) {
    return [];
  }
  const sid = String(sessionId || "").trim();
  if (!sid) {
    return [];
  }

  const { url, key, table } = getSupabaseConfig(env);
  const endpoint = new URL(`${url}/rest/v1/${encodeURIComponent(table)}`);
  endpoint.searchParams.set("select", "session_id,role,content,created_at");
  endpoint.searchParams.set("session_id", `eq.${sid}`);
  endpoint.searchParams.set("order", "created_at.desc");
  endpoint.searchParams.set("limit", String(Math.max(1, Math.min(limit, 40))));

  const result = await safeFetchJson(endpoint.toString(), {
    method: "GET",
    headers: createHeaders(key)
  });

  if (!result.ok || !Array.isArray(result.data)) {
    return [];
  }

  return result.data
    .map((item) => ({
      role: String(item?.role || ""),
      content: String(item?.content || ""),
      ts: Date.parse(String(item?.created_at || "")) || Date.now(),
      source: "cloud"
    }))
    .filter((item) => (item.role === "user" || item.role === "assistant") && item.content.trim())
    .sort((a, b) => a.ts - b.ts);
}
