import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
    "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.02em] transition-colors focus:outline-none focus:ring-4 focus:ring-ring/15",
    {
        variants: {
            variant: {
                default:
                    "border-primary/20 bg-primary/12 text-primary shadow-soft hover:bg-primary/16",
                secondary:
                    "border-border/70 bg-secondary/85 text-secondary-foreground hover:bg-secondary",
                destructive:
                    "border-destructive/20 bg-destructive/12 text-destructive hover:bg-destructive/16",
                outline: "border-border/75 bg-background/72 text-foreground",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    }
)

export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, ...props }: BadgeProps) {
    return (
        <div className={cn(badgeVariants({ variant }), className)} {...props} />
    )
}

export { Badge, badgeVariants }
