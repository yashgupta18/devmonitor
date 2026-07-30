import fs from "node:fs";
import path from "node:path";

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

export function createTraceStorage(options = {}) {
  const backend = options.storageBackend ?? "memory";
  if (backend === "file") {
    const filePath =
      options.traceStorePath ??
      path.resolve(process.cwd(), ".devtracekit/traces.ndjson");
    return new FileTraceStore({
      filePath,
      maxTraces: options.maxTraces ?? 1000,
    });
  }

  return new InMemoryTraceStore({ maxTraces: options.maxTraces ?? 1000 });
}

export class InMemoryTraceStore {
  constructor(options = {}) {
    this.maxTraces = options.maxTraces ?? 1000;
    this.traces = [];
    this.traceIndex = new Map();
  }

  add(trace) {
    this.traces.push(trace);
    this.traceIndex.set(trace.traceId, trace);
    this.enforceRetention();
  }

  get(traceId) {
    return this.traceIndex.get(traceId) ?? null;
  }

  values() {
    return this.traces;
  }

  removeOldest() {
    const oldest = this.traces.shift();
    if (!oldest) {
      return null;
    }

    this.traceIndex.delete(oldest.traceId);
    return oldest;
  }

  enforceRetention() {
    while (this.traces.length > this.maxTraces) {
      this.removeOldest();
    }
  }

  size() {
    return this.traces.length;
  }
}

export class FileTraceStore extends InMemoryTraceStore {
  constructor(options = {}) {
    super(options);
    this.filePath = options.filePath;
    ensureDirForFile(this.filePath);
    this.loadFromDisk();
  }

  loadFromDisk() {
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    const text = fs.readFileSync(this.filePath, "utf8");
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      try {
        const trace = JSON.parse(line);
        if (!trace?.traceId) {
          continue;
        }
        this.traces.push(trace);
        this.traceIndex.set(trace.traceId, trace);
      } catch {
        // Ignore malformed lines to keep store usable.
      }
    }

    this.enforceRetention();
  }

  persistAll() {
    ensureDirForFile(this.filePath);
    const payload = this.traces
      .map((trace) => JSON.stringify(trace))
      .join("\n");
    fs.writeFileSync(this.filePath, `${payload}${payload ? "\n" : ""}`, "utf8");
  }

  add(trace) {
    super.add(trace);
    this.persistAll();
  }

  removeOldest() {
    const removed = super.removeOldest();
    if (removed) {
      this.persistAll();
    }
    return removed;
  }
}

export class TimeSeriesStore {
  constructor(options = {}) {
    this.retentionMinutes = Math.max(
      5,
      Number(options.retentionMinutes ?? 1440),
    );
    this.bucketSizeMs = 60_000;
    this.buckets = new Map();
  }

  makeKey(trace) {
    return `${trace.tenantId}:${trace.projectId}:${trace.environment}:${trace.service}`;
  }

  bucketStart(timestampMs) {
    return Math.floor(timestampMs / this.bucketSizeMs) * this.bucketSizeMs;
  }

  recordTrace(trace) {
    if (!Number.isFinite(trace.endTimeMs ?? trace.startTimeMs)) {
      return;
    }

    const timestampMs = trace.endTimeMs ?? trace.startTimeMs;
    const startMs = this.bucketStart(timestampMs);
    const key = this.makeKey(trace);
    const fullKey = `${key}:${startMs}`;

    const bucket = this.buckets.get(fullKey) ?? {
      key,
      startMs,
      tenantId: trace.tenantId,
      projectId: trace.projectId,
      environment: trace.environment,
      service: trace.service,
      requestCount: 0,
      errorCount: 0,
      totalDurationMs: 0,
      durations: [],
    };

    bucket.requestCount += 1;
    if ((trace.statusCode ?? 0) >= 500 || trace.error) {
      bucket.errorCount += 1;
    }

    const duration = Number.isFinite(trace.durationMs) ? trace.durationMs : 0;
    bucket.totalDurationMs += duration;
    bucket.durations.push(duration);

    this.buckets.set(fullKey, bucket);
    this.evictOldBuckets(timestampMs);
  }

  evictOldBuckets(referenceMs = Date.now()) {
    const oldestAllowed =
      referenceMs - this.retentionMinutes * this.bucketSizeMs;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.startMs < oldestAllowed) {
        this.buckets.delete(key);
      }
    }
  }

  listBuckets(options = {}) {
    const now = Date.now();
    const windowMinutes = Math.max(1, Number(options.windowMinutes ?? 60));
    const cutoff = now - windowMinutes * this.bucketSizeMs;

    const buckets = [];
    for (const bucket of this.buckets.values()) {
      if (bucket.startMs < cutoff) {
        continue;
      }
      if (options.tenantId && bucket.tenantId !== options.tenantId) {
        continue;
      }
      if (options.projectId && bucket.projectId !== options.projectId) {
        continue;
      }
      if (options.environment && bucket.environment !== options.environment) {
        continue;
      }
      if (options.service && bucket.service !== options.service) {
        continue;
      }
      buckets.push(bucket);
    }

    return buckets.sort((a, b) => a.startMs - b.startMs);
  }
}
