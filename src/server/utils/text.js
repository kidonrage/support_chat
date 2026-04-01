import crypto from "node:crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix) {
  const timePart = Date.now().toString(36);
  const randomPart = crypto.randomBytes(4).toString("hex");
  return `${prefix}_${timePart}${randomPart}`;
}

export function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncate(value, maxLength) {
  const text = String(value || "").trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function extractJsonObject(rawText) {
  const text = String(rawText || "").trim();

  if (!text) {
    return null;
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : text;

  try {
    return JSON.parse(candidate);
  } catch {
    const startIndex = candidate.indexOf("{");
    const endIndex = candidate.lastIndexOf("}");

    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
      return null;
    }

    try {
      return JSON.parse(candidate.slice(startIndex, endIndex + 1));
    } catch {
      return null;
    }
  }
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) {
    return 0;
  }

  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < length; index += 1) {
    const a = Number(left[index]) || 0;
    const b = Number(right[index]) || 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function checksum(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function chunkText(text, maxChunkLength = 700, overlapLength = 120) {
  const cleanText = normalizeWhitespace(text);

  if (!cleanText) {
    return [];
  }

  const paragraphs = cleanText.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const chunks = [];
  let currentChunk = "";

  const pushCurrentChunk = () => {
    const normalized = normalizeWhitespace(currentChunk);

    if (!normalized) {
      return;
    }

    chunks.push(normalized);
    currentChunk = normalized.slice(Math.max(0, normalized.length - overlapLength));
  };

  paragraphs.forEach((paragraph) => {
    if (!currentChunk) {
      currentChunk = paragraph;
      return;
    }

    const candidate = `${currentChunk}\n\n${paragraph}`;

    if (candidate.length <= maxChunkLength) {
      currentChunk = candidate;
      return;
    }

    pushCurrentChunk();

    if (paragraph.length <= maxChunkLength) {
      currentChunk = paragraph;
      return;
    }

    let offset = 0;
    while (offset < paragraph.length) {
      const slice = paragraph.slice(offset, offset + maxChunkLength);
      currentChunk = slice;
      pushCurrentChunk();
      offset += Math.max(1, maxChunkLength - overlapLength);
    }
    currentChunk = "";
  });

  pushCurrentChunk();
  return chunks;
}

export function titleCaseFromText(value) {
  const words = normalizeWhitespace(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);

  if (words.length === 0) {
    return "New ticket";
  }

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
