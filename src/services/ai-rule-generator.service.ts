import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../lib/logger.js';

interface RuleGenerationRequest {
    prompt: string;
    endpointId: string;
    context?: {
        existingRules?: Array<{ path: string; method: string }>;
        endpointName?: string;
    };
}

interface GeneratedRule {
    path: string;
    method: string;
    statusCode: number;
    responseTemplate: string;
    headers?: Record<string, string>;
    description: string;
    delay?: number;
}

export class AIRuleGeneratorService {
    private anthropic: Anthropic | undefined;
    private apiKey: string | undefined;

    constructor() {
        this.apiKey = process.env.ANTHROPIC_API_KEY;

        if (this.apiKey) {
            this.anthropic = new Anthropic({
                apiKey: this.apiKey,
            });
        } else {
            logger.warn('ANTHROPIC_API_KEY not found. AI features will not work or will be mocked.');
        }
    }

    async generateRule(request: RuleGenerationRequest): Promise<GeneratedRule> {
        if (!this.anthropic) {
            // Mock response for testing/development without API key
            logger.info('Generating mock AI response (no API key)');
            return {
                path: '/mock-generated-path',
                method: 'GET',
                statusCode: 200,
                responseTemplate: '{"message": "This is a mocked AI response because ANTHROPIC_API_KEY is missing."}',
                description: 'Mocked AI rule',
                delay: 0
            };
        }

        const systemPrompt = this.buildSystemPrompt();
        const userMessage = this.buildUserMessage(request);

        try {
            const message = await this.anthropic.messages.create({
                model: 'claude-3-sonnet-20240229', // Updated to a valid model name
                max_tokens: 2000,
                system: systemPrompt,
                messages: [
                    {
                        role: 'user',
                        content: userMessage,
                    },
                ],
            });

            // Extract JSON from response
            const responseText = message.content[0].type === 'text'
                ? message.content[0].text
                : '';

            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Failed to extract JSON from AI response');
            }

            const generatedRule: GeneratedRule = JSON.parse(jsonMatch[0]);

            // Validate the generated rule
            this.validateRule(generatedRule);

            return generatedRule;
        } catch (error: any) {
            logger.error('Failed to generate rule with AI', { error: error.message });
            throw error;
        }
    }

    async generateMultipleRules(
        prompt: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _endpointId: string
    ): Promise<GeneratedRule[]> {
        if (!this.anthropic) {
            return [{
                path: '/mock-list',
                method: 'GET',
                statusCode: 200,
                responseTemplate: '[]',
                description: 'Mocked list rule',
                delay: 0
            }];
        }

        const systemPrompt = this.buildSystemPrompt(true);

        try {
            const message = await this.anthropic.messages.create({
                model: 'claude-3-sonnet-20240229',
                max_tokens: 4000,
                system: systemPrompt,
                messages: [
                    {
                        role: 'user',
                        content: `Generate multiple mock rules for: ${prompt}`,
                    },
                ],
            });

            const responseText = message.content[0].type === 'text'
                ? message.content[0].text
                : '';

            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                throw new Error('Failed to extract JSON array from AI response');
            }

            const rules: GeneratedRule[] = JSON.parse(jsonMatch[0]);
            rules.forEach(rule => this.validateRule(rule));

            return rules;
        } catch (error: any) {
            logger.error('Failed to generate multiple rules with AI', { error: error.message });
            throw error;
        }
    }

    async refineRule(
        existingRule: GeneratedRule,
        refinementPrompt: string
    ): Promise<GeneratedRule> {
        if (!this.anthropic) {
            return {
                ...existingRule,
                description: existingRule.description + ' (Mock refined)'
            };
        }

        const systemPrompt = this.buildSystemPrompt();

        try {
            const message = await this.anthropic.messages.create({
                model: 'claude-3-sonnet-20240229',
                max_tokens: 2000,
                system: systemPrompt,
                messages: [
                    {
                        role: 'user',
                        content: `Current rule:\n${JSON.stringify(existingRule, null, 2)}\n\nRefinement: ${refinementPrompt}`,
                    },
                ],
            });

            const responseText = message.content[0].type === 'text'
                ? message.content[0].text
                : '';

            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Failed to extract JSON from AI response');
            }

            const refinedRule: GeneratedRule = JSON.parse(jsonMatch[0]);
            this.validateRule(refinedRule);

            return refinedRule;
        } catch (error: any) {
            logger.error('Failed to refine rule with AI', { error: error.message });
            throw error;
        }
    }

    private buildSystemPrompt(multiple: boolean = false): string {
        return `You are an API mocking expert. Generate realistic mock API rules from natural language descriptions.

${multiple ? 'Generate an array of rule objects.' : 'Generate a single rule object.'}

Output format (JSON only, no markdown):
${multiple ? '[' : ''}{
  "path": "/api/resource",
  "method": "GET",
  "statusCode": 200,
  "responseTemplate": "{{...}}",
  "headers": {"Content-Type": "application/json"},
  "description": "Brief description",
  "delay": 0
}${multiple ? ', ...]' : ''}

Template Syntax (Handlebars):
- {{faker.person.firstName}} - Random first name
- {{faker.person.lastName}} - Random last name
- {{faker.internet.email}} - Random email
- {{faker.internet.url}} - Random URL
- {{faker.phone.number}} - Random phone number
- {{faker.location.streetAddress}} - Street address
- {{faker.location.city}} - City name
- {{faker.location.country}} - Country name
- {{faker.location.zipCode}} - ZIP/postal code
- {{faker.company.name}} - Company name
- {{faker.commerce.productName}} - Product name
- {{faker.commerce.price}} - Price (e.g., "29.99")
- {{faker.commerce.department}} - Department
- {{faker.lorem.sentence}} - Lorem ipsum sentence
- {{faker.lorem.paragraph}} - Lorem ipsum paragraph
- {{faker.date.past}} - Past date
- {{faker.date.future}} - Future date
- {{faker.string.uuid}} - UUID
- {{faker.number.int}} - Random number
- {{faker.datatype.boolean}} - Random boolean
- {{#repeat count}}...{{/repeat}} - Repeat content

Rules:
1. Always use realistic, production-like data
2. Follow REST conventions (GET for retrieve, POST for create, etc.)
3. Use appropriate status codes (200, 201, 204, 400, 404, 500)
4. Include pagination for list endpoints
5. Generate 3-10 items for array responses
6. Use proper HTTP headers
7. Keep response structures clean and realistic
8. No explanatory text - JSON only`;
    }

    private buildUserMessage(request: RuleGenerationRequest): string {
        let message = `Generate a mock API rule for: ${request.prompt}`;

        if (request.context) {
            message += '\n\nContext:';

            if (request.context.endpointName) {
                message += `\nEndpoint name: ${request.context.endpointName}`;
            }

            if (request.context.existingRules?.length) {
                message += '\nExisting rules:';
                request.context.existingRules.forEach(rule => {
                    message += `\n- ${rule.method} ${rule.method}`;
                });
            }
        }

        return message;
    }

    private validateRule(rule: GeneratedRule): void {
        if (!rule.path || !rule.method || !rule.statusCode || !rule.responseTemplate) {
            throw new Error('Invalid rule: missing required fields');
        }

        if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(rule.method)) {
            throw new Error(`Invalid HTTP method: ${rule.method}`);
        }

        if (rule.statusCode < 100 || rule.statusCode >= 600) {
            throw new Error(`Invalid status code: ${rule.statusCode}`);
        }

        // Validate it's valid JSON template
        try {
            // Basic check - can be enhanced with actual Handlebars validation
            if (rule.responseTemplate.includes('{{') && !rule.responseTemplate.includes('}}')) {
                throw new Error('Malformed template syntax');
            }
        } catch (error) {
            throw new Error('Invalid response template');
        }
    }
}
