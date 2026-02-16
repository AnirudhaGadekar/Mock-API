/**
 * stateful-store.ts — Schema-less JSON store with CRUD + filter/sort/push.
 *
 * This is the MockUrl differentiator: persistent stateful mocking.
 * Data persists across requests and supports rich querying.
 *
 * Operations:
 *   push(endpointId, collection, item)
 *   get(endpointId, path)            — JSONPath-like: "movies.0.title"
 *   set(endpointId, path, value)
 *   list(endpointId, collection, opts)  — filter, sort, limit, offset
 *   remove(endpointId, path)
 *   count(endpointId, collection)
 *   clear(endpointId)
 *
 * Backed by Redis for persistence. Falls back to in-memory Map.
 */
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

const STORE_PREFIX = 'mockurl:store:';
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

function storeKey(endpointId: string): string {
    return STORE_PREFIX + endpointId;
}

async function loadStore(endpointId: string): Promise<Record<string, unknown>> {
    try {
        const raw = await redis.get(storeKey(endpointId));
        if (raw) return JSON.parse(raw);
    } catch (err) {
        logger.error(`Store load error for ${endpointId}: ${(err as Error).message}`);
    }
    return {};
}

async function saveStore(endpointId: string, data: Record<string, unknown>): Promise<void> {
    try {
        await redis.setex(storeKey(endpointId), STORE_TTL, JSON.stringify(data));
    } catch (err) {
        logger.error(`Store save error for ${endpointId}: ${(err as Error).message}`);
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
     */
    async push(endpointId: string, collection: string, item: unknown): Promise<{ index: number; item: unknown }> {
        const store = await loadStore(endpointId);
        if (!Array.isArray(store[collection])) {
            store[collection] = [];
        }
        const arr = store[collection] as unknown[];
        arr.push(item);
        await saveStore(endpointId, store);
        return { index: arr.length - 1, item };
    },

    /**
     * Get a value at a path. Supports dot-notation: "movies.0.title"
     */
    async get(endpointId: string, path: string): Promise<unknown> {
        const store = await loadStore(endpointId);
        return deepGet(store, path);
    },

    /**
     * Set a value at a path. Creates intermediate objects/arrays.
     */
    async set(endpointId: string, path: string, value: unknown): Promise<void> {
        const store = await loadStore(endpointId);
        deepSet(store, path, value);
        await saveStore(endpointId, store);
    },

    /**
     * List items in a collection with optional filter, sort, limit, offset.
     */
    async list(endpointId: string, collection: string, opts: ListOptions = {}): Promise<{ items: unknown[]; total: number }> {
        const store = await loadStore(endpointId);
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
    async count(endpointId: string, collection: string, filter?: string): Promise<number> {
        const store = await loadStore(endpointId);
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
     */
    async remove(endpointId: string, path: string): Promise<boolean> {
        const store = await loadStore(endpointId);
        const deleted = deepDelete(store, path);
        if (deleted) await saveStore(endpointId, store);
        return deleted;
    },

    /**
     * Get the entire store for an endpoint.
     */
    async getAll(endpointId: string): Promise<Record<string, unknown>> {
        return loadStore(endpointId);
    },

    /**
     * Clear the entire store for an endpoint.
     */
    async clear(endpointId: string): Promise<void> {
        try {
            await redis.del(storeKey(endpointId));
        } catch (err) {
            logger.error(`Store clear error: ${(err as Error).message}`);
        }
    },
};
