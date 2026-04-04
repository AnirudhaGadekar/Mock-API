/**
 * stateful-store.ts — Schema-less JSON store with CRUD + filter/sort/push.
 *
 * This is the MockAPI differentiator: persistent stateful mocking.
 * Data persists across requests and supports rich querying.
 /**
 * Operations:
 *   push(scopeId, collection, item)
 *   get(scopeId, path)            — JSONPath-like: "movies.0.title"
 *   set(scopeId, path, value)
 *   list(scopeId, collection, opts)  — filter, sort, limit, offset
 *   remove(scopeId, path)
 *   count(scopeId, collection)
 *   clear(scopeId)
 *
 * Scopes:
 * - endpoint:{id}
 * - workspace:{id}
 * - session:{id}
 */
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

const STORE_PREFIX = 'mockapi:store:';
const STORE_TTL = 60 * 60 * 24 * 7; // 7 days

// ─── Deep path helpers ──────────────────────────────────────────────────────

/**
 * Get a value at a dot-separated path from a nested object.
 * Supports array indices: "movies.0.title"
 */
export function deepGet(obj: unknown, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
        if (current == null || typeof current !== 'object') return undefined;

        const idx = parseInt(part);
        if (Array.isArray(current) && !isNaN(idx)) {
            current = current[idx];
        } else {
            current = (current as Record<string, unknown>)[part];
        }
    }
    return current;
}

/**
 * Set a value at a dot-separated path, creating intermediate objects/arrays.
 */
export function deepSet(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const nextPart = parts[i + 1];
        const nextIsIndex = !isNaN(parseInt(nextPart));

        if (current[part] == null) {
            current[part] = nextIsIndex ? [] : {};
        }
        current = current[part] as Record<string, unknown>;
    }

    const lastPart = parts[parts.length - 1];
    const idx = parseInt(lastPart);
    if (Array.isArray(current) && !isNaN(idx)) {
        (current as unknown[])[idx] = value;
    } else {
        current[lastPart] = value;
    }
}

/**
 * Delete a value at a dot-separated path.
 */
export function deepDelete(obj: Record<string, unknown>, path: string): boolean {
    const parts = path.split('.');
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (current[part] == null || typeof current[part] !== 'object') return false;
        current = current[part] as Record<string, unknown>;
    }

    const lastPart = parts[parts.length - 1];
    const idx = parseInt(lastPart);
    if (Array.isArray(current) && !isNaN(idx)) {
        (current as unknown[]).splice(idx, 1);
        return true;
    }
    if (lastPart in current) {
        delete current[lastPart];
        return true;
    }
    return false;
}

// ─── Redis persistence ──────────────────────────────────────────────────────

function storeKey(scopeId: string): string {
    // If scopeId already has a prefix, use it. Otherwise default to endpoint scope.
    if (scopeId.includes(':')) {
        return STORE_PREFIX + scopeId;
    }
    return STORE_PREFIX + 'endpoint:' + scopeId;
}

/**
 * Atomic store operations using Redis WATCH/MULTI/EXEC pattern
 */
async function atomicStoreOperation<T>(
    scopeId: string,
    operation: (store: Record<string, unknown>) => { newStore: Record<string, unknown>; result: T }
): Promise<T> {
    const key = storeKey(scopeId);
    const maxRetries = 5;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // Watch the key for changes
            await redis.watch(key);

            // Load current store
            const raw = await redis.get(key);
            let store: Record<string, unknown> = {};
            if (raw) {
                try {
                    store = JSON.parse(raw);
                } catch {
                    store = {};
                }
            }

            // Perform operation
            const { newStore, result } = operation(store);

            // Execute transaction
            const multi = redis.multi();
            multi.setex(key, STORE_TTL, JSON.stringify(newStore));
            const execResult = await multi.exec();

            // If execResult is null, the key was modified (watch failed), retry
            if (execResult === null) {
                if (attempt < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1))); // Exponential backoff
                    continue;
                }
                throw new Error('Store operation failed after max retries due to concurrent modifications');
            }

            return result;
        } catch (err) {
            if (attempt === maxRetries - 1) {
                throw err;
            }
            await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
        }
    }

    throw new Error('Store operation failed after max retries');
}

