import { cn } from "@/lib/utils"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent text-sm font-semibold transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-200 ease-out focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.99] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    {
        variants: {
            variant: {
                default:
                    "bg-primary text-primary-foreground shadow-[0_18px_40px_-20px_hsl(var(--primary)/0.8)] hover:bg-primary/92",
                destructive:
                    "bg-destructive text-destructive-foreground shadow-[0_18px_40px_-20px_hsl(var(--destructive)/0.72)] hover:bg-destructive/92",
                outline:
                    "border-border/75 bg-background/80 text-foreground shadow-soft backdrop-blur hover:border-primary/30 hover:bg-secondary/80",
                secondary:
                    "bg-secondary/90 text-secondary-foreground shadow-soft hover:bg-secondary",
                ghost: "text-muted-foreground hover:border-border/70 hover:bg-secondary/70 hover:text-foreground",
                link: "text-primary underline-offset-4 hover:underline",
                tertiary:
                    "border-border/65 bg-card/80 text-foreground shadow-soft hover:border-accent/35 hover:text-accent",
            },
            size: {
                default: "h-11 px-4 py-2.5",
                sm: "h-9 rounded-lg px-3.5 text-[13px]",
                lg: "h-12 rounded-xl px-6 text-base",
                icon: "h-11 w-11",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button"
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        )
    }
)
Button.displayName = "Button"

export { Button, buttonVariants }
