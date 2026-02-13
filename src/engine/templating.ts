/**
 * templating.ts — Dynamic response templating with Handlebars + Faker.
 *
 * Supports:
 *   {{req.body.name}}          — Request body interpolation
 *   {{req.headers.host}}       — Request header access
 *   {{req.query.page}}         — Query parameter access
 *   {{req.params.id}}          — URL path parameter access
 *   {{req.method}}             — HTTP method
 *   {{req.path}}               — Request path
 *   {{state.users.0.name}}     — Stateful store access
 *   {{faker.person.firstName}} — Faker.js random data
 *   {{faker.number.int(100)}}  — Faker with args
 *   {{now}}                    — Current ISO timestamp
 *   {{timestamp}}              — Unix timestamp
 *   {{uuid}}                   — Random UUID
 *   {{randomInt min max}}      — Random integer in range
 *   {{#repeat 5}}...{{/repeat}} — Repeat block N times
 *   {{math a "+" b}}           — Basic math ops
 */
import { faker } from '@faker-js/faker';
import crypto from 'crypto';
import Handlebars from 'handlebars';
import { statefulStore } from './stateful-store.js';

type CompiledTemplate = Handlebars.TemplateDelegate;

const TEMPLATE_CACHE_MAX = Number(process.env.TEMPLATE_CACHE_MAX ?? 2000);
const templateCache = new Map<string, CompiledTemplate>();

function cacheGet(key: string): CompiledTemplate | undefined {
    const hit = templateCache.get(key);
    if (!hit) return undefined;
    // bump recency
    templateCache.delete(key);
    templateCache.set(key, hit);
    return hit;
}

function cacheSet(key: string, compiled: CompiledTemplate) {
    if (TEMPLATE_CACHE_MAX <= 0) return;
    if (templateCache.has(key)) templateCache.delete(key);
    templateCache.set(key, compiled);
    if (templateCache.size > TEMPLATE_CACHE_MAX) {
        const oldestKey = templateCache.keys().next().value as string | undefined;
        if (oldestKey) templateCache.delete(oldestKey);
    }
}

function templateCacheKey(preprocessed: string): string {
    return crypto.createHash('sha256').update(preprocessed).digest('hex');
}

// ─── Request context type ───────────────────────────────────────────────────

export interface TemplateContext {
    req: {
        method: string;
        path: string;
        body?: unknown;
        headers?: Record<string, string>;
        query?: Record<string, string>;
        params?: Record<string, string>;
        ip?: string;
    };
    state?: Record<string, unknown>;
    endpointId?: string;
}

// ─── Register Handlebars helpers ────────────────────────────────────────────

// {{now}} → ISO timestamp
Handlebars.registerHelper('now', () => new Date().toISOString());

// {{timestamp}} → Unix timestamp
Handlebars.registerHelper('timestamp', () => Math.floor(Date.now() / 1000));

// {{uuid}} → Random UUID
Handlebars.registerHelper('uuid', () => crypto.randomUUID());

// {{randomInt min max}} → Random integer in range
Handlebars.registerHelper('randomInt', (min: unknown, max: unknown) => {
    const lo = typeof min === 'number' ? min : 0;
    const hi = typeof max === 'number' ? max : 100;
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
});

// {{randomFloat min max decimals}} → Random float
Handlebars.registerHelper('randomFloat', (min: unknown, max: unknown, decimals: unknown) => {
    const lo = typeof min === 'number' ? min : 0;
    const hi = typeof max === 'number' ? max : 1;
    const dec = typeof decimals === 'number' ? decimals : 2;
    return parseFloat((Math.random() * (hi - lo) + lo).toFixed(dec));
});

// {{math a "+" b}} → Basic math
Handlebars.registerHelper('math', (a: unknown, op: unknown, b: unknown) => {
    const na = Number(a);
    const nb = Number(b);
    switch (op) {
        case '+': return na + nb;
        case '-': return na - nb;
        case '*': return na * nb;
        case '/': return nb !== 0 ? na / nb : 0;
        case '%': return nb !== 0 ? na % nb : 0;
        default: return na;
    }
});

// {{#repeat n}}...{{/repeat}} → Repeat block N times
Handlebars.registerHelper('repeat', function (this: unknown, count: unknown, options: Handlebars.HelperOptions) {
    const n = typeof count === 'number' ? count : parseInt(String(count)) || 0;
    let result = '';
    for (let i = 0; i < n; i++) {
        result += options.fn({ ...this as object, '@index': i, '@first': i === 0, '@last': i === n - 1 });
        if (i < n - 1) result += ',';
    }
    return result;
});

