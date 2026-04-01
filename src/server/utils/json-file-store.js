import fs from "node:fs/promises";
import path from "node:path";

export class JsonFileStore {
  constructor(filePath, defaultValue) {
    this.filePath = filePath;
    this.defaultValue = defaultValue;
    this.writeChain = Promise.resolve();
  }

  async ensure() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await fs.access(this.filePath);
    } catch {
      await this.writeFile(structuredClone(this.defaultValue));
    }
  }

  async read() {
    await this.ensure();
    const raw = await fs.readFile(this.filePath, "utf8");

    if (!raw.trim()) {
      return structuredClone(this.defaultValue);
    }

    return JSON.parse(raw);
  }

  async write(value) {
    await this.ensure();
    return this.writeFile(value);
  }

  async writeFile(value) {
    const tempPath = `${this.filePath}.tmp`;
    const serialized = JSON.stringify(value, null, 2);
    await fs.writeFile(tempPath, `${serialized}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
    return value;
  }

  async update(mutator) {
    const run = async () => {
      const currentValue = await this.read();
      const nextValue = await mutator(currentValue);
      return this.write(nextValue);
    };

    this.writeChain = this.writeChain.then(run, run);
    return this.writeChain;
  }
}
