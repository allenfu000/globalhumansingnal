import { insertSupabaseMessage, insertSupabaseTask } from "../lib/storage-supabase.js";

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

function getErrorMessage(data, fallbackMessage) {
  return (
    data?.error?.message ||
    data?.message ||
    fallbackMessage ||
    "Unknown error"
  );
}

function toResponseText(data) {
  return data?.choices?.[0]?.message?.content || "";
}

function resolveSessionId(body) {
  const fromBody = typeof body?.session_id === "string" ? body.session_id.trim() : "";
  if (fromBody) {
    return fromBody;
  }
  return `gs_web_${Date.now()}`;
}

function resolveMode(body) {
  const mode = String(body?.mode || "normal").trim().toLowerCase();
  return mode === "dev" ? "dev" : "normal";
}

function resolveProvider(env) {
  const aiProvider = String(env?.AI_PROVIDER || "openai").trim().toLowerCase();
  const baseRaw = String(env?.OPENAI_BASE_URL || "https://api.openai.com/v1").trim();
  const baseUrl = baseRaw.endsWith("/") ? baseRaw.slice(0, -1) : baseRaw;
  const timeoutMsRaw = Number(env?.AI_TIMEOUT_MS || 30000);
  const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(8000, timeoutMsRaw) : 30000;
  return { aiProvider, baseUrl, timeoutMs };
}