// {{#if_eq a b}}...{{/if_eq}} → Conditional equality
Handlebars.registerHelper('if_eq', function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
    // eslint-disable-next-line eqeqeq
    return a == b ? options.fn(this) : options.inverse(this);
});

// {{json value}} → JSON.stringify
Handlebars.registerHelper('json', (value: unknown) => {
    return new Handlebars.SafeString(JSON.stringify(value, null, 2));
});

// {{lookup obj "key"}} — already built into Handlebars, but let's make sure nested paths work
Handlebars.registerHelper('deepGet', (obj: unknown, path: unknown) => {
    if (typeof path !== 'string' || obj == null) return '';
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
        if (current == null || typeof current !== 'object') return '';
        current = (current as Record<string, unknown>)[part];
    }
    return current ?? '';
});

// ─── Faker resolution ───────────────────────────────────────────────────────

/**
 * Resolve a faker path like "person.firstName" or "number.int(100)"
 */
function resolveFaker(fakerPath: string): unknown {
    // Parse args: "number.int(100)" → path="number.int", args=[100]
    let path = fakerPath;
    let args: unknown[] = [];

    const argsMatch = fakerPath.match(/^(.+?)\((.+)\)$/);
    if (argsMatch) {
        path = argsMatch[1];
        try {
            // Try parsing as JSON array
            args = JSON.parse(`[${argsMatch[2]}]`);
        } catch {
            args = [argsMatch[2]];
        }
    }

    // Navigate faker object
    const parts = path.split('.');
    let current: unknown = faker;

    for (const part of parts) {
        if (current == null || typeof current !== 'object') return `{{faker.${fakerPath}}}`;
        current = (current as Record<string, unknown>)[part];
    }

    if (typeof current === 'function') {
        try {
            return (current as (...a: unknown[]) => unknown)(...args);
        } catch {
            return `{{faker.${fakerPath}}}`;
        }
    }

    return current ?? `{{faker.${fakerPath}}}`;
}

// ─── Main template render ───────────────────────────────────────────────────

/**
 * Pre-process template to resolve {{faker.*}} and {{state.*}} before Handlebars.
 * This is needed because Handlebars doesn't natively handle dynamic dot-path resolution.
 */
async function preProcess(template: string, ctx: TemplateContext): Promise<string> {
    let result = template;

    // Resolve {{faker.xxx}} patterns
    const fakerRegex = /\{\{faker\.([^}]+)\}\}/g;
    result = result.replace(fakerRegex, (_match, path: string) => {
        const val = resolveFaker(path);
        return typeof val === 'object' ? JSON.stringify(val) : String(val);
    });

    // Resolve {{state.xxx}} patterns — requires async store access
    const stateRegex = /\{\{state\.([^}]+)\}\}/g;
    const stateMatches = [...result.matchAll(stateRegex)];
    for (const match of stateMatches) {
        const path = match[1];
        if (ctx.endpointId) {
            const val = await statefulStore.get(ctx.endpointId, path);
            const strVal = val == null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
            result = result.replace(match[0], strVal);
        }
    }

    return result;
}

/**
 * Render a template string with full context support.
 *
 * @param template - Handlebars template string
 * @param ctx      - Request context (req, state, endpointId)
 * @returns Rendered string
 */
export async function renderTemplate(template: string, ctx: TemplateContext): Promise<string> {
    try {
        // Pre-process faker and state references
        const preprocessed = await preProcess(template, ctx);

        // Compile and render with Handlebars (cached)
        const key = templateCacheKey(preprocessed);
        const cached = cacheGet(key);
        const compiled = cached ?? Handlebars.compile(preprocessed, { noEscape: true });
        if (!cached) cacheSet(key, compiled);
        return compiled(ctx);
    } catch (err) {
        // On any template error, return the original string with basic substitution
        return template;
    }
}

/**
 * Render a JSON body template. Handles both string templates and object templates.
 */
export async function renderBody(body: unknown, ctx: TemplateContext): Promise<unknown> {
    if (typeof body === 'string') {
        const rendered = await renderTemplate(body, ctx);
        // Try to parse as JSON
        try {
            return JSON.parse(rendered);
        } catch {
            return rendered;
        }
    }

    if (typeof body === 'object' && body !== null) {
        // Deep-render all string values in the object
        return deepRenderObject(body, ctx);
    }

    return body;
}

async function deepRenderObject(obj: unknown, ctx: TemplateContext): Promise<unknown> {
    if (typeof obj === 'string') {
        return renderTemplate(obj, ctx);
    }
    if (Array.isArray(obj)) {
        return Promise.all(obj.map((item) => deepRenderObject(item, ctx)));
    }
    if (typeof obj === 'object' && obj !== null) {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = await deepRenderObject(value, ctx);
        }
        return result;
    }
    return obj;
}
