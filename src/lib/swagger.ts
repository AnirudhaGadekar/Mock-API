
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/**
 * Configure Swagger/OpenAPI documentation
 */
export async function registerSwagger(app: FastifyInstance) {
    await app.register(swagger, {
        openapi: {
            info: {
                title: 'MockUrl API',
                description: 'MockUrl Backend API with Fastify and Zod',
                version: '1.0.0',
            },
            servers: [
                {
                    url: 'http://localhost:3000',
                    description: 'Local Development Server',
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
