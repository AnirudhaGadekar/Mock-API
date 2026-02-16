import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, Plus, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";

interface TemplateHelperProps {
    onInsert?: (text: string) => void;
}

const TEMPLATE_VARS = [
    { category: "Request", label: "Request Body", value: "{{req.body}}" },
    { category: "Request", label: "Request Query Param", value: "{{req.query.paramName}}" },
    { category: "Request", label: "Request Header", value: "{{req.headers.header-name}}" },
    { category: "Request", label: "Request Path Param", value: "{{req.params.id}}" },
    { category: "Faker", label: "First Name", value: "{{faker.person.firstName}}" },
    { category: "Faker", label: "Last Name", value: "{{faker.person.lastName}}" },
    { category: "Faker", label: "Email", value: "{{faker.internet.email}}" },
    { category: "Faker", label: "UUID", value: "{{uuid}}" },
    { category: "Faker", label: "Company Name", value: "{{faker.company.name}}" },
    { category: "Faker", label: "Phone Number", value: "{{faker.phone.number}}" },
    { category: "Helpers", label: "Current Timestamp", value: "{{timestamp}}" },
    { category: "Helpers", label: "ISO Date", value: "{{now}}" },
    { category: "Helpers", label: "Random Int (1-100)", value: "{{randomInt 1 100}}" },
];

export function TemplateHelper({ onInsert }: TemplateHelperProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");

    const handleSelect = (value: string) => {
        if (onInsert) {
            onInsert(value);
        } else {
            navigator.clipboard.writeText(value);
            toast.success("Copied to clipboard!");
        }
        setOpen(false);
    };

    const filteredVars = TEMPLATE_VARS.filter(v =>
        v.label.toLowerCase().includes(search.toLowerCase()) ||
        v.value.toLowerCase().includes(search.toLowerCase()) ||
        v.category.toLowerCase().includes(search.toLowerCase())
    );

    const groupedVars = filteredVars.reduce((acc, v) => {
        if (!acc[v.category]) acc[v.category] = [];
        acc[v.category].push(v);
        return acc;
    }, {} as Record<string, typeof TEMPLATE_VARS>);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1">
                    <Plus className="h-3 w-3" />
                    Insert Variable
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Insert Variable</DialogTitle>
                    <DialogDescription>
                        Choose a dynamic variable to insert into your response.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-2">
                    <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search variables..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-8"
                        />
                    </div>
                    <ScrollArea className="h-[300px] mt-4 pr-4">
                        <div className="space-y-4">
                            {Object.entries(groupedVars).map(([category, vars]) => (
                                <div key={category}>
                                    <h4 className="text-sm font-medium mb-2 text-muted-foreground">{category}</h4>
                                    <div className="grid gap-2">
                                        {vars.map(v => (
                                            <Button
                                                key={v.value}
                                                variant="secondary"
                                                className="justify-between h-auto py-2 px-3"
                                                onClick={() => handleSelect(v.value)}
                                            >
                                                <div className="flex flex-col items-start gap-1 text-left">
                                                    <span className="font-medium text-xs">{v.label}</span>
                                                    <code className="text-[10px] text-muted-foreground font-normal">{v.value}</code>
                                                </div>
                                                <Copy className="h-3 w-3 text-muted-foreground" />
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                            {filteredVars.length === 0 && (
                                <p className="text-sm text-center text-muted-foreground py-4">No variables found.</p>
                            )}
                        </div>
                    </ScrollArea>
                </div>
            </DialogContent>
        </Dialog>
    );
}
