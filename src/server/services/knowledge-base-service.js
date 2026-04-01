import fs from "node:fs/promises";
import path from "node:path";

import { chunkText, checksum, cosineSimilarity, normalizeWhitespace } from "../utils/text.js";

export class KnowledgeBaseService {
  constructor({ knowledgeBaseDir, indexStore, embeddingsService, embeddingModel }) {
    this.knowledgeBaseDir = knowledgeBaseDir;
    this.indexStore = indexStore;
    this.embeddingsService = embeddingsService;
    this.embeddingModel = embeddingModel;
    this.rebuildPromise = null;
  }

  async ensureIndex() {
    if (!this.rebuildPromise) {
      this.rebuildPromise = this.ensureIndexInner().finally(() => {
        this.rebuildPromise = null;
      });
    }

    return this.rebuildPromise;
  }

  async retrieve(query, topK = 4) {
    const normalizedQuery = normalizeWhitespace(query);

    if (!normalizedQuery) {
      return [];
    }

    try {
      await this.ensureIndex();
    } catch {
      return [];
    }

    const index = await this.indexStore.read();

    if (!Array.isArray(index.chunks) || index.chunks.length === 0) {
      return [];
    }

    const queryEmbedding = await this.embeddingsService.embedText(normalizedQuery);

    return index.chunks
      .map((chunk) => ({
        ...chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, topK)
      .filter((chunk) => chunk.score > 0)
      .map((chunk) => ({
        id: chunk.id,
        source: chunk.source,
        title: chunk.title,
        text: chunk.text,
        score: Number(chunk.score.toFixed(4)),
      }));
  }

  async ensureIndexInner() {
    const documents = await this.loadDocuments();
    const currentSignature = checksum(
      JSON.stringify({
        embeddingModel: this.embeddingModel,
        documents: documents.map((document) => ({
          path: document.path,
          checksum: document.checksum,
        })),
      })
    );

    const index = await this.indexStore.read();

    if (index.signature === currentSignature && Array.isArray(index.chunks) && index.chunks.length > 0) {
      return index;
    }

    const chunks = [];

    for (const document of documents) {
      const textChunks = chunkText(document.text);

      for (let indexPosition = 0; indexPosition < textChunks.length; indexPosition += 1) {
        const text = textChunks[indexPosition];
        const embedding = await this.embeddingsService.embedText(text);
        chunks.push({
          id: `${document.id}#${indexPosition + 1}`,
          source: document.path,
          title: document.title,
          text,
          embedding,
        });
      }
    }

    const nextIndex = {
      builtAt: new Date().toISOString(),
      embeddingModel: this.embeddingModel,
      signature: currentSignature,
      documents: documents.map((document) => ({
        id: document.id,
        path: document.path,
        title: document.title,
        checksum: document.checksum,
      })),
      chunks,
    };

    await this.indexStore.write(nextIndex);
    return nextIndex;
  }

  async loadDocuments() {
    const entries = await this.walkDirectory(this.knowledgeBaseDir);
    const documents = [];

    for (const entry of entries) {
      const extension = path.extname(entry).toLowerCase();

      if (![".md", ".txt", ".text", ".json"].includes(extension)) {
        continue;
      }

      const raw = await fs.readFile(entry, "utf8");
      const relativePath = path.relative(this.knowledgeBaseDir, entry);
      const title = path.basename(entry, extension).replace(/[_-]+/g, " ").trim() || relativePath;
      documents.push({
        id: checksum(relativePath).slice(0, 12),
        path: relativePath,
        title,
        text: raw,
        checksum: checksum(raw),
      });
    }

    return documents.sort((left, right) => left.path.localeCompare(right.path));
  }

  async walkDirectory(directoryPath) {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await this.walkDirectory(entryPath)));
        continue;
      }

      files.push(entryPath);
    }

    return files;
  }
}
