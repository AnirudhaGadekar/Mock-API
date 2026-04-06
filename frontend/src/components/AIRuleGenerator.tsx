import { api } from '@/lib/api';
import { RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Textarea } from './ui/textarea';

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
    const [promptText, setPromptText] = useState('');
    const [generatedRule, setGeneratedRule] = useState<any>(null);
    const [showExamples, setShowExamples] = useState(true);
    const [loading, setLoading] = useState(false);

    const generateRule = async () => {
        if (!promptText.trim()) {
            toast.error('Please enter a description');
            return;
        }

        try {
            setLoading(true);
            const response = await api.post('/api/v2/ai/generate-rule', {
                prompt: promptText,
                endpointId
            });

            setGeneratedRule(response.data.rule);
            setShowExamples(false);
            toast.success('Rule generated successfully!');
        } catch (error: any) {
            toast.error(error.response?.data?.error || 'Failed to generate rule');
        } finally {
            setLoading(false);
        }
    };

    const refineRule = async (refinementPrompt: string) => {
        try {
            setLoading(true);
            const response = await api.post('/api/v2/ai/refine-rule', {
                existingRule: generatedRule,
                refinementPrompt
            });

            setGeneratedRule(response.data.rule);
            toast.success('Rule refined successfully!');
        } catch (error: any) {
            toast.error(error.response?.data?.error || 'Failed to refine rule');
        } finally {
            setLoading(false);
        }
    };

    const handleRegenerate = () => {
        generateRule();
    };

    const handleAccept = () => {
        onRuleGenerated(generatedRule);
        setGeneratedRule(null);
        setPromptText('');
        setShowExamples(true);
    };

    return (
        <div className="space-y-4">
            <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="h-5 w-5 text-primary" />
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
                            value={promptText}
                            onChange={(e) => setPromptText(e.target.value)}
                            rows={4}
                            className="w-full"
                        />
                    </div>

                    {showExamples && (
                        <div>
                            <p className="mb-2 text-sm text-muted-foreground">Try these examples:</p>
                            <div className="flex flex-wrap gap-2">
                                {EXAMPLE_PROMPTS.map((example, idx) => (
                                    <Button
                                        key={idx}
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPromptText(example)}
                                    >
                                        {example}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    )}

                    <Button
                        onClick={generateRule}
                        disabled={loading || !promptText.trim()}
                        className="w-full"
                    >
                        {loading ? (
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
                            disabled={loading}
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
                            <p className="text-sm text-muted-foreground">{generatedRule.description}</p>
                        )}

                        <div>
                            <label className="block text-sm font-medium mb-2">Response Template</label>
                            <pre className="surface-code rounded-[1rem] p-4 text-xs overflow-x-auto">
                                {typeof generatedRule.responseTemplate === 'string'
                                    ? generatedRule.responseTemplate
                                    : JSON.stringify(JSON.parse(generatedRule.responseTemplate), null, 2)}
                            </pre>
                        </div>

                        <div className="flex gap-2">
                            <Button onClick={handleAccept} className="flex-1">
                                Accept & Create Rule
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    const refinement = window.prompt('How would you like to refine this rule?');
                                    if (refinement) refineRule(refinement);
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

