import crypto from 'crypto';
import { faker } from '@faker-js/faker';
import Handlebars from 'handlebars';

type TemplateContext = {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  query: Record<string, string>;
  params: Record<string, string>;
};

type RuntimeTemplateContext = TemplateContext & {
  request?: {
    body: Record<string, unknown>;
    headers: Record<string, string>;
    queryParams: Record<string, string>;
    params: Record<string, string>;
    method?: string;
    path?: string;
  };
  state?: Record<string, unknown>;
  __statusCode?: number;
};

const TEMPLATE_ERROR_CODE = 561;
const TEMPLATE_ERROR_BODY = JSON.stringify({
  error: 'Template render failed',
  code: TEMPLATE_ERROR_CODE,
});

const engine = Handlebars.create();
const templateCache = new Map<string, Handlebars.TemplateDelegate<RuntimeTemplateContext>>();
const TEMPLATE_CACHE_MAX = Number(process.env.TEMPLATE_CACHE_MAX ?? 1000);

function isHelperOptions(value: unknown): value is Handlebars.HelperOptions {
  return Boolean(value && typeof value === 'object' && 'hash' in (value as Record<string, unknown>));
}

function createSafeString(value: unknown): Handlebars.SafeString {
  if (value == null) return new Handlebars.SafeString('');
  if (typeof value === 'string') return new Handlebars.SafeString(value);
  if (typeof value === 'object') return new Handlebars.SafeString(JSON.stringify(value));
  return new Handlebars.SafeString(String(value));
}

function getPathValue(source: unknown, path: string): unknown {
  if (!path) return source;

  const segments = path
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);

  let current = source;
  for (const segment of segments) {
    if (current == null) return undefined;

    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
      continue;
    }

    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function normalizeHash(hash: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(hash)) {
    if (key === 'loc') continue;
    cleaned[key] = value;
  }
  return cleaned;
}

function resolveFakerValue(path: string, hash: Record<string, unknown>): unknown {
  const segments = path.split('.').filter(Boolean);
  let current: unknown = faker;

  for (const segment of segments) {
    if (current == null || (typeof current !== 'object' && typeof current !== 'function')) {
      throw new Error(`Unknown faker path: ${path}`);
    }
    current = (current as Record<string, unknown>)[segment];
  }

  if (typeof current === 'function') {
    const options = normalizeHash(hash);
    if (Object.keys(options).length === 0) {
      return (current as () => unknown)();
    }
    return (current as (options: Record<string, unknown>) => unknown)(options);
  }

  return current;
}

function normalizeTemplateSource(template: string): string {
  if (template.includes('{{{') || template.includes('{{{{')) {
    return template;
  }

  // Handlebars tokenizes `}}}` as a triple-stash close, which breaks inline JSON
  // snippets like `{"index":{{@index}}}`. Insert a separator so the trailing
  // object brace remains literal JSON instead of part of the Handlebars token.
  return template.split('}}}').join('}} }');
}

function compileTemplate(template: string): Handlebars.TemplateDelegate<RuntimeTemplateContext> {
  const cached = templateCache.get(template);
  if (cached) {
    templateCache.delete(template);
    templateCache.set(template, cached);
    return cached;
  }

  const compiled = engine.compile<RuntimeTemplateContext>(normalizeTemplateSource(template), { noEscape: true });
  templateCache.set(template, compiled);

  if (templateCache.size > TEMPLATE_CACHE_MAX) {
    const oldestKey = templateCache.keys().next().value;
    if (oldestKey) templateCache.delete(oldestKey);
  }

  return compiled;
}

engine.registerHelper('body', function bodyHelper(pathOrOptions?: unknown, maybeOptions?: Handlebars.HelperOptions) {
  const options = isHelperOptions(pathOrOptions) ? pathOrOptions : maybeOptions;
  const ctx = (options?.data.root ?? {}) as RuntimeTemplateContext;

  if (isHelperOptions(pathOrOptions) || pathOrOptions == null) {
    return createSafeString(ctx.body ?? {});
  }

  return createSafeString(getPathValue(ctx.body ?? {}, String(pathOrOptions)));
});