async function loadStore(scopeId: string): Promise<Record<string, unknown>> {
    try {
        const key = storeKey(scopeId);
        const raw = await redis.get(key);
        if (raw) {
            return JSON.parse(raw);
        }
    } catch (err) {
        logger.error(`Store load error for ${scopeId}: ${(err as Error).message}`);
    }
    return {};
}

async function saveStore(scopeId: string, data: Record<string, unknown>): Promise<void> {
    try {
        const key = storeKey(scopeId);
        await redis.setex(key, STORE_TTL, JSON.stringify(data));
    } catch (err) {
        logger.error(`Store save error for ${scopeId}: ${(err as Error).message}`);
    }
}

// ─── Filter engine (built-in, no external deps) ────────────────────────────

interface FilterOp {
    field: string;
    op: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'startsWith' | 'endsWith' | 'exists';
    value?: unknown;
}

/**
 * Parse a simple filter string like "price>100" or "name==John" or "active==true"
 */
export function parseFilter(filterStr: string): FilterOp | null {
    const ops: Array<{ op: FilterOp['op']; token: string }> = [
        { op: '>=', token: '>=' },
        { op: '<=', token: '<=' },
        { op: '!=', token: '!=' },
        { op: '==', token: '==' },
        { op: '>', token: '>' },
        { op: '<', token: '<' },
        { op: 'contains', token: ' contains ' },
        { op: 'startsWith', token: ' startsWith ' },
        { op: 'endsWith', token: ' endsWith ' },
    ];

    for (const { op, token } of ops) {
        const idx = filterStr.indexOf(token);
        if (idx > 0) {
            const field = filterStr.slice(0, idx).trim();
            const rawValue = filterStr.slice(idx + token.length).trim();
            let value: unknown = rawValue;

            // Parse value types
            if (rawValue === 'true') value = true;
            else if (rawValue === 'false') value = false;
            else if (rawValue === 'null') value = null;
            else if (!isNaN(Number(rawValue)) && rawValue !== '') value = Number(rawValue);
            else if (rawValue.startsWith('"') && rawValue.endsWith('"')) value = rawValue.slice(1, -1);

            return { field, op, value };
        }
    }

    // "exists" operator: just a field name
    if (/^[a-zA-Z0-9_.]+$/.test(filterStr.trim())) {
        return { field: filterStr.trim(), op: 'exists' };
    }

    return null;
}

/**
 * Check if an item matches a filter operation.
 */
