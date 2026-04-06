import { cva } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

const inputVariants = cva(
    "flex h-11 w-full rounded-2xl border border-input/80 bg-background/75 px-4 py-2 text-sm text-foreground shadow-[inset_0_1px_0_hsl(var(--background)/0.35)] transition-[border-color,box-shadow,background-color] duration-200 file:mr-3 file:rounded-xl file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-semibold placeholder:text-muted-foreground/90 focus-visible:border-primary/45 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50",
    {
        variants: {},
    }
)

export interface InputProps
    extends React.InputHTMLAttributes<HTMLInputElement> { }

const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, ...props }, ref) => {
        return (
            <input
                type={type}
                className={cn(inputVariants(), className)}
                ref={ref}
                {...props}
            />
        )
    }
)
Input.displayName = "Input"

export { Input }
