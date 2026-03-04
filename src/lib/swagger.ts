
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
            info: {
                title: 'MockUrl API',
                description: 'MockUrl Backend API with Fastify and Zod',
                version: '1.0.0',
            },
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
        transform: jsonSchemaTransform, // Use Zod schema transformer
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
