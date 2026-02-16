import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIRuleGeneratorService } from '../src/services/ai-rule-generator.service.js';

// Mock logger
vi.mock('../src/lib/logger.js', () => ({
    logger: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    },
}));

describe('AIRuleGeneratorService', () => {
    let service: AIRuleGeneratorService;

    beforeEach(() => {
        // Clear env before each test
        delete process.env.ANTHROPIC_API_KEY;
        service = new AIRuleGeneratorService();
    });

    it('should return mock response when API key is missing', async () => {
        const rule = await service.generateRule({
            prompt: 'Create a user endpoint',
            endpointId: 'test-id',
        });

        expect(rule).toBeDefined();
        expect(rule.path).toBe('/mock-generated-path');
        expect(rule.method).toBe('GET');
    });

    it('should return mock list when API key is missing for multiple rules', async () => {
        const rules = await service.generateMultipleRules('Create user endpoints', 'test-id');

        expect(rules).toBeDefined();
        expect(Array.isArray(rules)).toBe(true);
        expect(rules[0].path).toBe('/mock-list');
    });
});
