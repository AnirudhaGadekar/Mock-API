import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";



interface KeyValueListProps {
    items: Record<string, string>;
    onChange: (items: Record<string, string>) => void;
    keyPlaceholder?: string;
    valuePlaceholder?: string;
    addButtonText?: string;
}

export function KeyValueList({
    items,
    onChange,
    keyPlaceholder = "Key",
    valuePlaceholder = "Value",
    addButtonText = "Add Item"
}: KeyValueListProps) {
    const entries = Object.entries(items);

    const handleAdd = () => {
        // Prevent duplicate empty keys issues by using a slightly different approach if needed, 
        // but for simple string maps, we just add a new empty key.
        // However, object keys must be unique. 
        // Let's defer adding to the object until the user types something unique?
        // Actually, typical pattern is to manage an array of objects for editing, then convert to Record.
        // But to keep props simple, we'll try to manage it.
        // Better approach for UI: Let's assume we can have multiple empty keys while editing? No, Object can't.
        // We really should use an array of pairs for the internal state of this component if we want robust editing,
        // but for now, let's just add a placeholder key like "" or "new_key".

        let newKey = "";
        if (items[""]) {
            // "new_key_1", "new_key_2"...
            let i = 1;
            while (items[`new_key_${i}`] !== undefined) i++;
            newKey = `new_key_${i}`;
        }

        const newItems = { ...items, [newKey]: "" };
        onChange(newItems);
    };

    const handleChange = (oldKey: string, newKey: string, newValue: string) => {
        if (oldKey === newKey) {
            // Just value update
            const newItems = { ...items, [newKey]: newValue };
            onChange(newItems);
        } else {
            // Key update: need to preserve order? Object order is not guaranteed but usually insertion order.
            // We reconstruct the object.
            const newItems: Record<string, string> = {};
            entries.forEach(([k, v]) => {
                if (k === oldKey) {
                    newItems[newKey] = newValue;
                } else {
                    newItems[k] = v;
                }
            });
            onChange(newItems);
        }
    };

    const handleDelete = (keyToDelete: string) => {
        const newItems = { ...items };
        delete newItems[keyToDelete];
        onChange(newItems);
    };

    return (
        <div className="space-y-2">
            {entries.map(([key, value], index) => (
                <div key={index} className="flex items-center gap-2">
                    <Input
                        placeholder={keyPlaceholder}
                        value={key}
                        onChange={(e) => handleChange(key, e.target.value, value)}
                        className="flex-1 font-mono text-xs"
                    />
                    <Input
                        placeholder={valuePlaceholder}
                        value={value}
                        onChange={(e) => handleChange(key, key, e.target.value)}
                        className="flex-1 font-mono text-xs"
                    />
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(key)}
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            ))}
            {entries.length === 0 && (
                <div className="text-sm text-muted-foreground italic text-center py-2">
                    No items defined.
                </div>
            )}
            <Button
                variant="outline"
                size="sm"
                onClick={handleAdd}
                className="w-full mt-2"
            >
                <Plus className="h-3 w-3 mr-2" />
                {addButtonText}
            </Button>
        </div>
    );
}
