/**
 * oas-import.ts — OpenAPI 3.x spec → auto-generate mock endpoints + rules.
 *
 * Accepts OpenAPI JSON or YAML, parses it, and creates:
 *   - One endpoint per unique basePath/tag group
 *   - One mock rule per path+method combination
 *   - Response body from response examples or schema defaults
 *
 * Supports: OpenAPI 3.0 and 3.1
 */
import YAML from 'yaml';
import { logger } from '../lib/logger.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GeneratedRule {
    path: string;
    method: string;
    status: number;
    headers: Record<string, string>;
    body: string;
    description?: string;
}

export interface GeneratedEndpoint {
    name: string;
    rules: GeneratedRule[];
}

interface OASSchema {
    type?: string;
    properties?: Record<string, OASSchema>;
    items?: OASSchema;
    example?: unknown;
    default?: unknown;
    enum?: unknown[];
    format?: string;
    required?: string[];
    $ref?: string;
    allOf?: OASSchema[];
    oneOf?: OASSchema[];
    anyOf?: OASSchema[];
}

interface OASResponse {
    description?: string;
    content?: Record<string, { schema?: OASSchema; example?: unknown; examples?: Record<string, { value: unknown }> }>;
}

interface OASOperation {
    summary?: string;
    description?: string;
    operationId?: string;
    tags?: string[];
    responses?: Record<string, OASResponse>;
    parameters?: Array<{
        name: string;
        in: string;
        required?: boolean;
        schema?: OASSchema;
    }>;
}

interface OASPathItem {
    get?: OASOperation;
    post?: OASOperation;
    put?: OASOperation;
    patch?: OASOperation;
    delete?: OASOperation;
    head?: OASOperation;
    options?: OASOperation;
}

interface OpenAPISpec {
    openapi?: string;
    swagger?: string;
    info?: { title?: string; version?: string };
    servers?: Array<{ url: string }>;
    paths?: Record<string, OASPathItem>;
    components?: {
        schemas?: Record<string, OASSchema>;
    };
}

// ─── Schema → Example generator ────────────────────────────────────────────

function resolveRef(spec: OpenAPISpec, ref: string): OASSchema {
    // Handle $ref like "#/components/schemas/User"
    const parts = ref.replace('#/', '').split('/');
    let current: unknown = spec;
    for (const part of parts) {
        if (current == null || typeof current !== 'object') return {};
        current = (current as Record<string, unknown>)[part];
    }
    return (current as OASSchema) ?? {};
}

function generateFromSchema(schema: OASSchema, spec: OpenAPISpec, depth = 0): unknown {
    if (depth > 10) return null; // Prevent infinite recursion

    // Handle $ref
    if (schema.$ref) {
        return generateFromSchema(resolveRef(spec, schema.$ref), spec, depth + 1);
    }

    // Handle allOf/oneOf/anyOf — merge first schema
    if (schema.allOf?.length) {
        const merged: Record<string, unknown> = {};
        for (const sub of schema.allOf) {
            const resolved = generateFromSchema(sub, spec, depth + 1);
            if (typeof resolved === 'object' && resolved !== null) {
                Object.assign(merged, resolved);
            }
        }
        return merged;
    }
    if (schema.oneOf?.length) {
        return generateFromSchema(schema.oneOf[0], spec, depth + 1);
    }
    if (schema.anyOf?.length) {
        return generateFromSchema(schema.anyOf[0], spec, depth + 1);
    }

    // Use example/default/enum if available
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;
    if (schema.enum?.length) return schema.enum[0];

    // Generate by type
    switch (schema.type) {
        case 'string': {
            if (schema.format === 'date-time') return '{{now}}';
            if (schema.format === 'date') return '2026-01-15';
            if (schema.format === 'email') return '{{faker.internet.email}}';
            if (schema.format === 'uuid') return '{{uuid}}';
            if (schema.format === 'uri' || schema.format === 'url') return 'https://example.com';
            return 'string';
        }
        case 'integer':
        case 'number':
            return schema.format === 'float' || schema.format === 'double' ? 1.5 : 1;
        case 'boolean':
            return true;
        case 'array': {
            const item = schema.items ? generateFromSchema(schema.items, spec, depth + 1) : 'item';
            return [item];
        }
        case 'object': {
            const obj: Record<string, unknown> = {};
            if (schema.properties) {
                for (const [key, propSchema] of Object.entries(schema.properties)) {
                    obj[key] = generateFromSchema(propSchema, spec, depth + 1);
                }
            }
            return obj;
        }
        default:
            return null;
    }
}