engine.registerHelper('header', function headerHelper(name: unknown, maybeDefaultOrOptions?: unknown, maybeOptions?: Handlebars.HelperOptions) {
  const options = isHelperOptions(maybeDefaultOrOptions) ? maybeDefaultOrOptions : maybeOptions;
  const fallback = isHelperOptions(maybeDefaultOrOptions) ? '' : maybeDefaultOrOptions;
  const ctx = (options?.data.root ?? {}) as RuntimeTemplateContext;
  const key = String(name ?? '').toLowerCase();
  const value = ctx.headers?.[key];
  return createSafeString(value ?? fallback ?? '');
});

engine.registerHelper('queryParam', function queryParamHelper(name: unknown, maybeDefaultOrOptions?: unknown, maybeOptions?: Handlebars.HelperOptions) {
  const options = isHelperOptions(maybeDefaultOrOptions) ? maybeDefaultOrOptions : maybeOptions;
  const fallback = isHelperOptions(maybeDefaultOrOptions) ? '' : maybeDefaultOrOptions;
  const ctx = (options?.data.root ?? {}) as RuntimeTemplateContext;
  const key = String(name ?? '');
  const value = ctx.query?.[key];
  return createSafeString(value ?? fallback ?? '');
});

engine.registerHelper('param', function paramHelper(name: unknown, maybeDefaultOrOptions?: unknown, maybeOptions?: Handlebars.HelperOptions) {
  const options = isHelperOptions(maybeDefaultOrOptions) ? maybeDefaultOrOptions : maybeOptions;
  const fallback = isHelperOptions(maybeDefaultOrOptions) ? '' : maybeDefaultOrOptions;
  const ctx = (options?.data.root ?? {}) as RuntimeTemplateContext;
  const key = String(name ?? '');
  const value = ctx.params?.[key];
  return createSafeString(value ?? fallback ?? '');
});

engine.registerHelper('state', function stateHelper(pathOrOptions?: unknown, maybeOptions?: Handlebars.HelperOptions) {
  const options = isHelperOptions(pathOrOptions) ? pathOrOptions : maybeOptions;
  const ctx = (options?.data.root ?? {}) as RuntimeTemplateContext;

  if (isHelperOptions(pathOrOptions) || pathOrOptions == null) {
    return createSafeString(ctx.state ?? {});
  }

  return createSafeString(getPathValue(ctx.state ?? {}, String(pathOrOptions)));
});

engine.registerHelper('uuid', () => crypto.randomUUID());
engine.registerHelper('timestamp', () => new Date().toISOString());
engine.registerHelper('unixTimestamp', () => Date.now());

engine.registerHelper('faker', function fakerHelper(path: unknown, options: Handlebars.HelperOptions) {
  return createSafeString(resolveFakerValue(String(path ?? ''), options.hash));
});

engine.registerHelper('statusCode', function statusCodeHelper(code: unknown, options: Handlebars.HelperOptions) {
  const ctx = (options.data.root ?? {}) as RuntimeTemplateContext;
  const nextCode = Number(code);
  if (Number.isInteger(nextCode) && nextCode >= 100 && nextCode <= 599) {
    ctx.__statusCode = nextCode;
  }
  return '';
});

engine.registerHelper('repeat', function repeatHelper(this: unknown, count: unknown, options: Handlebars.HelperOptions) {
  const total = Math.max(0, Number.parseInt(String(count ?? 0), 10) || 0);
  const items: string[] = [];
  const scope = (typeof this === 'object' && this !== null) ? this : {};

  for (let index = 0; index < total; index++) {
    const data = options.data ? Handlebars.createFrame(options.data) : {};
    data.index = index;
    data.first = index === 0;
    data.last = index === total - 1;
    items.push(options.fn(scope, { data }));
  }

  return new Handlebars.SafeString(`[${items.join(',')}]`);
});

export function renderTemplate(template: string, context: TemplateContext): { rendered: string; error: boolean } {
  try {
    const runtimeContext = context as RuntimeTemplateContext;
    runtimeContext.body = runtimeContext.body ?? {};
    runtimeContext.headers = runtimeContext.headers ?? {};
    runtimeContext.query = runtimeContext.query ?? {};
    runtimeContext.params = runtimeContext.params ?? {};

    if (!runtimeContext.request) {
      runtimeContext.request = {
        body: runtimeContext.body,
        headers: runtimeContext.headers,
        queryParams: runtimeContext.query,
        params: runtimeContext.params,
      };
    }

    const compiled = compileTemplate(template);
    return {
      rendered: compiled(runtimeContext),
      error: false,
    };
  } catch {
    return {
      rendered: TEMPLATE_ERROR_BODY,
      error: true,
    };
  }
}
