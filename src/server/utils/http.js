import fs from "node:fs/promises";
import path from "node:path";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

export function createHttpError(statusCode, message, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

export async function readJsonBody(request, limitBytes) {
  const contentType = request.headers["content-type"] || "";

  if (!contentType.includes("application/json")) {
    throw createHttpError(415, "Expected application/json request body.");
  }

  const chunks = [];
  let totalSize = 0;

  for await (const chunk of request) {
    totalSize += chunk.length;

    if (totalSize > limitBytes) {
      throw createHttpError(413, "Request body is too large.");
    }

    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw createHttpError(400, "Malformed JSON request body.");
  }
}

export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

export function sendError(response, error) {
  const statusCode = error.statusCode || 500;
  const message = error.message || "Internal server error.";

  sendJson(response, statusCode, {
    error: {
      message,
      details: error.details || null,
    },
  });
}

export async function serveStaticFile(response, projectRoot, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = path.normalize(safePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(projectRoot, normalizedPath);

  if (!absolutePath.startsWith(projectRoot)) {
    throw createHttpError(403, "Forbidden.");
  }

  let fileContent;

  try {
    fileContent = await fs.readFile(absolutePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw createHttpError(404, "Not found.");
    }

    throw error;
  }

  const extension = path.extname(absolutePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=60",
  });
  response.end(fileContent);
}