// ─── Main parser ────────────────────────────────────────────────────────────

/**
 * Parse an OpenAPI spec (JSON or YAML string) and generate mock endpoints + rules.
 */
export function parseOpenAPISpec(input: string): GeneratedEndpoint[] {
    let spec: OpenAPISpec;

    // Try JSON first, then YAML
    try {
        spec = JSON.parse(input);
    } catch {
        try {
            spec = YAML.parse(input);
        } catch (yamlErr) {
            throw new Error(`Invalid OpenAPI spec: not valid JSON or YAML. ${(yamlErr as Error).message}`);
        }
    }

    // Validate it's an OpenAPI spec
    if (!spec.openapi && !spec.swagger) {
        throw new Error('Invalid OpenAPI spec: missing "openapi" or "swagger" field');
    }
    if (!spec.paths || Object.keys(spec.paths).length === 0) {
        throw new Error('OpenAPI spec has no paths defined');
    }

    const apiTitle = spec.info?.title ?? 'imported-api';
    const safeName = apiTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);

    // Group paths by tag → one endpoint per tag
    const tagGroups = new Map<string, GeneratedRule[]>();
    const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

    for (const [pathStr, pathItem] of Object.entries(spec.paths)) {
        for (const method of HTTP_METHODS) {
            const operation = pathItem[method];
            if (!operation) continue;

            // Determine tag
            const tag = operation.tags?.[0] ?? 'default';

            // Convert OAS path params {id} to Express :id format
            const convertedPath = pathStr.replace(/\{([^}]+)\}/g, ':$1');

            // Find the best response (prefer 200, then 201, then first 2xx)
            const responses = operation.responses ?? {};
            const statusPriority = ['200', '201', '202', '204'];
            let bestStatus = '200';
            let bestResponse: OASResponse | undefined;

            for (const s of statusPriority) {
                if (responses[s]) {
                    bestStatus = s;
                    bestResponse = responses[s];
                    break;
                }
            }

            if (!bestResponse) {
                // Grab first available response
                const firstKey = Object.keys(responses)[0];
                if (firstKey) {
                    bestStatus = firstKey;
                    bestResponse = responses[firstKey];
                }
            }

            // Generate response body
            let responseBody: unknown = { message: 'OK' };
            if (bestResponse?.content) {
                const jsonContent = bestResponse.content['application/json'];
                if (jsonContent) {
                    if (jsonContent.example) {
                        responseBody = jsonContent.example;
                    } else if (jsonContent.examples) {
                        const firstExample = Object.values(jsonContent.examples)[0];
                        if (firstExample?.value) responseBody = firstExample.value;
                    } else if (jsonContent.schema) {
                        responseBody = generateFromSchema(jsonContent.schema, spec);
                    }
                }
            }

            const rule: GeneratedRule = {
                path: convertedPath,
                method: method.toUpperCase(),
                status: parseInt(bestStatus) || 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(responseBody, null, 2),
                description: operation.summary ?? operation.description ?? `${method.toUpperCase()} ${pathStr}`,
            };

            if (!tagGroups.has(tag)) tagGroups.set(tag, []);
            tagGroups.get(tag)!.push(rule);
        }
    }

    // Convert to endpoints
    const endpoints: GeneratedEndpoint[] = [];

    if (tagGroups.size === 1) {
        // Single group → one endpoint with the API name
        const rules = tagGroups.values().next().value!;
        endpoints.push({ name: safeName, rules });
    } else {
        // Multiple groups → one endpoint per tag
        for (const [tag, rules] of tagGroups) {
            const tagName = `${safeName}-${tag.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
            endpoints.push({ name: tagName, rules });
        }
    }

    logger.info(`OAS import: parsed ${spec.paths ? Object.keys(spec.paths).length : 0} paths → ${endpoints.length} endpoint(s)`);

    return endpoints;
}
