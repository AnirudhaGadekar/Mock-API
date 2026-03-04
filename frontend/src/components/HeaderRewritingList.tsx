import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

export interface HeaderRewritingRule {
    key: string;
    value?: string;
    op: 'SET' | 'APPEND' | 'DELETE';
}

interface HeaderRewritingListProps {
    rules: HeaderRewritingRule[];
    onChange: (rules: HeaderRewritingRule[]) => void;
    addButtonText?: string;
}

export function HeaderRewritingList({
    rules,
    onChange,
    addButtonText = "Add Rewrite Rule"
}: HeaderRewritingListProps) {
    const handleAdd = () => {
        onChange([...rules, { key: "", value: "", op: 'SET' }]);
    };

    const updateRule = (index: number, patch: Partial<HeaderRewritingRule>) => {
        const newRules = [...rules];
        newRules[index] = { ...newRules[index], ...patch };
        onChange(newRules);
    };

    const handleDelete = (index: number) => {
        onChange(rules.filter((_, i) => i !== index));
    };

    return (
        <div className="space-y-2">
            {rules.map((rule, index) => (
                <div key={index} className="flex items-center gap-2 bg-secondary/20 p-2 rounded-md border border-border/30">
                    <div className="w-24">
                        <Select
                            value={rule.op}
                            onValueChange={(v: any) => updateRule(index, { op: v })}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="SET">SET</SelectItem>
                                <SelectItem value="APPEND">APPEND</SelectItem>
                                <SelectItem value="DELETE">DELETE</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <Input
                        placeholder="Header Name"
                        value={rule.key}
                        onChange={(e) => updateRule(index, { key: e.target.value })}
                        className="flex-1 h-8 font-mono text-xs"
                    />
                    {rule.op !== 'DELETE' && (
                        <Input
                            placeholder="Value (supports template)"
                            value={rule.value || ''}
                            onChange={(e) => updateRule(index, { value: e.target.value })}
                            className="flex-1 h-8 font-mono text-xs"
                        />
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(index)}
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            ))}
            {rules.length === 0 && (
                <div className="text-sm text-muted-foreground italic text-center py-2">
                    No rewriting rules defined.
                </div>
            )}
            <Button
                variant="outline"
                size="sm"
                onClick={handleAdd}
                className="w-full mt-2 h-8 text-xs"
            >
                <Plus className="h-3 w-3 mr-2" />
                {addButtonText}
            </Button>
        </div>
    );
}
