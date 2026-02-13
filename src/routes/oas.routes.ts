/**
 * oas.routes.ts — OpenAPI spec import endpoint.
 *
 * POST /api/v1/oas-import  — Import an OpenAPI JSON/YAML spec.
 *   Body: { spec: "<openapi json or yaml string>" }
 *   OR raw body with Content-Type: application/json or application/x-yaml
 *
 * Parses the spec, creates endpoints + mock rules in the database.
 */
import { FastifyPluginAsync } from 'fastify';
import { parseOpenAPISpec } from '../engine/oas-import.js';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { authenticateApiKey, getAuthenticatedUser } from '../middleware/auth.middleware.js';

export const oasRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', authenticateApiKey);

    fastify.post<{
        Body: { spec: string } | string;
    }>('/oas-import', async (request, reply) => {
        const user = getAuthenticatedUser(request);

        // Extract spec string from body
        let specString: string;

        if (typeof request.body === 'string') {
            specString = request.body;
        } else if (typeof request.body === 'object' && request.body !== null) {
            const body = request.body as Record<string, unknown>;
            if (typeof body.spec === 'string') {
                specString = body.spec;
            } else {
                // Maybe the whole body IS the OpenAPI spec
                specString = JSON.stringify(request.body);
            }
        } else {
            return reply.status(400).send({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Body must contain an OpenAPI spec (JSON or YAML string)' },
            });
        }

        try {
            // Parse the OpenAPI spec
            const generatedEndpoints = parseOpenAPISpec(specString);

            if (generatedEndpoints.length === 0) {
                return reply.status(400).send({
                    success: false,
                    error: { code: 'EMPTY_SPEC', message: 'No paths found in OpenAPI spec' },
                });
            }

            // Create endpoints + rules in the database
            const created = [];

            for (const gen of generatedEndpoints) {
                // Convert generated rules to the JSON format used by endpoint.rules
                const rulesJson = gen.rules.map((rule, i) => ({
                    priority: i,
                    conditions: {
                        method: rule.method,
                        path: rule.path,
                    },
                    response: {
                        status: rule.status,
                        headers: rule.headers,
                        body: rule.body,
                    },
                    description: rule.description ?? `${rule.method} ${rule.path}`,
                }));

                // Create the endpoint with embedded rules
                const endpoint = await prisma.endpoint.create({
                    data: {
                        name: gen.name,
                        userId: user.id,
                        rules: rulesJson,
                    },
                });

                created.push({
                    id: endpoint.id,
                    name: endpoint.name,
                    rulesCreated: gen.rules.length,
                    paths: gen.rules.map((r) => `${r.method} ${r.path}`),
                });
            }

            logger.info(`OAS import: created ${created.length} endpoint(s) for user ${user.id}`);

            return reply.status(201).send({
                success: true,
                message: `Imported ${created.length} endpoint(s) from OpenAPI spec`,
                endpoints: created,
                timestamp: new Date().toISOString(),
            });
        } catch (err) {
            const message = (err as Error).message;
            logger.error(`OAS import failed: ${message}`);

            return reply.status(400).send({
                success: false,
                error: {
                    code: 'IMPORT_FAILED',
                    message,
                },
            });
        }
    });
};