function matchesFilter(item: unknown, filter: FilterOp): boolean {
    if (typeof item !== 'object' || item == null) return false;
    const fieldValue = deepGet(item, filter.field);

    switch (filter.op) {
        case '==': return fieldValue === filter.value;
        case '!=': return fieldValue !== filter.value;
        case '>': return typeof fieldValue === 'number' && typeof filter.value === 'number' && fieldValue > filter.value;
        case '<': return typeof fieldValue === 'number' && typeof filter.value === 'number' && fieldValue < filter.value;
        case '>=': return typeof fieldValue === 'number' && typeof filter.value === 'number' && fieldValue >= filter.value;
        case '<=': return typeof fieldValue === 'number' && typeof filter.value === 'number' && fieldValue <= filter.value;
        case 'contains': return typeof fieldValue === 'string' && typeof filter.value === 'string' && fieldValue.toLowerCase().includes(filter.value.toLowerCase());
        case 'startsWith': return typeof fieldValue === 'string' && typeof filter.value === 'string' && fieldValue.toLowerCase().startsWith(filter.value.toLowerCase());
        case 'endsWith': return typeof fieldValue === 'string' && typeof filter.value === 'string' && fieldValue.toLowerCase().endsWith(filter.value.toLowerCase());
        case 'exists': return fieldValue !== undefined && fieldValue !== null;
        default: return true;
    }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface ListOptions {
    filter?: string;       // e.g. "price>100"
    sort?: string;         // e.g. "name" or "-price" (prefix - for desc)
    limit?: number;
    offset?: number;
}

export const statefulStore = {
    /**
     * Push an item onto an array collection. Creates the array if it doesn't exist.
     * Uses atomic Redis transaction to prevent race conditions.
     */
    async push(scopeId: string, collection: string, item: unknown): Promise<{ index: number; item: unknown }> {
        try {
            return await atomicStoreOperation(scopeId, (store) => {
                if (!Array.isArray(store[collection])) {
                    store[collection] = [];
                }
                const arr = store[collection] as unknown[];
                arr.push(item);
                return { newStore: store, result: { index: arr.length - 1, item } };
            });
        } catch (err) {
            logger.error(`Store push error for ${scopeId}: ${(err as Error).message}`);
            // Fallback to non-atomic operation
            const store = await loadStore(scopeId);
            if (!Array.isArray(store[collection])) {
                store[collection] = [];
            }
            const arr = store[collection] as unknown[];
            arr.push(item);
            await saveStore(scopeId, store);
            return { index: arr.length - 1, item };
        }
    },

    /**
     * Get a value at a path. Supports dot-notation: "movies.0.title"
     */
    async get(scopeId: string, path: string): Promise<unknown> {
        const store = await loadStore(scopeId);
        return deepGet(store, path);
    },

    /**
     * Set a value at a path. Creates intermediate objects/arrays.
     * Uses atomic Redis transaction to prevent race conditions.
     */
    async set(scopeId: string, path: string, value: unknown): Promise<void> {
        try {
            await atomicStoreOperation(scopeId, (store) => {
                deepSet(store, path, value);
                return { newStore: store, result: undefined };
            });
        } catch (err) {
            logger.error(`Store set error for ${scopeId}: ${(err as Error).message}`);
            // Fallback to non-atomic operation
            const store = await loadStore(scopeId);
            deepSet(store, path, value);
            await saveStore(scopeId, store);
        }
    },

    /**
     * List items in a collection with optional filter, sort, limit, offset.
     */
    async list(scopeId: string, collection: string, opts: ListOptions = {}): Promise<{ items: unknown[]; total: number }> {
        const store = await loadStore(scopeId);
        const data = store[collection];
        if (!Array.isArray(data)) return { items: [], total: 0 };

        let items = data as unknown[];

        // Apply filter
        if (opts.filter) {
            const filterOp = parseFilter(opts.filter);
            if (filterOp) {
                items = items.filter((item) => matchesFilter(item, filterOp));
            }
        }

        const total = items.length;

        // Apply sort
        if (opts.sort) {
            const desc = opts.sort.startsWith('-');
            const sortField = desc ? opts.sort.slice(1) : opts.sort;
            items = [...items].sort((a, b) => {
                const va = deepGet(a, sortField);
                const vb = deepGet(b, sortField);
                if (va == null && vb == null) return 0;
                if (va == null) return 1;
                if (vb == null) return -1;
                if (typeof va === 'string' && typeof vb === 'string') {
                    return desc ? vb.localeCompare(va) : va.localeCompare(vb);
                }
                if (typeof va === 'number' && typeof vb === 'number') {
                    return desc ? vb - va : va - vb;
                }
                return 0;
            });
        }

        // Apply pagination
        const offset = opts.offset ?? 0;
        const limit = opts.limit ?? 100;
        items = items.slice(offset, offset + limit);

        return { items, total };
    },

    /**
     * Count items in a collection, optionally with a filter.
     */
    async count(scopeId: string, collection: string, filter?: string): Promise<number> {
        const store = await loadStore(scopeId);
        const data = store[collection];
        if (!Array.isArray(data)) return 0;

        let items = data as unknown[];

        if (filter) {
            const filterOp = parseFilter(filter);
            if (filterOp) {
                items = items.filter((item) => matchesFilter(item, filterOp));
            }
        }
        return items.length;
    },

    /**
     * Remove a value at a path.
     * Uses atomic Redis transaction to prevent race conditions.
     */
    async remove(scopeId: string, path: string): Promise<boolean> {
        try {
            return await atomicStoreOperation(scopeId, (store) => {
                const deleted = deepDelete(store, path);
                return { newStore: store, result: deleted };
            });
        } catch (err) {
            logger.error(`Store remove error for ${scopeId}: ${(err as Error).message}`);
            // Fallback to non-atomic operation
            const store = await loadStore(scopeId);
            const deleted = deepDelete(store, path);
            if (deleted) await saveStore(scopeId, store);
            return deleted;
        }
    },

    /**
     * Get the entire store for an endpoint.
     */
    async getAll(scopeId: string): Promise<Record<string, unknown>> {
        return loadStore(scopeId);
    },

    /**
     * Clear the entire store for an endpoint.
     */
    async clear(scopeId: string): Promise<void> {
        try {
            await redis.del(storeKey(scopeId));
        } catch (err) {
            logger.error(`Store clear error: ${(err as Error).message}`);
        }
    },
};