function parseImages(images) {
  if (!Array.isArray(images)) {
    return [];
  }
  return images
    .map((item) => {
      if (typeof item === "string") {
        return { url: item.trim(), name: "" };
      }
      if (item && typeof item === "object") {
        return {
          url: String(item.url || "").trim(),
          name: String(item.name || "").trim()
        };
      }
      return { url: "", name: "" };
    })
    .filter((item) => item.url && (item.url.startsWith("data:image/") || /^https?:\/\//.test(item.url)))
    .slice(0, 10);
}

function buildDevSystemPrompt() {
  return [
    "你是开发任务整理助手。输出必须是 JSON，不要输出任何 JSON 之外的文本。",
    "JSON 结构：",
    "{",
    '  "human_summary": "中文说明，给用户看",',
    '  "cursor_task_title": "任务标题",',
    '  "cursor_task_prompt": "给 Cursor 的开发任务全文",',
    '  "affected_files": [],',
    '  "notes": [],',
    '  "risk": [],',
    '  "test_points": []',
    "}",
    "要求：",
    "1) human_summary 用中文，简洁、可执行。",
    "2) cursor_task_prompt 结构化：目标、改动文件、约束、测试点。",
    "3) 数组字段必须是字符串数组。"
  ].join("\n");
}

function safeJsonParse(text) {
  const input = String(text || "").trim();
  if (!input) {
    return null;
  }
  try {
    return JSON.parse(input);
  } catch {
    const maybe = input.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (maybe?.[1]) {
      try {
        return JSON.parse(maybe[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeDevOutput(rawText, parsed) {
  const fallback = {
    human_summary: rawText || "模型未返回结构化开发说明。",
    cursor_task_title: "待整理开发任务",
    cursor_task_prompt: rawText || "",
    affected_files: [],
    notes: [],
    risk: [],
    test_points: []
  };
  if (!parsed || typeof parsed !== "object") {
    return fallback;
  }
  const asArray = (value) => (Array.isArray(value) ? value.map((v) => String(v || "").trim()).filter(Boolean) : []);
  return {
    human_summary: String(parsed.human_summary || fallback.human_summary).trim(),
    cursor_task_title: String(parsed.cursor_task_title || fallback.cursor_task_title).trim(),
    cursor_task_prompt: String(parsed.cursor_task_prompt || fallback.cursor_task_prompt).trim(),
    affected_files: asArray(parsed.affected_files),
    notes: asArray(parsed.notes),
    risk: asArray(parsed.risk),
    test_points: asArray(parsed.test_points)
  };
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...JSON_HEADERS,
      Allow: "POST, OPTIONS"
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { aiProvider, baseUrl, timeoutMs } = resolveProvider(env);

  if (!env?.OPENAI_API_KEY) {
    return jsonResponse(
      {
        ok: false,
        error: "missing_openai_api_key",
        message: "未配置 OPENAI_API_KEY，无法请求 AI 服务。"
      },
      500
    );
  }

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

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const sessionId = resolveSessionId(body);
  const mode = resolveMode(body);
  const images = parseImages(body?.images);
  const source = String(body?.source || "gs-control").trim() || "gs-control";
  const fromVoice = Boolean(body?.from_voice);
  const userMessageType = fromVoice ? "voice_text" : (images.length ? "image_text" : (mode === "dev" ? "dev_request" : "normal_text"));
  if (!message) {
    return jsonResponse(
      {
        ok: false,
        error: "missing_message",
        message: "请先输入内容。"
      },
      400
    );
  }

  const model = typeof body?.model === "string" && body.model.trim()
    ? body.model.trim()
    : "gpt-4o-mini";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    const userContent = [{ type: "text", text: message }];
    for (const image of images) {
      userContent.push({
        type: "image_url",
        image_url: { url: image.url }
      });
    }

    const messages = [];
    if (mode === "dev") {
      messages.push({
        role: "system",
        content: buildDevSystemPrompt()
      });
    }
    messages.push({
      role: "user",
      content: userContent
    });

    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: mode === "dev" ? 0.2 : 0.6
      }),
      signal: controller.signal
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const code = data?.error?.code || "openai_error";
      const baseMessage = getErrorMessage(data, "OpenAI request failed.");

      if (code === "unsupported_country_region_territory") {
        return jsonResponse(
          {
            ok: false,
            error: code,
            message: "当前上游区域不可用，请切换可用上游或代理。",
            details: baseMessage,
            hint: "可通过 OPENAI_BASE_URL 或 AI_PROVIDER 切换上游。"
          },
          403
        );
      }

      return jsonResponse(
        {
          ok: false,
          error: code,
          message: baseMessage,
          upstream_status: upstream.status
        },
        upstream.status
      );
    }

    const text = toResponseText(data).trim();
    const devParsed = mode === "dev" ? safeJsonParse(text) : null;
    const devOutput = mode === "dev" ? normalizeDevOutput(text, devParsed) : null;

    const debug = {
      aiProvider,
      openaiBaseUrl: baseUrl,
      timeoutMs,
      supabaseUrlSet: Boolean(env?.SUPABASE_URL?.trim()),
      supabaseKeySet: Boolean(env?.SUPABASE_SERVICE_ROLE_KEY?.trim()),
      supabaseWriteAttempted: false,
      upstreamStatus: upstream.status,
      mode,
      imageCount: images.length,
      userMessageWrite: "fail",
      assistantMessageWrite: "fail",
      userMessageError: "",
      assistantMessageError: ""
    };

    const userResult = await insertSupabaseMessage(env, {
      session_id: sessionId,
      role: "user",
      content: message,
      source,
      mode,
      message_type: userMessageType,
      attachments: images,
      meta: {
        from_voice: fromVoice
      },
      ts: Date.now()
    }).catch((e) => ({ ok: false, skipped: false, error: String(e?.message || e || "exception") }));

    const assistantContent = mode === "dev"
      ? (devOutput?.human_summary || text || "")
      : (text || "");
    const assistantMessageType = mode === "dev" ? "dev_summary" : "normal_text";
    const assistantResult = await insertSupabaseMessage(env, {
      session_id: sessionId,
      role: "assistant",
      content: assistantContent,
      source,
      mode,
      message_type: assistantMessageType,
      attachments: [],
      meta: mode === "dev" ? { has_cursor_task: Boolean(devOutput?.cursor_task_prompt) } : {},
      ts: Date.now()
    }).catch((e) => ({ ok: false, skipped: false, error: String(e?.message || e || "exception") }));

    if (mode === "dev" && devOutput?.cursor_task_prompt) {
      await insertSupabaseMessage(env, {
        session_id: sessionId,
        role: "assistant",
        content: devOutput.cursor_task_prompt,
        source,
        mode: "dev",
        message_type: "cursor_task",
        attachments: [],
        meta: {
          title: devOutput.cursor_task_title || "开发任务"
        },
        ts: Date.now()
      }).catch(() => null);
    }

    let taskWrite = { ok: false, skipped: true, reason: "not_requested" };
    if (mode === "dev" && body?.save_task === true && devOutput?.cursor_task_prompt) {
      taskWrite = await insertSupabaseTask(env, {
        session_id: sessionId,
        title: devOutput.cursor_task_title || "开发任务",
        status: "pending",
        task_content: devOutput.cursor_task_prompt,
        source,
        ts: Date.now()
      }).catch((e) => ({ ok: false, skipped: false, error: String(e?.message || e || "exception") }));
    }

    debug.supabaseWriteAttempted = !userResult.skipped || !assistantResult.skipped;
    debug.userMessageWrite = userResult.ok ? "success" : "fail";
    debug.assistantMessageWrite = assistantResult.ok ? "success" : "fail";
    debug.userMessageError = userResult.ok ? "" : (userResult.reason || userResult.error || "fail");
    debug.assistantMessageError = assistantResult.ok ? "" : (assistantResult.reason || assistantResult.error || "fail");
    debug.taskWrite = taskWrite.ok ? "success" : (taskWrite.skipped ? "skipped" : "fail");
    debug.taskWriteError = taskWrite.ok ? "" : (taskWrite.reason || taskWrite.error || "");

    return jsonResponse({
      ok: true,
      session_id: sessionId,
      text: mode === "dev" ? (devOutput?.human_summary || text) : text,
      dev_output: devOutput,
      debug
    });
  } catch (error) {
    if (String(error).includes("timeout")) {
      return jsonResponse(
        {
          ok: false,
          error: "upstream_timeout",
          message: "AI 请求超时，请稍后重试。"
        },
        504
      );
    }

    return jsonResponse(
      {
        ok: false,
        error: "internal_error",
        message: error?.message || "服务内部错误，请稍后重试。"
      },
      500
    );
  } finally {
    clearTimeout(timeout);
  }
}