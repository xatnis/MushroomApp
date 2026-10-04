/// <reference types="node" />
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

/** Immutable research responses, not the app's live-weather cache. URLs/coordinates stay ignored. */
export class ResearchCache {
  requests = 0;
  hits = 0;
  joins = 0;
  manifest = new Map<string, { url: string; downloadedAt: string; sha256: string }>();
  private pending = new Map<string, Promise<any>>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastStart = 0;
  constructor(private directory: string, private offline = false, private spacingMs = 2000,
    private transport: typeof fetch = fetch) { mkdirSync(directory, { recursive: true }); }

  get(url: string): Promise<any> {
    const filename = resolve(this.directory, hash(url) + '.json');
    if (existsSync(filename)) {
      const cached = JSON.parse(readFileSync(filename, 'utf8'));
      if (cached.url !== url || cached.sha256 !== hash(JSON.stringify(cached.data))) throw new Error('Corrupt research cache.');
      this.hits++; this.manifest.set(url, { url, downloadedAt: cached.downloadedAt, sha256: cached.sha256 });
      return Promise.resolve(cached.data);
    }
    const inflight = this.pending.get(url);
    if (inflight) { this.joins++; return inflight; }
    if (this.offline) return Promise.reject(new Error('Offline cache miss.'));
    const task = this.queue.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await sleep(Math.max(0, this.lastStart + this.spacingMs - Date.now()));
        this.lastStart = Date.now(); this.requests++;
        try {
          const response = await this.transport(url, { signal: AbortSignal.timeout(30000),
            headers: { 'User-Agent': 'MushroomApp-occurrence-validation/2 (non-commercial research)' } });
          if (!response.ok) {
            const retrySeconds = Number(response.headers.get('retry-after'));
            if (response.status === 429 && Number.isFinite(retrySeconds) && retrySeconds > 0) await sleep(Math.min(retrySeconds * 1000, 60000));
            throw new Error(`HTTP ${response.status}`);
          }
          const data = await response.json();
          const envelope = { url, downloadedAt: new Date().toISOString(), sha256: hash(JSON.stringify(data)), data };
          const temporary = filename + '.tmp';
          writeFileSync(temporary, JSON.stringify(envelope));
          renameSync(temporary, filename); // A cancelled run cannot leave a truncated entry masquerading as a cache hit.
          this.manifest.set(url, { url, downloadedAt: envelope.downloadedAt, sha256: envelope.sha256 });
          return data;
        } catch (error) {
          if (attempt === 2) throw error;
          await sleep(2000 * 2 ** attempt);
        }
      }
      throw new Error('Unreachable');
    });
    this.queue = task.catch(() => undefined);
    this.pending.set(url, task);
    void task.finally(() => this.pending.delete(url)).catch(() => undefined);
    return task;
  }
}
