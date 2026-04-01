export class EmbeddingsService {
  constructor(ollamaClient) {
    this.ollamaClient = ollamaClient;
  }

  async embedText(text) {
    return this.ollamaClient.embed(text);
  }
}
