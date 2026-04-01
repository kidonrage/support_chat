import { createHttpError } from "../utils/http.js";

export class OllamaClient {
  constructor({ baseUrl, chatModel, summaryModel, embeddingModel }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.chatModel = chatModel;
    this.summaryModel = summaryModel;
    this.embeddingModel = embeddingModel;
  }

  async generate({ model, system, prompt, format = null, temperature = 0.2, timeoutMs = 90000 }) {
    const payload = {
      model,
      system,
      prompt,
      stream: false,
      format: format || undefined,
      options: {
        temperature,
      },
    };

    const response = await this.fetchJson("/api/generate", payload, timeoutMs);
    return String(response.response || "").trim();
  }

  async embed(text, timeoutMs = 30000) {
    try {
      const response = await this.fetchJson(
        "/api/embed",
        {
          model: this.embeddingModel,
          input: [text],
        },
        timeoutMs
      );

      if (Array.isArray(response.embeddings) && Array.isArray(response.embeddings[0])) {
        return response.embeddings[0];
      }
    } catch (error) {
      if (error.statusCode && error.statusCode !== 404) {
        throw error;
      }
    }

    const legacyResponse = await this.fetchJson(
      "/api/embeddings",
      {
        model: this.embeddingModel,
        prompt: text,
      },
      timeoutMs
    );

    if (!Array.isArray(legacyResponse.embedding)) {
      throw createHttpError(503, "Ollama embeddings endpoint returned an invalid payload.");
    }

    return legacyResponse.embedding;
  }

  async fetchJson(pathname, body, timeoutMs) {
    let response;

    try {
      response = await fetch(`${this.baseUrl}${pathname}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw createHttpError(503, "Ollama is unavailable. Start the local Ollama daemon and required models.", {
        cause: error.message,
      });
    }

    let payload = null;
    const raw = await response.text();

    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = {
          raw,
        };
      }
    }

    if (!response.ok) {
      throw createHttpError(503, "Ollama request failed.", {
        status: response.status,
        body: payload,
      });
    }

    return payload || {};
  }
}
