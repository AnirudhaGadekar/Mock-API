
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

function getSwaggerServerUrl(): string {
    const endpointBase = process.env.BASE_ENDPOINT_URL?.trim();
    if (endpointBase) {
        try {
            return new URL(endpointBase).origin;
        } catch {
            // Fall through to other candidates if BASE_ENDPOINT_URL is malformed
        }
    }

    if (process.env.RENDER_EXTERNAL_URL) {
        return process.env.RENDER_EXTERNAL_URL;
    }

    return 'http://localhost:3000';
}

/**
 * Configure Swagger/OpenAPI documentation
 */
export async function registerSwagger(app: FastifyInstance) {
    const serverUrl = getSwaggerServerUrl();
    const isLocalServer = serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1');

    await app.register(swagger, {
        openapi: {
            openapi: '3.1.0',
            info: {
                title: 'MockUrl API',
                description: 'MockUrl Backend API with Fastify and Zod',
                version: '1.0.0',
                contact: {
                    name: 'MockUrl API Team',
                    url: 'https://mockurl.com',
                },
                license: {
                    name: 'MIT',
                },
            },
            jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
            servers: [
                {
                    url: serverUrl,
                    description: isLocalServer ? 'Local Development Server' : 'Deployed Server',
                },
            ],
            components: {
                securitySchemes: {
                    apiKeyAuth: {
                        type: 'apiKey',
                        name: 'x-api-key',
                        in: 'header',
                    },
                },
            },
            security: [{ apiKeyAuth: [] }],
        },
        // Some legacy routes still use plain JSON schema and can break strict zod-only transform.
        transform: (input) => {
            try {
                return jsonSchemaTransform(input as any);
            } catch {
                const routeSchema = (input as any)?.schema ?? {};
                return {
                    schema: routeSchema,
                    url: (input as any)?.url,
                };
            }
        },
    });

    await app.register(swaggerUi, {
        routePrefix: '/documentation',
        uiConfig: {
            docExpansion: 'list',
            deepLinking: false,
        },
        staticCSP: true,
        transformStaticCSP: (header: string) => header,
    });
}
