import { FastifyInstance } from 'fastify';
import { logger } from '../lib/logger.js';
import { authenticateApiKey } from '../middleware/auth.middleware.js';
import { AIRuleGeneratorService } from '../services/ai-rule-generator.service.js';

const aiService = new AIRuleGeneratorService();

export async function aiRulesRoutes(fastify: FastifyInstance) {
    fastify.post('/generate-rule', { preHandler: authenticateApiKey }, async (request, reply) => {
        try {
            const { prompt, endpointId, context } = request.body as any;

            if (!prompt || !endpointId) {
                return reply.status(400).send({ error: 'Missing required fields' });
            }

            const rule = await aiService.generateRule({
                prompt,
                endpointId,
                context,
            });

            return reply.send({ rule });
        } catch (error: any) {
            logger.error('AI rule generation error', { error: error.message });
            return reply.status(500).send({
                error: 'Failed to generate rule',
                message: error.message
            });
        }
    });

    fastify.post('/generate-rules', { preHandler: authenticateApiKey }, async (request, reply) => {
        try {
            const { prompt, endpointId } = request.body as any;

            if (!prompt || !endpointId) {
                return reply.status(400).send({ error: 'Missing required fields' });
            }

            const rules = await aiService.generateMultipleRules(prompt, endpointId);

            return reply.send({ rules });
        } catch (error: any) {
            logger.error('AI rules generation error', { error: error.message });
            return reply.status(500).send({
                error: 'Failed to generate rules',
                message: error.message
            });
        }
    });

    fastify.post('/refine-rule', { preHandler: authenticateApiKey }, async (request, reply) => {
        try {
            const { existingRule, refinementPrompt } = request.body as any;

            if (!existingRule || !refinementPrompt) {
                return reply.status(400).send({ error: 'Missing required fields' });
            }

            const refinedRule = await aiService.refineRule(existingRule, refinementPrompt);

            return reply.send({ rule: refinedRule });
        } catch (error: any) {
            logger.error('AI rule refinement error', { error: error.message });
            return reply.status(500).send({
                error: 'Failed to refine rule',
                message: error.message
            });
        }
    });
}
