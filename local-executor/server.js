import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeInstruction } from "./executor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const port = Number(process.env.LOCAL_EXECUTOR_PORT || 47811);

const allowedOrigins = new Set([
  "https://globalhumansignal.com",
  "http://127.0.0.1:8787",
  "http://localhost:8787",
  "null"
]);

function writeJson(res, status, payload, origin = "*") {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
      if (raw.length > 5 * 1024 * 1024) {
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || "");
  const corsOrigin = allowedOrigins.has(origin) ? origin : "*";
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    writeJson(res, 204, {}, corsOrigin);
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    writeJson(res, 200, { ok: true, projectRoot }, corsOrigin);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/dev/execute") {
    try {
      const body = await parseBody(req);
      const result = await executeInstruction(projectRoot, body);
      writeJson(res, 200, {
        ok: true,
        projectRoot,
        result
      }, corsOrigin);
      return;
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        message: error?.message || "execute failed"
      }, corsOrigin);
      return;
    }
  }

  writeJson(res, 404, { ok: false, message: "not found" }, corsOrigin);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[local-executor] running at http://127.0.0.1:${port}`);
  console.log(`[local-executor] project root: ${projectRoot}`);
});
