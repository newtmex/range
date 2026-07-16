import "server-only";

import { logger } from "../logger";

// Caching is abstracted behind CacheStore so the in-memory default can be
// swapped for Redis / Vercel KV later without touching service logic. To keep
// that swap honest, only store JSON-serializable values (services serialize
// bigints to strings before caching).

export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

/**
 * Per-instance in-memory cache. On serverless this lives only as long as the
 * warm instance and is not shared across instances — acceptable for the
 * current TTLs, and exactly what the CacheStore interface exists to replace.
 */
class MemoryCache implements CacheStore {
  private entries = new Map<string, Entry>();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

const defaultCache: CacheStore = new MemoryCache();

export function getCache(): CacheStore {
  return defaultCache;
}

/**
 * Read-through helper: returns the cached value for `key` or computes, stores,
 * and returns it. Logs hit/miss so cache effectiveness shows up in the logs.
 */
export async function cached<T>(
  cache: CacheStore,
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== undefined) {
    logger.info("cache", { key, cache: "hit" });
    return hit;
  }
  logger.info("cache", { key, cache: "miss" });
  const value = await compute();
  await cache.set(key, value, ttlSeconds);
  return value;
}
