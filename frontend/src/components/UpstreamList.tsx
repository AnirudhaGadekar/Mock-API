import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";

interface UpstreamListProps {
    upstreams: string[];
    onChange: (upstreams: string[]) => void;
}

export function UpstreamList({ upstreams, onChange }: UpstreamListProps) {
    const handleAdd = () => {
        onChange([...upstreams, ""]);
    };

    const updateUpstream = (index: number, value: string) => {
        const newUpstreams = [...upstreams];
        newUpstreams[index] = value;
        onChange(newUpstreams);
    };

    const handleDelete = (index: number) => {
        onChange(upstreams.filter((_, i) => i !== index));
    };

    return (
        <div className="space-y-2">
            {upstreams.map((url, index) => (
                <div key={index} className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-6 h-8 text-xs font-bold text-muted-foreground/50">
                        {index + 1}
                    </div>
                    <Input
                        placeholder="https://upstream-proxy-1.com/api"
                        value={url}
                        onChange={(e) => updateUpstream(index, e.target.value)}
                        className="flex-1 h-8 font-mono text-xs"
                    />
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
            {upstreams.length === 0 && (
                <div className="text-sm text-muted-foreground italic text-center py-2 border border-dashed rounded-md">
                    No daisy-chained upstreams.
                </div>
            )}
            <Button
                variant="outline"
                size="sm"
                onClick={handleAdd}
                className="w-full mt-1 h-8 text-xs"
            >
                <Plus className="h-3 w-3 mr-2" />
                Add Upstream Target
            </Button>
        </div>
    );
}
