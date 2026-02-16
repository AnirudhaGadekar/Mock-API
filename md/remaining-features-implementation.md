# Remaining Missing Features - Detailed Implementation Guide

This document contains detailed implementation prompts for the remaining missing features from the Beeceptor comparison.

---

## Table of Contents

1. [Feature #15: AI-Powered Rule Generation](#feature-15-ai-powered-rule-generation)
2. [Feature #17: WebSocket/SSE Mocking](#feature-17-websocketsse-mocking)
3. [Feature #18: GraphQL/gRPC Mocking](#feature-18-graphqlgrpc-mocking)
4. [Enhancement #5: Advanced Search & Filter for Request History](#enhancement-5-advanced-search--filter-for-request-history)
5. [Enhancement #9: AI Data Generation UI for OpenAPI](#enhancement-9-ai-data-generation-ui-for-openapi)
6. [Enhancement #16: Advanced Request Transformation](#enhancement-16-advanced-request-transformation)

---

## Feature #15: AI-Powered Rule Generation

### Overview
Add natural language → mock rule conversion using AI. Users describe what they want in plain English, and the system generates complete mock rules automatically.

### Architecture

```
User Input (Natural Language)
         ↓
  AI Rule Generator
         ↓
  Parse & Validate
         ↓
  Create Mock Rule
         ↓
  Show Preview → User Confirms → Save
```

### Backend Implementation

#### 1. AI Service Integration

```typescript
// src/services/ai-rule-generator.service.ts

import Anthropic from '@anthropic-ai/sdk';

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
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async generateRule(request: RuleGenerationRequest): Promise<GeneratedRule> {
    const systemPrompt = this.buildSystemPrompt();
    const userMessage = this.buildUserMessage(request);

    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
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
  }

  async generateMultipleRules(
    prompt: string,
    endpointId: string
  ): Promise<GeneratedRule[]> {
    const systemPrompt = this.buildSystemPrompt(true);
    
    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
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
  }

  async refineRule(
    existingRule: GeneratedRule,
    refinementPrompt: string
  ): Promise<GeneratedRule> {
    const systemPrompt = this.buildSystemPrompt();
    
    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
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
- {{faker.name.firstName}} - Random first name
- {{faker.name.lastName}} - Random last name
- {{faker.internet.email}} - Random email
- {{faker.internet.url}} - Random URL
- {{faker.phone.number}} - Random phone number
- {{faker.address.streetAddress}} - Street address
- {{faker.address.city}} - City name
- {{faker.address.country}} - Country name
- {{faker.address.zipCode}} - ZIP/postal code
- {{faker.company.name}} - Company name
- {{faker.commerce.productName}} - Product name
- {{faker.commerce.price}} - Price (e.g., "29.99")
- {{faker.commerce.department}} - Department
- {{faker.lorem.sentence}} - Lorem ipsum sentence
- {{faker.lorem.paragraph}} - Lorem ipsum paragraph
- {{faker.date.past}} - Past date
- {{faker.date.future}} - Future date
- {{faker.datatype.uuid}} - UUID
- {{faker.datatype.number}} - Random number
- {{faker.datatype.boolean}} - Random boolean
- {{random min max}} - Random number in range
- {{uuid}} - Generate UUID
- {{timestamp}} - Current timestamp
- {{now}} - Current ISO date string

For arrays, use:
{{#repeat count}}
  {
    "id": "{{uuid}}",
    "name": "{{faker.name.firstName}}"
  }{{#unless @last}},{{/unless}}
{{/repeat}}

For request data access:
- {{request.body.fieldName}} - Access request body field
- {{request.query.paramName}} - Access query parameter
- {{request.headers.headerName}} - Access header
- {{request.pathParams.id}} - Access path parameter

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
          message += `\n- ${rule.method} ${rule.path}`;
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
```

#### 2. API Routes

```typescript
// src/routes/ai-rules.routes.ts

import { Router } from 'express';
import { AIRuleGeneratorService } from '../services/ai-rule-generator.service';
import { authenticate } from '../middleware/auth';

const router = Router();
const aiService = new AIRuleGeneratorService();

router.post('/api/ai/generate-rule', authenticate, async (req, res) => {
  try {
    const { prompt, endpointId, context } = req.body;

    if (!prompt || !endpointId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const rule = await aiService.generateRule({
      prompt,
      endpointId,
      context,
    });

    res.json({ rule });
  } catch (error) {
    console.error('AI rule generation error:', error);
    res.status(500).json({ 
      error: 'Failed to generate rule',
      message: error.message 
    });
  }
});

router.post('/api/ai/generate-rules', authenticate, async (req, res) => {
  try {
    const { prompt, endpointId } = req.body;

    if (!prompt || !endpointId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const rules = await aiService.generateMultipleRules(prompt, endpointId);

    res.json({ rules });
  } catch (error) {
    console.error('AI rules generation error:', error);
    res.status(500).json({ 
      error: 'Failed to generate rules',
      message: error.message 
    });
  }
});

router.post('/api/ai/refine-rule', authenticate, async (req, res) => {
  try {
    const { existingRule, refinementPrompt } = req.body;

    if (!existingRule || !refinementPrompt) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const refinedRule = await aiService.refineRule(existingRule, refinementPrompt);

    res.json({ rule: refinedRule });
  } catch (error) {
    console.error('AI rule refinement error:', error);
    res.status(500).json({ 
      error: 'Failed to refine rule',
      message: error.message 
    });
  }
});

export default router;
```

### Frontend Implementation

#### 1. AI Rule Generator Component

```typescript
// src/components/AIRuleGenerator.tsx

import React, { useState } from 'react';
import { Sparkles, Wand2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

interface AIRuleGeneratorProps {
  endpointId: string;
  onRuleGenerated: (rule: any) => void;
}

const EXAMPLE_PROMPTS = [
  'Create a user login endpoint that returns a JWT token',
  'Generate a paginated list of products with images and prices',
  'Mock a weather API that returns temperature for a city',
  'Create a CRUD API for managing blog posts',
  'Generate an error response for unauthorized access',
  'Mock a webhook that receives payment notifications',
];

export function AIRuleGenerator({ endpointId, onRuleGenerated }: AIRuleGeneratorProps) {
  const [prompt, setPrompt] = useState('');
  const [generatedRule, setGeneratedRule] = useState<any>(null);
  const [showExamples, setShowExamples] = useState(true);

  const generateMutation = useMutation({
    mutationFn: async (promptText: string) => {
      const response = await fetch('/api/ai/generate-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: promptText, 
          endpointId 
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to generate rule');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setGeneratedRule(data.rule);
      setShowExamples(false);
      toast.success('Rule generated successfully!');
    },
    onError: () => {
      toast.error('Failed to generate rule. Please try again.');
    },
  });

  const refineMutation = useMutation({
    mutationFn: async (refinementPrompt: string) => {
      const response = await fetch('/api/ai/refine-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          existingRule: generatedRule, 
          refinementPrompt 
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to refine rule');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setGeneratedRule(data.rule);
      toast.success('Rule refined successfully!');
    },
  });

  const handleGenerate = () => {
    if (!prompt.trim()) {
      toast.error('Please enter a description');
      return;
    }
    generateMutation.mutate(prompt);
  };

  const handleRegenerate = () => {
    generateMutation.mutate(prompt);
  };

  const handleRefine = (refinement: string) => {
    refineMutation.mutate(refinement);
  };

  const handleAccept = () => {
    onRuleGenerated(generatedRule);
    setGeneratedRule(null);
    setPrompt('');
    setShowExamples(true);
  };

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-5 w-5 text-purple-600" />
          <h3 className="text-lg font-semibold">AI Rule Generator</h3>
          <Badge variant="secondary" className="ml-2">Beta</Badge>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Describe the API endpoint you want to mock
            </label>
            <Textarea
              placeholder="e.g., Create a user registration endpoint that accepts email and password, returns user object with ID and token"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full"
            />
          </div>

          {showExamples && (
            <div>
              <p className="text-sm text-gray-600 mb-2">Try these examples:</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((example, idx) => (
                  <Button
                    key={idx}
                    variant="outline"
                    size="sm"
                    onClick={() => setPrompt(example)}
                  >
                    {example}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <Button
            onClick={handleGenerate}
            disabled={generateMutation.isPending || !prompt.trim()}
            className="w-full"
          >
            {generateMutation.isPending ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" />
                Generate Rule
              </>
            )}
          </Button>
        </div>
      </Card>

      {generatedRule && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold">Generated Rule</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRegenerate}
              disabled={generateMutation.isPending}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Regenerate
            </Button>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{generatedRule.method}</Badge>
              <code className="text-sm font-mono">{generatedRule.path}</code>
              <Badge>{generatedRule.statusCode}</Badge>
            </div>

            {generatedRule.description && (
              <p className="text-sm text-gray-600">{generatedRule.description}</p>
            )}

            <div>
              <label className="block text-sm font-medium mb-2">Response Template</label>
              <pre className="bg-gray-50 p-4 rounded border text-xs overflow-x-auto">
                {JSON.stringify(JSON.parse(generatedRule.responseTemplate), null, 2)}
              </pre>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleAccept} className="flex-1">
                Accept & Create Rule
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const refinement = prompt('How would you like to refine this rule?');
                  if (refinement) handleRefine(refinement);
                }}
              >
                Refine...
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
```

#### 2. Integration into Mock Rules Panel

```typescript
// src/components/MockRulesPanel.tsx

import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AIRuleGenerator } from './AIRuleGenerator';

export function MockRulesPanel({ endpointId }: { endpointId: string }) {
  const [showAI, setShowAI] = useState(false);

  const handleRuleGenerated = (rule: any) => {
    // Create the mock rule from AI-generated data
    createMockRule.mutate(rule);
    setShowAI(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button onClick={() => setShowManualCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Rule Manually
        </Button>
        <Button variant="outline" onClick={() => setShowAI(!showAI)}>
          <Sparkles className="mr-2 h-4 w-4" />
          Generate with AI
        </Button>
      </div>

      {showAI && (
        <AIRuleGenerator
          endpointId={endpointId}
          onRuleGenerated={handleRuleGenerated}
        />
      )}

      {/* Existing rules list */}
    </div>
  );
}
```

### Testing Checklist

- [ ] AI generates syntactically valid Handlebars templates
- [ ] Generated data uses appropriate Faker methods
- [ ] HTTP methods match REST conventions
- [ ] Status codes are appropriate
- [ ] Path patterns follow REST standards
- [ ] Response structures are realistic
- [ ] Can generate multiple related rules (CRUD)
- [ ] Refinement preserves context
- [ ] Error handling provides helpful messages
- [ ] Example prompts work correctly
- [ ] Preview shows formatted JSON
- [ ] Accept button creates rule successfully

---

## Feature #17: WebSocket/SSE Mocking

### Overview
Enable mocking of WebSocket and Server-Sent Events (SSE) endpoints, allowing users to simulate real-time communication patterns.

### Architecture

```
Client WebSocket Connection
         ↓
  Mock WebSocket Server
         ↓
  Message Rules Engine
         ↓
  Response Generator
         ↓
  Send to Client
```

### Backend Implementation

#### 1. WebSocket Handler

```typescript
// src/services/websocket-mock.service.ts

import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import Handlebars from 'handlebars';

interface WebSocketRule {
  id: string;
  endpointId: string;
  eventName: string;
  messagePattern?: string; // JSON path pattern to match
  responseTemplate: string;
  responseDelay?: number;
  autoRespond: boolean;
}

interface SSERule {
  id: string;
  endpointId: string;
  eventName: string;
  dataTemplate: string;
  interval: number; // milliseconds
  maxEvents?: number;
}

export class WebSocketMockService {
  private io: SocketIOServer;
  private wsRules: Map<string, WebSocketRule[]> = new Map();
  private sseConnections: Map<string, Map<string, NodeJS.Timeout>> = new Map();

  constructor(httpServer: HttpServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
      path: '/ws-mock',
    });

    this.setupSocketHandlers();
  }

  private setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('WebSocket client connected:', socket.id);

      // Extract endpoint ID from connection
      const endpointId = socket.handshake.query.endpointId as string;
      
      if (!endpointId) {
        socket.disconnect();
        return;
      }

      // Join room for this endpoint
      socket.join(endpointId);

      // Load rules for this endpoint
      const rules = this.wsRules.get(endpointId) || [];

      // Handle incoming messages
      socket.onAny((eventName, data) => {
        console.log(`Received event "${eventName}" on endpoint ${endpointId}:`, data);
        
        // Log the message
        this.logWebSocketMessage(endpointId, socket.id, 'receive', eventName, data);

        // Find matching rules
        const matchingRules = rules.filter(rule => 
          rule.eventName === eventName || rule.eventName === '*'
        );

        // Process each matching rule
        matchingRules.forEach(rule => {
          if (rule.autoRespond) {
            this.processWebSocketRule(socket, rule, data);
          }
        });
      });

      // Send initial messages if configured
      rules
        .filter(rule => rule.eventName === 'connection')
        .forEach(rule => {
          this.processWebSocketRule(socket, rule, {});
        });

      socket.on('disconnect', () => {
        console.log('WebSocket client disconnected:', socket.id);
        this.logWebSocketMessage(endpointId, socket.id, 'disconnect', '', {});
      });
    });
  }

  private async processWebSocketRule(
    socket: any,
    rule: WebSocketRule,
    incomingData: any
  ) {
    try {
      // Apply delay if configured
      if (rule.responseDelay) {
        await new Promise(resolve => setTimeout(resolve, rule.responseDelay));
      }

      // Compile template
      const template = Handlebars.compile(rule.responseTemplate);
      
      // Build context
      const context = {
        request: {
          data: incomingData,
        },
        faker: this.getFakerHelpers(),
        uuid: () => crypto.randomUUID(),
        timestamp: () => Date.now(),
        now: () => new Date().toISOString(),
      };

      // Generate response
      const responseText = template(context);
      let responseData: any;

      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }

      // Send response
      const responseEvent = rule.eventName === '*' || rule.eventName === 'connection'
        ? 'message'
        : rule.eventName + '_response';

      socket.emit(responseEvent, responseData);

      // Log the response
      this.logWebSocketMessage(
        socket.handshake.query.endpointId as string,
        socket.id,
        'send',
        responseEvent,
        responseData
      );
    } catch (error) {
      console.error('Error processing WebSocket rule:', error);
      socket.emit('error', { message: 'Internal server error' });
    }
  }

  async broadcastToEndpoint(endpointId: string, eventName: string, data: any) {
    this.io.to(endpointId).emit(eventName, data);
    
    // Log broadcast
    this.logWebSocketMessage(endpointId, 'broadcast', 'send', eventName, data);
  }

  addWebSocketRule(endpointId: string, rule: WebSocketRule) {
    const rules = this.wsRules.get(endpointId) || [];
    rules.push(rule);
    this.wsRules.set(endpointId, rules);
  }

  removeWebSocketRule(endpointId: string, ruleId: string) {
    const rules = this.wsRules.get(endpointId) || [];
    const filtered = rules.filter(r => r.id !== ruleId);
    this.wsRules.set(endpointId, filtered);
  }

  private logWebSocketMessage(
    endpointId: string,
    connectionId: string,
    direction: 'send' | 'receive' | 'disconnect',
    eventName: string,
    data: any
  ) {
    // Store in database or memory for inspection
    // This will integrate with your existing request logging
    console.log({
      type: 'websocket',
      endpointId,
      connectionId,
      direction,
      eventName,
      data,
      timestamp: new Date(),
    });
  }

  private getFakerHelpers() {
    // Return faker functions (integrate with your existing faker setup)
    return {
      name: {
        firstName: () => 'John',
        lastName: () => 'Doe',
      },
      internet: {
        email: () => 'test@example.com',
      },
      // Add more as needed
    };
  }
}
```

#### 2. SSE Handler

```typescript
// src/routes/sse-mock.routes.ts

import { Router, Request, Response } from 'express';
import Handlebars from 'handlebars';

const router = Router();

interface SSEConnection {
  response: Response;
  endpointId: string;
  rules: SSERule[];
  intervals: NodeJS.Timeout[];
}

const sseConnections: Map<string, SSEConnection> = new Map();

router.get('/sse/:endpointId', async (req: Request, res: Response) => {
  const { endpointId } = req.params;
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Load SSE rules for this endpoint
  const rules = await loadSSERules(endpointId);

  // Send initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Connected' })}\n\n`);

  // Store connection
  const connectionId = crypto.randomUUID();
  const intervals: NodeJS.Timeout[] = [];

  sseConnections.set(connectionId, {
    response: res,
    endpointId,
    rules,
    intervals,
  });

  // Start scheduled events
  rules.forEach(rule => {
    if (rule.interval > 0) {
      let eventCount = 0;
      
      const interval = setInterval(() => {
        try {
          // Check max events limit
          if (rule.maxEvents && eventCount >= rule.maxEvents) {
            clearInterval(interval);
            return;
          }

          // Compile template
          const template = Handlebars.compile(rule.dataTemplate);
          const context = {
            eventCount,
            timestamp: Date.now(),
            now: new Date().toISOString(),
            faker: getFakerHelpers(),
          };

          const data = template(context);

          // Send SSE event
          res.write(`event: ${rule.eventName}\n`);
          res.write(`data: ${data}\n\n`);

          eventCount++;
        } catch (error) {
          console.error('Error sending SSE event:', error);
        }
      }, rule.interval);

      intervals.push(interval);
    }
  });

  // Handle client disconnect
  req.on('close', () => {
    const connection = sseConnections.get(connectionId);
    if (connection) {
      connection.intervals.forEach(interval => clearInterval(interval));
      sseConnections.delete(connectionId);
    }
    console.log('SSE client disconnected:', connectionId);
  });
});

// Endpoint to trigger manual SSE events
router.post('/sse/:endpointId/send', async (req: Request, res: Response) => {
  const { endpointId } = req.params;
  const { eventName, data } = req.body;

  // Find all connections for this endpoint
  let sent = 0;
  sseConnections.forEach(connection => {
    if (connection.endpointId === endpointId) {
      connection.response.write(`event: ${eventName}\n`);
      connection.response.write(`data: ${JSON.stringify(data)}\n\n`);
      sent++;
    }
  });

  res.json({ message: `Event sent to ${sent} connections` });
});

async function loadSSERules(endpointId: string): Promise<SSERule[]> {
  // Load from database
  // This should integrate with your existing rule storage
  return [];
}

function getFakerHelpers() {
  return {
    name: {
      firstName: () => 'John',
      lastName: () => 'Doe',
    },
    datatype: {
      number: () => Math.floor(Math.random() * 100),
    },
  };
}

export default router;
```

### Frontend Implementation

#### 1. WebSocket Configuration Panel

```typescript
// src/components/WebSocketConfigPanel.tsx

import React, { useState } from 'react';
import { Plus, Trash2, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

export function WebSocketConfigPanel({ endpointId }: { endpointId: string }) {
  const [rules, setRules] = useState<WebSocketRule[]>([]);
  const [editing, setEditing] = useState<string | null>(null);

  const addRule = () => {
    const newRule: WebSocketRule = {
      id: crypto.randomUUID(),
      endpointId,
      eventName: '',
      responseTemplate: '{\n  "message": "Hello"\n}',
      autoRespond: true,
    };
    setRules([...rules, newRule]);
    setEditing(newRule.id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-semibold">WebSocket Configuration</h3>
        </div>
        <Button onClick={addRule}>
          <Plus className="mr-2 h-4 w-4" />
          Add Rule
        </Button>
      </div>

      <Card className="p-4 bg-blue-50 border-blue-200">
        <p className="text-sm text-blue-800">
          <strong>Connection URL:</strong>{' '}
          <code className="bg-blue-100 px-2 py-1 rounded">
            wss://your-domain.com/ws-mock?endpointId={endpointId}
          </code>
        </p>
      </Card>

      {rules.map(rule => (
        <Card key={rule.id} className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">
                {rule.eventName || 'Unnamed Rule'}
              </h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRules(rules.filter(r => r.id !== rule.id))}
              >
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Event Name</Label>
                <Input
                  value={rule.eventName}
                  onChange={(e) => {
                    const updated = rules.map(r =>
                      r.id === rule.id ? { ...r, eventName: e.target.value } : r
                    );
                    setRules(updated);
                  }}
                  placeholder="message, update, etc."
                />
                <p className="text-xs text-gray-600 mt-1">
                  Use * to match all events
                </p>
              </div>

              <div>
                <Label>Response Delay (ms)</Label>
                <Input
                  type="number"
                  value={rule.responseDelay || 0}
                  onChange={(e) => {
                    const updated = rules.map(r =>
                      r.id === rule.id 
                        ? { ...r, responseDelay: parseInt(e.target.value) } 
                        : r
                    );
                    setRules(updated);
                  }}
                />
              </div>
            </div>

            <div>
              <Label>Response Template (JSON)</Label>
              <Textarea
                value={rule.responseTemplate}
                onChange={(e) => {
                  const updated = rules.map(r =>
                    r.id === rule.id 
                      ? { ...r, responseTemplate: e.target.value } 
                      : r
                  );
                  setRules(updated);
                }}
                rows={6}
                className="font-mono text-sm"
              />
              <p className="text-xs text-gray-600 mt-1">
                Use Handlebars syntax: {`{{faker.name.firstName}}`}, {`{{uuid}}`}, {`{{request.data.fieldName}}`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={rule.autoRespond}
                onCheckedChange={(checked) => {
                  const updated = rules.map(r =>
                    r.id === rule.id ? { ...r, autoRespond: checked } : r
                  );
                  setRules(updated);
                }}
              />
              <Label>Auto-respond to this event</Label>
            </div>
          </div>
        </Card>
      ))}

      {rules.length === 0 && (
        <Card className="p-8 text-center">
          <Radio className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <p className="text-gray-600">No WebSocket rules configured</p>
          <Button variant="link" onClick={addRule}>
            Create your first rule
          </Button>
        </Card>
      )}
    </div>
  );
}
```

#### 2. WebSocket Tester

```typescript
// src/components/WebSocketTester.tsx

import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export function WebSocketTester({ endpointId }: { endpointId: string }) {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Array<{ direction: string; data: any; timestamp: Date }>>([]);
  const [eventName, setEventName] = useState('message');
  const [messageData, setMessageData] = useState('{\n  "test": "data"\n}');
  const wsRef = useRef<WebSocket | null>(null);

  const connect = () => {
    const ws = new WebSocket(`wss://your-domain.com/ws-mock?endpointId=${endpointId}`);
    
    ws.onopen = () => {
      setConnected(true);
      addMessage('system', { status: 'Connected' });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        addMessage('receive', data);
      } catch {
        addMessage('receive', { message: event.data });
      }
    };

    ws.onclose = () => {
      setConnected(false);
      addMessage('system', { status: 'Disconnected' });
    };

    ws.onerror = (error) => {
      addMessage('error', { error: 'Connection error' });
    };

    wsRef.current = ws;
  };

  const disconnect = () => {
    wsRef.current?.close();
    wsRef.current = null;
  };

  const sendMessage = () => {
    if (!wsRef.current || !connected) return;

    try {
      const data = JSON.parse(messageData);
      wsRef.current.send(JSON.stringify({ event: eventName, data }));
      addMessage('send', data);
    } catch (error) {
      addMessage('error', { error: 'Invalid JSON' });
    }
  };

  const addMessage = (direction: string, data: any) => {
    setMessages(prev => [...prev, { direction, data, timestamp: new Date() }]);
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">WebSocket Tester</h3>
          {connected ? (
            <Button variant="destructive" size="sm" onClick={disconnect}>
              <Square className="mr-2 h-4 w-4" />
              Disconnect
            </Button>
          ) : (
            <Button size="sm" onClick={connect}>
              <Play className="mr-2 h-4 w-4" />
              Connect
            </Button>
          )}
        </div>

        {connected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Event Name</Label>
                <Input
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="message"
                />
              </div>
            </div>

            <div>
              <Label>Message Data (JSON)</Label>
              <Textarea
                value={messageData}
                onChange={(e) => setMessageData(e.target.value)}
                rows={4}
                className="font-mono text-sm"
              />
            </div>

            <Button onClick={sendMessage} className="w-full">
              <Send className="mr-2 h-4 w-4" />
              Send Message
            </Button>
          </div>
        )}

        <div className="border rounded-lg p-4 bg-gray-50 max-h-96 overflow-y-auto">
          <h4 className="font-semibold mb-2">Message Log</h4>
          {messages.length === 0 ? (
            <p className="text-sm text-gray-600">No messages yet</p>
          ) : (
            <div className="space-y-2">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`text-sm p-2 rounded ${
                    msg.direction === 'send'
                      ? 'bg-blue-100 ml-8'
                      : msg.direction === 'receive'
                      ? 'bg-green-100 mr-8'
                      : msg.direction === 'error'
                      ? 'bg-red-100'
                      : 'bg-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold capitalize">{msg.direction}</span>
                    <span className="text-xs text-gray-600">
                      {msg.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <pre className="text-xs overflow-x-auto">
                    {JSON.stringify(msg.data, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
```

#### 3. SSE Configuration Panel

```typescript
// src/components/SSEConfigPanel.tsx

import React, { useState } from 'react';
import { Plus, Trash2, Rss } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface SSERule {
  id: string;
  eventName: string;
  dataTemplate: string;
  interval: number;
  maxEvents?: number;
}

export function SSEConfigPanel({ endpointId }: { endpointId: string }) {
  const [rules, setRules] = useState<SSERule[]>([]);

  const addRule = () => {
    const newRule: SSERule = {
      id: crypto.randomUUID(),
      eventName: 'update',
      dataTemplate: '{\n  "timestamp": "{{now}}",\n  "value": {{faker.datatype.number}}\n}',
      interval: 1000,
    };
    setRules([...rules, newRule]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rss className="h-5 w-5 text-orange-600" />
          <h3 className="text-lg font-semibold">Server-Sent Events (SSE)</h3>
        </div>
        <Button onClick={addRule}>
          <Plus className="mr-2 h-4 w-4" />
          Add Event Stream
        </Button>
      </div>

      <Card className="p-4 bg-orange-50 border-orange-200">
        <p className="text-sm text-orange-800">
          <strong>SSE Endpoint:</strong>{' '}
          <code className="bg-orange-100 px-2 py-1 rounded">
            https://your-domain.com/sse/{endpointId}
          </code>
        </p>
      </Card>

      {rules.map(rule => (
        <Card key={rule.id} className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">{rule.eventName}</h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRules(rules.filter(r => r.id !== rule.id))}
              >
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Event Name</Label>
                <Input
                  value={rule.eventName}
                  onChange={(e) => {
                    const updated = rules.map(r =>
                      r.id === rule.id ? { ...r, eventName: e.target.value } : r
                    );
                    setRules(updated);
                  }}
                  placeholder="update, status, etc."
                />
              </div>

              <div>
                <Label>Interval (ms)</Label>
                <Input
                  type="number"
                  value={rule.interval}
                  onChange={(e) => {
                    const updated = rules.map(r =>
                      r.id === rule.id 
                        ? { ...r, interval: parseInt(e.target.value) } 
                        : r
                    );
                    setRules(updated);
                  }}
                />
              </div>

              <div>
                <Label>Max Events (optional)</Label>
                <Input
                  type="number"
                  value={rule.maxEvents || ''}
                  onChange={(e) => {
                    const updated = rules.map(r =>
                      r.id === rule.id 
                        ? { ...r, maxEvents: e.target.value ? parseInt(e.target.value) : undefined } 
                        : r
                    );
                    setRules(updated);
                  }}
                  placeholder="Unlimited"
                />
              </div>
            </div>

            <div>
              <Label>Data Template (JSON)</Label>
              <Textarea
                value={rule.dataTemplate}
                onChange={(e) => {
                  const updated = rules.map(r =>
                    r.id === rule.id ? { ...r, dataTemplate: e.target.value } : r
                  );
                  setRules(updated);
                }}
                rows={6}
                className="font-mono text-sm"
              />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
```

### Testing Checklist

- [ ] WebSocket connections established successfully
- [ ] Messages sent from client received by server
- [ ] Auto-respond rules trigger correctly
- [ ] Response templates compiled properly
- [ ] Delays applied as configured
- [ ] Multiple clients can connect simultaneously
- [ ] Broadcast messages reach all clients
- [ ] SSE connections stream events continuously
- [ ] SSE interval timing is accurate
- [ ] Max events limit respected
- [ ] WebSocket tester UI functional
- [ ] Message log displays correctly
- [ ] Disconnection handled gracefully

---

## Feature #18: GraphQL/gRPC Mocking

### Overview
Add support for mocking GraphQL and gRPC APIs with schema validation and realistic response generation.

### Backend Implementation - GraphQL

#### 1. GraphQL Schema Parser & Mock Generator

```typescript
// src/services/graphql-mock.service.ts

import { buildSchema, GraphQLSchema, parse, validate, execute } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import Handlebars from 'handlebars';
import { faker } from '@faker-js/faker';

interface GraphQLMockConfig {
  id: string;
  endpointId: string;
  schema: string;
  resolvers: Record<string, any>;
  introspectionEnabled: boolean;
}

export class GraphQLMockService {
  private schemas: Map<string, GraphQLSchema> = new Map();
  private configs: Map<string, GraphQLMockConfig> = new Map();

  async createMockFromSchema(endpointId: string, schemaString: string): Promise<GraphQLSchema> {
    try {
      // Parse and validate schema
      const schema = buildSchema(schemaString);
      
      // Generate resolvers automatically
      const resolvers = this.generateResolversFromSchema(schema);
      
      // Create executable schema
      const executableSchema = makeExecutableSchema({
        typeDefs: schemaString,
        resolvers,
      });

      const config: GraphQLMockConfig = {
        id: crypto.randomUUID(),
        endpointId,
        schema: schemaString,
        resolvers,
        introspectionEnabled: true,
      };

      this.schemas.set(endpointId, executableSchema);
      this.configs.set(endpointId, config);

      return executableSchema;
    } catch (error) {
      throw new Error(`Invalid GraphQL schema: ${error.message}`);
    }
  }

  private generateResolversFromSchema(schema: GraphQLSchema): Record<string, any> {
    const resolvers: Record<string, any> = {
      Query: {},
      Mutation: {},
    };

    const queryType = schema.getQueryType();
    const mutationType = schema.getMutationType();

    // Generate Query resolvers
    if (queryType) {
      const fields = queryType.getFields();
      Object.keys(fields).forEach(fieldName => {
        const field = fields[fieldName];
        resolvers.Query[fieldName] = () => {
          return this.generateMockData(field.type);
        };
      });
    }

    // Generate Mutation resolvers
    if (mutationType) {
      const fields = mutationType.getFields();
      Object.keys(fields).forEach(fieldName => {
        const field = fields[fieldName];
        resolvers.Mutation[fieldName] = (_: any, args: any) => {
          // Echo back input with some modifications
          return {
            success: true,
            ...args,
            id: crypto.randomUUID(),
          };
        };
      });
    }

    return resolvers;
  }

  private generateMockData(type: any): any {
    const typeName = type.toString().replace(/[[\]!]/g, '');

    // Handle lists
    if (type.toString().includes('[')) {
      return Array.from({ length: faker.number.int({ min: 3, max: 5 }) }, () =>
        this.generateMockData(type.ofType)
      );
    }

    // Handle scalar types
    switch (typeName) {
      case 'String':
        return faker.lorem.sentence();
      case 'Int':
        return faker.number.int({ min: 1, max: 1000 });
      case 'Float':
        return faker.number.float({ min: 0, max: 100, precision: 0.01 });
      case 'Boolean':
        return faker.datatype.boolean();
      case 'ID':
        return faker.string.uuid();
      default:
        // Handle custom types
        return this.generateObjectData(typeName);
    }
  }

  private generateObjectData(typeName: string): any {
    // Map common type names to appropriate data
    const typePatterns: Record<string, () => any> = {
      User: () => ({
        id: faker.string.uuid(),
        name: faker.person.fullName(),
        email: faker.internet.email(),
        age: faker.number.int({ min: 18, max: 80 }),
      }),
      Post: () => ({
        id: faker.string.uuid(),
        title: faker.lorem.sentence(),
        content: faker.lorem.paragraphs(2),
        createdAt: faker.date.past().toISOString(),
      }),
      Product: () => ({
        id: faker.string.uuid(),
        name: faker.commerce.productName(),
        price: parseFloat(faker.commerce.price()),
        description: faker.commerce.productDescription(),
      }),
    };

    if (typePatterns[typeName]) {
      return typePatterns[typeName]();
    }

    // Generic object
    return {
      id: faker.string.uuid(),
      name: faker.lorem.word(),
      value: faker.lorem.sentence(),
    };
  }

  async executeQuery(endpointId: string, query: string, variables?: any): Promise<any> {
    const schema = this.schemas.get(endpointId);
    
    if (!schema) {
      throw new Error('GraphQL schema not found for endpoint');
    }

    try {
      // Parse query
      const document = parse(query);
      
      // Validate query against schema
      const errors = validate(schema, document);
      if (errors.length > 0) {
        return {
          errors: errors.map(e => ({ message: e.message })),
        };
      }

      // Execute query
      const result = await execute({
        schema,
        document,
        variableValues: variables,
      });

      return result;
    } catch (error) {
      return {
        errors: [{ message: error.message }],
      };
    }
  }

  getSchemaSDL(endpointId: string): string | null {
    const config = this.configs.get(endpointId);
    return config?.schema || null;
  }
}
```

#### 2. GraphQL Route Handler (Fastify)

```typescript
// src/routes/graphql-mock.routes.ts

import { FastifyPluginAsync } from 'fastify';
import { GraphQLMockService } from '../services/graphql-mock.service.js';

const graphqlMockService = new GraphQLMockService();

const graphqlMockRoutes: FastifyPluginAsync = async (fastify) => {
  // Create GraphQL mock from schema
  fastify.post('/api/graphql-mocks', async (request, reply) => {
    const { endpointId, schema } = request.body as { endpointId: string; schema: string };

    try {
      await graphqlMockService.createMockFromSchema(endpointId, schema);
      
      return {
        success: true,
        message: 'GraphQL mock created successfully',
      };
    } catch (error) {
      reply.status(400);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // Handle GraphQL queries
  fastify.post('/graphql/:endpointId', async (request, reply) => {
    const { endpointId } = request.params as { endpointId: string };
    const { query, variables } = request.body as { query: string; variables?: any };

    try {
      const result = await graphqlMockService.executeQuery(endpointId, query, variables);
      return result;
    } catch (error) {
      reply.status(500);
      return {
        errors: [{ message: error.message }],
      };
    }
  });

  // Get schema SDL for GraphQL Playground
  fastify.get('/graphql/:endpointId/schema', async (request, reply) => {
    const { endpointId } = request.params as { endpointId: string };

    const schema = graphqlMockService.getSchemaSDL(endpointId);
    
    if (!schema) {
      reply.status(404);
      return { error: 'Schema not found' };
    }

    return { schema };
  });

  // GraphQL Playground HTML
  fastify.get('/graphql/:endpointId/playground', async (request, reply) => {
    const { endpointId } = request.params as { endpointId: string };

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>GraphQL Playground</title>
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/graphql-playground-react/build/static/css/index.css" />
          <script src="https://cdn.jsdelivr.net/npm/graphql-playground-react/build/static/js/middleware.js"></script>
        </head>
        <body>
          <div id="root"></div>
          <script>
            window.addEventListener('load', function(event) {
              GraphQLPlayground.init(document.getElementById('root'), {
                endpoint: '/graphql/${endpointId}',
                settings: {
                  'editor.theme': 'light',
                }
              })
            })
          </script>
        </body>
      </html>
    `;

    reply.type('text/html').send(html);
  });
};

export default graphqlMockRoutes;
```

### Backend Implementation - gRPC

#### 1. gRPC Mock Service

```typescript
// src/services/grpc-mock.service.ts

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { faker } from '@faker-js/faker';
import { ProtoGrpcType } from '@grpc/grpc-js';

interface GrpcMockConfig {
  id: string;
  endpointId: string;
  protoFile: string;
  serviceName: string;
  port: number;
}

export class GrpcMockService {
  private servers: Map<string, grpc.Server> = new Map();
  private configs: Map<string, GrpcMockConfig> = new Map();

  async createMockFromProto(
    endpointId: string,
    protoContent: string,
    serviceName: string
  ): Promise<number> {
    try {
      // Save proto file temporarily
      const protoPath = `/tmp/${endpointId}.proto`;
      await fs.promises.writeFile(protoPath, protoContent);

      // Load proto file
      const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });

      const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as ProtoGrpcType;

      // Find the service
      const serviceDefinition = this.findService(protoDescriptor, serviceName);
      
      if (!serviceDefinition) {
        throw new Error(`Service ${serviceName} not found in proto file`);
      }

      // Generate mock implementations for all methods
      const implementation = this.generateMockImplementation(serviceDefinition);

      // Create and start server
      const server = new grpc.Server();
      server.addService(serviceDefinition.service, implementation);

      const port = await this.bindServer(server);

      const config: GrpcMockConfig = {
        id: crypto.randomUUID(),
        endpointId,
        protoFile: protoContent,
        serviceName,
        port,
      };

      this.servers.set(endpointId, server);
      this.configs.set(endpointId, config);

      return port;
    } catch (error) {
      throw new Error(`Failed to create gRPC mock: ${error.message}`);
    }
  }

  private findService(proto: any, serviceName: string): any {
    // Recursively search for service
    const search = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return null;
      
      if (obj[serviceName] && obj[serviceName].service) {
        return obj[serviceName];
      }

      for (const key of Object.keys(obj)) {
        const result = search(obj[key]);
        if (result) return result;
      }

      return null;
    };

    return search(proto);
  }

  private generateMockImplementation(serviceDefinition: any): any {
    const implementation: any = {};

    const methods = serviceDefinition.service;
    
    Object.keys(methods).forEach(methodName => {
      const method = methods[methodName];

      if (method.requestStream && method.responseStream) {
        // Bidirectional streaming
        implementation[methodName] = (call: any) => {
          call.on('data', (request: any) => {
            const response = this.generateMockResponse(method.responseType);
            call.write(response);
          });
          call.on('end', () => {
            call.end();
          });
        };
      } else if (method.requestStream) {
        // Client streaming
        implementation[methodName] = (call: any, callback: any) => {
          const requests: any[] = [];
          call.on('data', (request: any) => {
            requests.push(request);
          });
          call.on('end', () => {
            const response = this.generateMockResponse(method.responseType);
            callback(null, response);
          });
        };
      } else if (method.responseStream) {
        // Server streaming
        implementation[methodName] = (call: any) => {
          const count = faker.number.int({ min: 3, max: 5 });
          for (let i = 0; i < count; i++) {
            const response = this.generateMockResponse(method.responseType);
            call.write(response);
          }
          call.end();
        };
      } else {
        // Unary call
        implementation[methodName] = (call: any, callback: any) => {
          const response = this.generateMockResponse(method.responseType);
          callback(null, response);
        };
      }
    });

    return implementation;
  }

  private generateMockResponse(responseType: any): any {
    // Generate mock data based on message type
    const response: any = {};

    if (responseType?.type?.field) {
      responseType.type.field.forEach((field: any) => {
        response[field.name] = this.generateFieldValue(field);
      });
    }

    return response;
  }

  private generateFieldValue(field: any): any {
    switch (field.type) {
      case 'string':
        return faker.lorem.sentence();
      case 'int32':
      case 'int64':
        return faker.number.int({ min: 1, max: 1000 });
      case 'float':
      case 'double':
        return faker.number.float({ min: 0, max: 100 });
      case 'bool':
        return faker.datatype.boolean();
      default:
        // Handle custom message types
        return this.generateMockResponse(field.type);
    }
  }

  private async bindServer(server: grpc.Server): Promise<number> {
    return new Promise((resolve, reject) => {
      // Try to bind to a random port
      const port = faker.number.int({ min: 50000, max: 60000 });
      server.bindAsync(
        `0.0.0.0:${port}`,
        grpc.ServerCredentials.createInsecure(),
        (error, boundPort) => {
          if (error) {
            reject(error);
          } else {
            server.start();
            resolve(boundPort);
          }
        }
      );
    });
  }

  stopMock(endpointId: string): void {
    const server = this.servers.get(endpointId);
    if (server) {
      server.forceShutdown();
      this.servers.delete(endpointId);
      this.configs.delete(endpointId);
    }
  }

  getMockInfo(endpointId: string): GrpcMockConfig | null {
    return this.configs.get(endpointId) || null;
  }
}
```

### Frontend Implementation

#### 1. GraphQL Schema Editor

```typescript
// src/components/GraphQLMockPanel.tsx

import React, { useState } from 'react';
import { Code, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

const EXAMPLE_SCHEMA = `type User {
  id: ID!
  name: String!
  email: String!
  posts: [Post!]!
}

type Post {
  id: ID!
  title: String!
  content: String!
  author: User!
  createdAt: String!
}

type Query {
  user(id: ID!): User
  users: [User!]!
  post(id: ID!): Post
  posts: [Post!]!
}

type Mutation {
  createUser(name: String!, email: String!): User!
  createPost(title: String!, content: String!, authorId: ID!): Post!
}`;

export function GraphQLMockPanel({ endpointId }: { endpointId: string }) {
  const [schema, setSchema] = useState(EXAMPLE_SCHEMA);
  const [creating, setCreating] = useState(false);

  const createMock = async () => {
    setCreating(true);
    try {
      const response = await fetch('/api/graphql-mocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpointId, schema }),
      });

      if (!response.ok) {
        throw new Error('Failed to create GraphQL mock');
      }

      toast.success('GraphQL mock created successfully!');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code className="h-5 w-5 text-pink-600" />
          <h3 className="text-lg font-semibold">GraphQL Mock</h3>
        </div>
        <Button onClick={createMock} disabled={creating}>
          {creating ? 'Creating...' : 'Create Mock'}
        </Button>
      </div>

      <Card className="p-4 bg-pink-50 border-pink-200">
        <p className="text-sm text-pink-800">
          <strong>GraphQL Endpoint:</strong>{' '}
          <code className="bg-pink-100 px-2 py-1 rounded">
            POST https://your-domain.com/graphql/{endpointId}
          </code>
        </p>
        <p className="text-sm text-pink-800 mt-2">
          <strong>Playground:</strong>{' '}
          <a
            href={`/graphql/${endpointId}/playground`}
            target="_blank"
            className="text-pink-600 underline"
          >
            Open GraphQL Playground
          </a>
        </p>
      </Card>

      <div>
        <label className="block text-sm font-medium mb-2">Schema (SDL)</label>
        <Textarea
          value={schema}
          onChange={(e) => setSchema(e.target.value)}
          rows={20}
          className="font-mono text-sm"
          placeholder="Enter GraphQL schema..."
        />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-semibold mb-2">How it works:</h4>
        <ul className="text-sm space-y-1 list-disc list-inside text-gray-700">
          <li>Define your GraphQL schema above</li>
          <li>Mock resolvers are generated automatically</li>
          <li>Query and Mutation types are supported</li>
          <li>Responses contain realistic fake data</li>
          <li>Use the playground to test queries</li>
        </ul>
      </div>
    </div>
  );
}
```

#### 2. gRPC Configuration Panel

```typescript
// src/components/GrpcMockPanel.tsx

import React, { useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const EXAMPLE_PROTO = `syntax = "proto3";

package example;

service UserService {
  rpc GetUser (GetUserRequest) returns (User);
  rpc ListUsers (ListUsersRequest) returns (stream User);
  rpc CreateUser (CreateUserRequest) returns (User);
}

message User {
  string id = 1;
  string name = 2;
  string email = 3;
  int32 age = 4;
}

message GetUserRequest {
  string id = 1;
}

message ListUsersRequest {
  int32 page = 1;
  int32 pageSize = 2;
}

message CreateUserRequest {
  string name = 1;
  string email = 2;
  int32 age = 3;
}`;

export function GrpcMockPanel({ endpointId }: { endpointId: string }) {
  const [protoContent, setProtoContent] = useState(EXAMPLE_PROTO);
  const [serviceName, setServiceName] = useState('UserService');
  const [port, setPort] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const createMock = async () => {
    setCreating(true);
    try {
      const response = await fetch('/api/grpc-mocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpointId, protoContent, serviceName }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create gRPC mock');
      }

      setPort(data.port);
      toast.success(`gRPC mock created on port ${data.port}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">gRPC Mock</h3>
        <Button onClick={createMock} disabled={creating}>
          {creating ? 'Creating...' : 'Create Mock'}
        </Button>
      </div>

      {port && (
        <Card className="p-4 bg-green-50 border-green-200">
          <p className="text-sm text-green-800">
            <strong>gRPC Server:</strong>{' '}
            <code className="bg-green-100 px-2 py-1 rounded">
              localhost:{port}
            </code>
          </p>
        </Card>
      )}

      <div>
        <Label>Service Name</Label>
        <Input
          value={serviceName}
          onChange={(e) => setServiceName(e.target.value)}
          placeholder="UserService"
        />
      </div>

      <div>
        <Label>Proto File Content</Label>
        <Textarea
          value={protoContent}
          onChange={(e) => setProtoContent(e.target.value)}
          rows={20}
          className="font-mono text-sm"
          placeholder="Enter proto definition..."
        />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-semibold mb-2">Connection Example (Node.js):</h4>
        <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto">
{`const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const packageDefinition = protoLoader.loadSync('user.proto');
const proto = grpc.loadPackageDefinition(packageDefinition);

const client = new proto.example.UserService(
  'localhost:${port || 'PORT'}',
  grpc.credentials.createInsecure()
);

client.GetUser({ id: '123' }, (error, response) => {
  console.log(response);
});`}
        </pre>
      </div>
    </div>
  );
}
```

### Testing Checklist

- [ ] GraphQL schema parses correctly
- [ ] Resolvers generated for all queries
- [ ] Mock data returned for queries
- [ ] Mutations handled properly
- [ ] GraphQL Playground accessible
- [ ] Introspection works
- [ ] gRPC proto file loads successfully
- [ ] gRPC server starts on available port
- [ ] Unary calls return mock data
- [ ] Server streaming works
- [ ] Client streaming works
- [ ] Bidirectional streaming works

---

## Enhancement #5: Advanced Search & Filter for Request History

### Overview
Enhance the existing request inspection with advanced search, filtering, and faceting capabilities.

### Backend Implementation (Fastify + PostgreSQL + Redis)

#### 1. Database Schema Enhancement

```prisma
// prisma/schema.prisma

model RequestLog {
  id            String   @id @default(uuid())
  endpointId    String
  method        String
  path          String
  queryString   String?
  statusCode    Int
  requestHeaders Json
  requestBody   String?
  responseHeaders Json
  responseBody  String?
  responseTime  Int     // milliseconds
  clientIp      String
  userAgent     String?
  timestamp     DateTime @default(now())
  
  // Indexes for search
  @@index([endpointId, timestamp(sort: Desc)])
  @@index([endpointId, method])
  @@index([endpointId, statusCode])
  @@index([endpointId, path])
  @@fulltext([path, requestBody, responseBody])
}
```

#### 2. Search Service with Redis Caching

```typescript
// src/services/request-search.service.ts

import { PrismaClient, Prisma } from '@prisma/client';
import { Redis } from 'ioredis';

interface SearchFilters {
  endpointId: string;
  method?: string;
  path?: string;
  statusCode?: number;
  statusRange?: 'success' | 'redirect' | 'client-error' | 'server-error';
  fromDate?: Date;
  toDate?: Date;
  searchText?: string;
  clientIp?: string;
  minResponseTime?: number;
  maxResponseTime?: number;
}

interface SearchOptions {
  page?: number;
  limit?: number;
  sortBy?: 'timestamp' | 'responseTime' | 'statusCode';
  sortOrder?: 'asc' | 'desc';
}

interface SearchResult {
  requests: any[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    methods: Record<string, number>;
    statusCodes: Record<string, number>;
    paths: Record<string, number>;
  };
}

export class RequestSearchService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis
  ) {}

  async search(filters: SearchFilters, options: SearchOptions = {}): Promise<SearchResult> {
    const {
      page = 1,
      limit = 50,
      sortBy = 'timestamp',
      sortOrder = 'desc',
    } = options;

    // Build cache key
    const cacheKey = this.buildCacheKey(filters, options);
    
    // Check cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Build where clause
    const where: Prisma.RequestLogWhereInput = {
      endpointId: filters.endpointId,
    };

    if (filters.method) {
      where.method = filters.method;
    }

    if (filters.path) {
      where.path = {
        contains: filters.path,
        mode: 'insensitive',
      };
    }

    if (filters.statusCode) {
      where.statusCode = filters.statusCode;
    } else if (filters.statusRange) {
      const ranges = {
        'success': { gte: 200, lt: 300 },
        'redirect': { gte: 300, lt: 400 },
        'client-error': { gte: 400, lt: 500 },
        'server-error': { gte: 500, lt: 600 },
      };
      where.statusCode = ranges[filters.statusRange];
    }

    if (filters.fromDate || filters.toDate) {
      where.timestamp = {};
      if (filters.fromDate) {
        where.timestamp.gte = filters.fromDate;
      }
      if (filters.toDate) {
        where.timestamp.lte = filters.toDate;
      }
    }

    if (filters.searchText) {
      where.OR = [
        { path: { contains: filters.searchText, mode: 'insensitive' } },
        { requestBody: { contains: filters.searchText, mode: 'insensitive' } },
        { responseBody: { contains: filters.searchText, mode: 'insensitive' } },
      ];
    }

    if (filters.clientIp) {
      where.clientIp = filters.clientIp;
    }

    if (filters.minResponseTime || filters.maxResponseTime) {
      where.responseTime = {};
      if (filters.minResponseTime) {
        where.responseTime.gte = filters.minResponseTime;
      }
      if (filters.maxResponseTime) {
        where.responseTime.lte = filters.maxResponseTime;
      }
    }

    // Execute search query
    const [requests, total] = await Promise.all([
      this.prisma.requestLog.findMany({
        where,
        orderBy: {
          [sortBy]: sortOrder,
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.requestLog.count({ where }),
    ]);

    // Get facets
    const facets = await this.getFacets(filters.endpointId, where);

    const result: SearchResult = {
      requests,
      total,
      page,
      pageSize: limit,
      facets,
    };

    // Cache result for 30 seconds
    await this.redis.setex(cacheKey, 30, JSON.stringify(result));

    return result;
  }

  private async getFacets(
    endpointId: string,
    baseWhere: Prisma.RequestLogWhereInput
  ): Promise<SearchResult['facets']> {
    const [methodCounts, statusCounts, pathCounts] = await Promise.all([
      this.prisma.requestLog.groupBy({
        by: ['method'],
        where: { ...baseWhere, endpointId },
        _count: true,
      }),
      this.prisma.requestLog.groupBy({
        by: ['statusCode'],
        where: { ...baseWhere, endpointId },
        _count: true,
      }),
      this.prisma.requestLog.groupBy({
        by: ['path'],
        where: { ...baseWhere, endpointId },
        _count: true,
        take: 10,
        orderBy: {
          _count: {
            path: 'desc',
          },
        },
      }),
    ]);

    return {
      methods: Object.fromEntries(
        methodCounts.map(m => [m.method, m._count])
      ),
      statusCodes: Object.fromEntries(
        statusCounts.map(s => [s.statusCode.toString(), s._count])
      ),
      paths: Object.fromEntries(
        pathCounts.map(p => [p.path, p._count])
      ),
    };
  }

  private buildCacheKey(filters: SearchFilters, options: SearchOptions): string {
    return `request-search:${JSON.stringify({ filters, options })}`;
  }

  async exportToCSV(filters: SearchFilters): Promise<string> {
    const where = this.buildWhereClause(filters);
    
    const requests = await this.prisma.requestLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: 10000, // Limit export to 10k records
    });

    // Generate CSV
    const headers = [
      'Timestamp',
      'Method',
      'Path',
      'Status Code',
      'Response Time (ms)',
      'Client IP',
    ];

    const rows = requests.map(r => [
      r.timestamp.toISOString(),
      r.method,
      r.path,
      r.statusCode.toString(),
      r.responseTime.toString(),
      r.clientIp,
    ]);

    return [
      headers.join(','),
      ...rows.map(row => row.join(',')),
    ].join('\n');
  }

  private buildWhereClause(filters: SearchFilters): Prisma.RequestLogWhereInput {
    // Reuse logic from search method
    // ... (same as in search method)
    return {};
  }
}
```

#### 3. Fastify Routes

```typescript
// src/routes/request-search.routes.ts

import { FastifyPluginAsync } from 'fastify';
import { RequestSearchService } from '../services/request-search.service.js';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL);
const searchService = new RequestSearchService(prisma, redis);

const requestSearchRoutes: FastifyPluginAsync = async (fastify) => {
  // Search requests
  fastify.get('/api/endpoints/:endpointId/requests/search', async (request, reply) => {
    const { endpointId } = request.params as { endpointId: string };
    const query = request.query as any;

    const filters: SearchFilters = {
      endpointId,
      method: query.method,
      path: query.path,
      statusCode: query.statusCode ? parseInt(query.statusCode) : undefined,
      statusRange: query.statusRange,
      fromDate: query.fromDate ? new Date(query.fromDate) : undefined,
      toDate: query.toDate ? new Date(query.toDate) : undefined,
      searchText: query.q,
      clientIp: query.clientIp,
      minResponseTime: query.minResponseTime ? parseInt(query.minResponseTime) : undefined,
      maxResponseTime: query.maxResponseTime ? parseInt(query.maxResponseTime) : undefined,
    };

    const options: SearchOptions = {
      page: query.page ? parseInt(query.page) : 1,
      limit: query.limit ? parseInt(query.limit) : 50,
      sortBy: query.sortBy || 'timestamp',
      sortOrder: query.sortOrder || 'desc',
    };

    const result = await searchService.search(filters, options);
    return result;
  });

  // Export to CSV
  fastify.get('/api/endpoints/:endpointId/requests/export', async (request, reply) => {
    const { endpointId } = request.params as { endpointId: string };
    const query = request.query as any;

    const filters: SearchFilters = {
      endpointId,
      method: query.method,
      statusCode: query.statusCode ? parseInt(query.statusCode) : undefined,
      fromDate: query.fromDate ? new Date(query.fromDate) : undefined,
      toDate: query.toDate ? new Date(query.toDate) : undefined,
    };

    const csv = await searchService.exportToCSV(filters);

    reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="requests-${endpointId}.csv"`)
      .send(csv);
  });

  // Get saved filters
  fastify.get('/api/endpoints/:endpointId/filters', async (request, reply) => {
    const { endpointId } = request.params as { endpointId: string };
    
    const savedFilters = await prisma.savedFilter.findMany({
      where: { endpointId },
    });

    return { filters: savedFilters };
  });

  // Save filter
  fastify.post('/api/endpoints/:endpointId/filters', async (request, reply) => {
    const { endpointId } = request.params as { endpointId: string };
    const { name, filters } = request.body as { name: string; filters: any };

    const savedFilter = await prisma.savedFilter.create({
      data: {
        endpointId,
        name,
        filters,
      },
    });

    return savedFilter;
  });
};

export default requestSearchRoutes;
```

### Frontend Implementation

```typescript
// src/components/AdvancedRequestSearch.tsx

import React, { useState, useEffect } from 'react';
import { Search, Filter, Download, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';

export function AdvancedRequestSearch({ endpointId }: { endpointId: string }) {
  const [filters, setFilters] = useState({
    searchText: '',
    method: '',
    statusRange: '',
    fromDate: '',
    toDate: '',
    minResponseTime: '',
    maxResponseTime: '',
  });

  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['requests', endpointId, filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.append(key, value);
      });
      
      const response = await fetch(
        `/api/endpoints/${endpointId}/requests/search?${params}`
      );
      return response.json();
    },
  });

  const exportCSV = async () => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.append(key, value);
    });

    window.open(`/api/endpoints/${endpointId}/requests/export?${params}`);
  };

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            className="pl-10"
            placeholder="Search paths, request/response bodies..."
            value={filters.searchText}
            onChange={(e) => setFilters({ ...filters, searchText: e.target.value })}
          />
        </div>
        <Button
          variant="outline"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <Filter className="mr-2 h-4 w-4" />
          Filters
        </Button>
        <Button variant="outline" onClick={exportCSV}>
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      </div>

      {/* Advanced Filters */}
      {showAdvanced && (
        <Card className="p-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Method</Label>
              <Select
                value={filters.method}
                onValueChange={(value) => setFilters({ ...filters, method: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All methods" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Status Range</Label>
              <Select
                value={filters.statusRange}
                onValueChange={(value) => setFilters({ ...filters, statusRange: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="success">2xx (Success)</SelectItem>
                  <SelectItem value="redirect">3xx (Redirect)</SelectItem>
                  <SelectItem value="client-error">4xx (Client Error)</SelectItem>
                  <SelectItem value="server-error">5xx (Server Error)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Date Range</Label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={filters.fromDate}
                  onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })}
                />
                <Input
                  type="date"
                  value={filters.toDate}
                  onChange={(e) => setFilters({ ...filters, toDate: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>Response Time (ms)</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Min"
                  value={filters.minResponseTime}
                  onChange={(e) => setFilters({ ...filters, minResponseTime: e.target.value })}
                />
                <Input
                  type="number"
                  placeholder="Max"
                  value={filters.maxResponseTime}
                  onChange={(e) => setFilters({ ...filters, maxResponseTime: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="ghost"
              onClick={() => setFilters({
                searchText: '',
                method: '',
                statusRange: '',
                fromDate: '',
                toDate: '',
                minResponseTime: '',
                maxResponseTime: '',
              })}
            >
              Clear All
            </Button>
            <Button variant="outline">
              <Save className="mr-2 h-4 w-4" />
              Save Filter
            </Button>
          </div>
        </Card>
      )}

      {/* Active Filters */}
      {Object.values(filters).some(v => v) && (
        <div className="flex flex-wrap gap-2">
          {filters.method && (
            <Badge variant="secondary">
              Method: {filters.method}
              <X
                className="ml-1 h-3 w-3 cursor-pointer"
                onClick={() => setFilters({ ...filters, method: '' })}
              />
            </Badge>
          )}
          {filters.statusRange && (
            <Badge variant="secondary">
              Status: {filters.statusRange}
              <X
                className="ml-1 h-3 w-3 cursor-pointer"
                onClick={() => setFilters({ ...filters, statusRange: '' })}
              />
            </Badge>
          )}
        </div>
      )}

      {/* Facets */}
      {data?.facets && (
        <div className="grid grid-cols-3 gap-4">
          <Card className="p-4">
            <h4 className="font-semibold mb-2">By Method</h4>
            <div className="space-y-1">
              {Object.entries(data.facets.methods).map(([method, count]) => (
                <div key={method} className="flex justify-between text-sm">
                  <span>{method}</span>
                  <span className="text-gray-600">{count}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h4 className="font-semibold mb-2">By Status</h4>
            <div className="space-y-1">
              {Object.entries(data.facets.statusCodes).map(([status, count]) => (
                <div key={status} className="flex justify-between text-sm">
                  <span>{status}</span>
                  <span className="text-gray-600">{count}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h4 className="font-semibold mb-2">Top Paths</h4>
            <div className="space-y-1">
              {Object.entries(data.facets.paths).slice(0, 5).map(([path, count]) => (
                <div key={path} className="flex justify-between text-sm">
                  <span className="truncate flex-1">{path}</span>
                  <span className="text-gray-600 ml-2">{count}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Results */}
      <div className="text-sm text-gray-600 mb-2">
        {data && `Showing ${data.requests.length} of ${data.total} requests`}
      </div>

      {/* Request list rendering here... */}
    </div>
  );
}
```

### Testing Checklist

- [ ] Full-text search works across paths and bodies
- [ ] Method filter works correctly
- [ ] Status range filter works
- [ ] Date range filter works
- [ ] Response time filter works
- [ ] Multiple filters can be combined
- [ ] Facets display correctly
- [ ] Facets update when filters change
- [ ] CSV export includes filtered results
- [ ] Pagination works with filters
- [ ] Sorting works (timestamp, responseTime, statusCode)
- [ ] Cache improves performance for repeated searches
- [ ] Saved filters can be created and loaded

---

## Enhancement #9: AI Data Generation UI for OpenAPI

### Overview
Add a user interface for the AI-enhanced OpenAPI import feature.

### Implementation

```typescript
// src/components/OpenAPIImportWizard.tsx

import React, { useState } from 'react';
import { Upload, Sparkles, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

export function OpenAPIImportWizard({ endpointId, onComplete }: any) {
  const [step, setStep] = useState(1);
  const [spec, setSpec] = useState('');
  const [useAI, setUseAI] = useState(true);
  const [dataQuality, setDataQuality] = useState(70);
  const [preview, setPreview] = useState<any>(null);
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    setImporting(true);
    try {
      const response = await fetch('/api/openapi/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointId,
          spec,
          useAI,
          dataQuality,
        }),
      });

      const data = await response.json();
      setPreview(data.preview);
      setStep(3);
    } catch (error) {
      toast.error('Failed to import OpenAPI spec');
    } finally {
      setImporting(false);
    }
  };

  const handleConfirm = async () => {
    await fetch('/api/openapi/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpointId,
        preview,
      }),
    });

    toast.success('OpenAPI spec imported successfully!');
    onComplete();
  };

  return (
    <div className="space-y-6">
      {/* Progress Indicator */}
      <div className="flex items-center justify-between">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`flex items-center ${s < 3 ? 'flex-1' : ''}`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center ${
                s <= step
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-600'
              }`}
            >
              {s < step ? <Check className="h-4 w-4" /> : s}
            </div>
            {s < 3 && (
              <div
                className={`h-1 flex-1 mx-2 ${
                  s < step ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Upload OpenAPI Specification</h3>
          <Textarea
            rows={15}
            placeholder="Paste your OpenAPI/Swagger JSON or YAML here..."
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            className="font-mono text-sm"
          />
          <div className="flex justify-end mt-4">
            <Button
              onClick={() => setStep(2)}
              disabled={!spec.trim()}
            >
              Next
            </Button>
          </div>
        </Card>
      )}

      {/* Step 2: Configuration */}
      {step === 2 && (
        <Card className="p-6 space-y-6">
          <h3 className="text-lg font-semibold">Import Configuration</h3>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-semibold">
                Use AI for Data Generation
              </Label>
              <p className="text-sm text-gray-600">
                Generate realistic, context-aware test data using AI
              </p>
            </div>
            <Switch
              checked={useAI}
              onCheckedChange={setUseAI}
            />
          </div>

          {useAI && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Data Quality Level</Label>
                <span className="text-sm font-medium">{dataQuality}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={dataQuality}
                onChange={(e) => setDataQuality(parseInt(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>Simple</span>
                <span>Realistic</span>
                <span>Production-like</span>
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Higher quality generates more realistic data but takes longer
              </p>
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded p-4">
            <h4 className="font-semibold mb-2">What will be imported:</h4>
            <ul className="text-sm space-y-1 list-disc list-inside">
              <li>All API endpoints and operations</li>
              <li>Request/response schemas</li>
              <li>Mock rules with {useAI ? 'AI-generated' : 'basic'} data</li>
              <li>Status codes and error responses</li>
            </ul>
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button onClick={handleImport} disabled={importing}>
              {importing ? 'Importing...' : 'Import & Preview'}
            </Button>
          </div>
        </Card>
      )}

      {/* Step 3: Preview */}
      {step === 3 && preview && (
        <div className="space-y-4">
          <Card className="p-4 bg-green-50 border-green-200">
            <div className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-600" />
              <span className="font-semibold">
                Found {preview.endpoints.length} endpoints
              </span>
            </div>
          </Card>

          <div className="space-y-2">
            {preview.endpoints.slice(0, 5).map((endpoint: any, idx: number) => (
              <Card key={idx} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline">{endpoint.method}</Badge>
                      <code className="text-sm">{endpoint.path}</code>
                    </div>
                    <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto">
                      {JSON.stringify(endpoint.exampleResponse, null, 2).slice(0, 200)}...
                    </pre>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      // Regenerate this endpoint's data
                    }}
                  >
                    Regenerate
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          {preview.endpoints.length > 5 && (
            <p className="text-sm text-gray-600 text-center">
              ... and {preview.endpoints.length - 5} more endpoints
            </p>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button onClick={handleConfirm}>
              Confirm & Create Rules
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Testing Checklist

- [ ] OpenAPI JSON parses correctly
- [ ] OpenAPI YAML parses correctly
- [ ] All endpoints detected
- [ ] AI data generation toggle works
- [ ] Data quality slider affects output
- [ ] Preview shows realistic data
- [ ] Regenerate works for individual endpoints
- [ ] Confirmation creates all mock rules
- [ ] Error messages are helpful

---

## Enhancement #16: Advanced Request Transformation

### Overview
Add ability to transform requests and responses before proxying or mocking.

### Backend Implementation

```typescript
// src/services/request-transformer.service.ts

import { JSONPath } from 'jsonpath-plus';
import Handlebars from 'handlebars';

interface TransformRule {
  id: string;
  endpointId: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: TransformCondition[];
  transformations: Transformation[];
}

interface TransformCondition {
  type: 'header' | 'query' | 'body' | 'path';
  field: string;
  operator: 'equals' | 'contains' | 'regex' | 'exists';
  value: string;
}

interface Transformation {
  target: 'request' | 'response';
  type: 'add-header' | 'remove-header' | 'modify-header' | 'modify-body' | 'modify-status';
  field?: string;
  value?: string;
  jsonPath?: string;
}

export class RequestTransformerService {
  async transformRequest(
    request: any,
    rules: TransformRule[]
  ): Promise<any> {
    let transformed = { ...request };

    // Sort by priority
    const sortedRules = rules
      .filter(r => r.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (this.matchesConditions(request, rule.conditions)) {
        transformed = this.applyTransformations(
          transformed,
          rule.transformations.filter(t => t.target === 'request')
        );
      }
    }

    return transformed;
  }

  async transformResponse(
    response: any,
    request: any,
    rules: TransformRule[]
  ): Promise<any> {
    let transformed = { ...response };

    const sortedRules = rules
      .filter(r => r.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (this.matchesConditions(request, rule.conditions)) {
        transformed = this.applyTransformations(
          transformed,
          rule.transformations.filter(t => t.target === 'response')
        );
      }
    }

    return transformed;
  }

  private matchesConditions(
    request: any,
    conditions: TransformCondition[]
  ): boolean {
    if (conditions.length === 0) return true;

    return conditions.every(condition => {
      let actualValue: any;

      switch (condition.type) {
        case 'header':
          actualValue = request.headers[condition.field.toLowerCase()];
          break;
        case 'query':
          actualValue = request.query[condition.field];
          break;
        case 'body':
          actualValue = JSONPath({
            path: condition.field,
            json: request.body,
          })[0];
          break;
        case 'path':
          actualValue = request.path;
          break;
      }

      switch (condition.operator) {
        case 'equals':
          return actualValue === condition.value;
        case 'contains':
          return String(actualValue).includes(condition.value);
        case 'regex':
          return new RegExp(condition.value).test(String(actualValue));
        case 'exists':
          return actualValue !== undefined && actualValue !== null;
        default:
          return false;
      }
    });
  }

  private applyTransformations(
    data: any,
    transformations: Transformation[]
  ): any {
    let result = { ...data };

    transformations.forEach(transform => {
      switch (transform.type) {
        case 'add-header':
          if (!result.headers) result.headers = {};
          result.headers[transform.field!] = this.evaluateValue(
            transform.value!,
            data
          );
          break;

        case 'remove-header':
          if (result.headers) {
            delete result.headers[transform.field!];
          }
          break;

        case 'modify-header':
          if (result.headers && transform.field) {
            result.headers[transform.field] = this.evaluateValue(
              transform.value!,
              data
            );
          }
          break;

        case 'modify-body':
          if (transform.jsonPath && transform.value) {
            const paths = JSONPath({
              path: transform.jsonPath,
              json: result.body,
              resultType: 'path',
            });

            paths.forEach((path: string) => {
              JSONPath({
                path,
                json: result.body,
                callback: () => this.evaluateValue(transform.value!, data),
              });
            });
          }
          break;

        case 'modify-status':
          result.statusCode = parseInt(transform.value!);
          break;
      }
    });

    return result;
  }

  private evaluateValue(template: string, context: any): any {
    try {
      const compiled = Handlebars.compile(template);
      return compiled(context);
    } catch {
      return template;
    }
  }
}
```

### Frontend Implementation

```typescript
// src/components/TransformRulesPanel.tsx

import React, { useState } from 'react';
import { Plus, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

export function TransformRulesPanel({ endpointId }: { endpointId: string }) {
  const [rules, setRules] = useState<TransformRule[]>([]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Request/Response Transformation</h3>
        <Button onClick={() => addNewRule()}>
          <Plus className="mr-2 h-4 w-4" />
          Add Rule
        </Button>
      </div>

      {rules.map(rule => (
        <Card key={rule.id} className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Input
                value={rule.name}
                onChange={(e) => updateRule(rule.id, { name: e.target.value })}
                placeholder="Rule name"
                className="flex-1 mr-4"
              />
              <Switch
                checked={rule.enabled}
                onCheckedChange={(checked) =>
                  updateRule(rule.id, { enabled: checked })
                }
              />
            </div>

            <div>
              <Label>Conditions (all must match)</Label>
              {rule.conditions.map((condition, idx) => (
                <div key={idx} className="flex gap-2 mt-2">
                  <Select
                    value={condition.type}
                    onValueChange={(value) =>
                      updateCondition(rule.id, idx, { type: value })
                    }
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="header">Header</SelectItem>
                      <SelectItem value="query">Query</SelectItem>
                      <SelectItem value="body">Body</SelectItem>
                      <SelectItem value="path">Path</SelectItem>
                    </SelectContent>
                  </Select>

                  <Input
                    placeholder="Field"
                    value={condition.field}
                    onChange={(e) =>
                      updateCondition(rule.id, idx, { field: e.target.value })
                    }
                    className="flex-1"
                  />

                  <Select
                    value={condition.operator}
                    onValueChange={(value) =>
                      updateCondition(rule.id, idx, { operator: value })
                    }
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="equals">Equals</SelectItem>
                      <SelectItem value="contains">Contains</SelectItem>
                      <SelectItem value="regex">Regex</SelectItem>
                      <SelectItem value="exists">Exists</SelectItem>
                    </SelectContent>
                  </Select>

                  <Input
                    placeholder="Value"
                    value={condition.value}
                    onChange={(e) =>
                      updateCondition(rule.id, idx, { value: e.target.value })
                    }
                    className="flex-1"
                  />
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addCondition(rule.id)}
                className="mt-2"
              >
                <Plus className="mr-2 h-3 w-3" />
                Add Condition
              </Button>
            </div>

            <div className="flex items-center gap-2 text-gray-600">
              <ArrowRight className="h-4 w-4" />
              <span className="text-sm font-medium">Then transform:</span>
            </div>

            <div>
              {rule.transformations.map((transform, idx) => (
                <div key={idx} className="flex gap-2 mt-2">
                  <Select
                    value={transform.target}
                    onValueChange={(value) =>
                      updateTransform(rule.id, idx, { target: value })
                    }
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="request">Request</SelectItem>
                      <SelectItem value="response">Response</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={transform.type}
                    onValueChange={(value) =>
                      updateTransform(rule.id, idx, { type: value })
                    }
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="add-header">Add Header</SelectItem>
                      <SelectItem value="remove-header">Remove Header</SelectItem>
                      <SelectItem value="modify-header">Modify Header</SelectItem>
                      <SelectItem value="modify-body">Modify Body (JSONPath)</SelectItem>
                      <SelectItem value="modify-status">Modify Status</SelectItem>
                    </SelectContent>
                  </Select>

                  {transform.type.includes('body') && (
                    <Input
                      placeholder="JSONPath (e.g., $.user.name)"
                      value={transform.jsonPath || ''}
                      onChange={(e) =>
                        updateTransform(rule.id, idx, { jsonPath: e.target.value })
                      }
                      className="flex-1"
                    />
                  )}

                  {transform.type.includes('header') && (
                    <Input
                      placeholder="Header name"
                      value={transform.field || ''}
                      onChange={(e) =>
                        updateTransform(rule.id, idx, { field: e.target.value })
                      }
                      className="flex-1"
                    />
                  )}

                  <Input
                    placeholder="Value (supports {{templates}})"
                    value={transform.value || ''}
                    onChange={(e) =>
                      updateTransform(rule.id, idx, { value: e.target.value })
                    }
                    className="flex-1"
                  />
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addTransformation(rule.id)}
                className="mt-2"
              >
                <Plus className="mr-2 h-3 w-3" />
                Add Transformation
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
```

### Testing Checklist

- [ ] Header transformations work (add/remove/modify)
- [ ] Body transformations work with JSONPath
- [ ] Status code modification works
- [ ] Conditions match correctly (equals/contains/regex)
- [ ] Multiple conditions work with AND logic
- [ ] Priority ordering respected
- [ ] Disabled rules are skipped
- [ ] Template values evaluated correctly
- [ ] Request transformations applied before proxying
- [ ] Response transformations applied after proxying

---

## Summary

This document provides detailed implementation guides for:

1. ✅ Feature #15: AI-Powered Rule Generation
2. ✅ Feature #17: WebSocket/SSE Mocking
3. ✅ Feature #18: GraphQL/gRPC Mocking
4. ✅ Enhancement #5: Advanced Search & Filter
5. ✅ Enhancement #9: AI Data Generation UI
6. ✅ Enhancement #16: Request Transformation

### Implementation Priority

**Phase 1 (High Impact):**
- Enhancement #5: Advanced Search (improves existing feature)
- Enhancement #9: AI OpenAPI UI (completes partial feature)
- Feature #15: AI Rule Generation (huge productivity boost)

**Phase 2 (Advanced Features):**
- Feature #17: WebSocket/SSE (specialized use case)
- Enhancement #16: Request Transformation (power user feature)

**Phase 3 (Specialized):**
- Feature #18: GraphQL/gRPC (niche but complete)