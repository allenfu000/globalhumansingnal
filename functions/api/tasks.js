import { fetchRecentSupabaseTasks, insertSupabaseTask } from "../lib/storage-supabase.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0"
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...JSON_HEADERS,
      Allow: "GET, POST, OPTIONS"
    }
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const sessionId = String(url.searchParams.get("session_id") || "").trim();
  const limitRaw = Number(url.searchParams.get("limit") || 30);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(80, limitRaw)) : 30;

  if (!sessionId) {
    return jsonResponse(
      {
        ok: false,
        error: "missing_session_id",
        message: "缺少 session_id。"
      },
      400
    );
  }

  const tasks = await fetchRecentSupabaseTasks(env, sessionId, limit);
  return jsonResponse({
    ok: true,
    tasks
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_json",
        message: "请求体必须是有效 JSON。"
      },
      400
    );
  }

  const sessionId = String(body?.session_id || "").trim();
  const taskContent = String(body?.task_content || "").trim();
  const title = String(body?.title || "开发任务").trim();
  const status = String(body?.status || "pending").trim();
  const source = String(body?.source || "gs-control").trim();

  if (!sessionId || !taskContent) {
    return jsonResponse(
      {
        ok: false,
        error: "missing_fields",
        message: "session_id 和 task_content 为必填。"
      },
      400
    );
  }

  const result = await insertSupabaseTask(env, {
    session_id: sessionId,
    title,
    status,
    task_content: taskContent,
    source,
    ts: Date.now()
  });

  if (!result.ok && !result.skipped) {
    return jsonResponse(
      {
        ok: false,
        error: "task_insert_failed",
        message: result.error || "任务写入失败。"
      },
      500
    );
  }

  return jsonResponse({
    ok: true,
    skipped: Boolean(result.skipped),
    reason: result.reason || ""
  });
}
