import { cn } from "@/lib/utils";
import { Globe } from "lucide-react";
import type { ElementType, ReactNode } from "react";

type AuthFeature = {
    icon: ElementType;
    title: string;
    description: string;
};

type AuthMetric = {
    label: string;
    value: string;
};

type AuthShellProps = {
    eyebrow: string;
    title: string;
    description: string;
    children: ReactNode;
    heroTitle?: string;
    heroDescription?: string;
    features?: AuthFeature[];
    metrics?: AuthMetric[];
    panelClassName?: string;
};

export function AuthShell({
    eyebrow,
    title,
    description,
    children,
    heroTitle = "Mock APIs for teams that ship fast",
    heroDescription = "Design, test, and observe realistic mock services with the same control surface your team uses every day.",
    features = [],
    metrics = [],
    panelClassName,
}: AuthShellProps) {
    return (
        <div className="auth-shell">
            <div className="auth-shell-inner">
                <section className="auth-hero auth-side">
                    <div className="auth-side-panel">
                        <div className="auth-kicker">
                            <Globe size={14} />
                            MockAPI Platform
                        </div>

                        <div className="mt-6 max-w-xl">
                            <h1 className="text-4xl font-semibold leading-tight text-balance md:text-5xl">
                                {heroTitle}
                            </h1>
                            <p className="mt-4 max-w-lg text-base leading-7 text-muted-foreground md:text-lg">
                                {heroDescription}
                            </p>
                        </div>

                        {features.length > 0 && (
                            <div className="auth-feature-list mt-8">
                                {features.map((feature) => {
                                    const Icon = feature.icon;
                                    return (
                                        <div key={feature.title} className="auth-feature-item">
                                            <div className="auth-feature-icon">
                                                <Icon size={18} />
                                            </div>
                                            <div>
                                                <h2 className="text-base font-semibold">{feature.title}</h2>
                                                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                                    {feature.description}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {metrics.length > 0 && (
                            <div className="auth-metrics mt-8">
                                {metrics.map((metric) => (
                                    <div key={metric.label} className="auth-metric">
                                        <div className="auth-metric-label">{metric.label}</div>
                                        <div className="auth-metric-value">{metric.value}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </section>

                <section className={cn("auth-panel", panelClassName)}>
                    <div className="auth-panel-body">
                        <div className="auth-kicker">
                            <span className="h-2 w-2 rounded-full bg-primary" />
                            {eyebrow}
                        </div>
                        <div className="mt-6">
                            <h2 className="text-3xl font-semibold text-balance">{title}</h2>
                            <p className="mt-3 text-sm leading-6 text-muted-foreground md:text-[15px]">
                                {description}
                            </p>
                        </div>

                        <div className="mt-8">{children}</div>

                        <div className="mt-12 flex items-center gap-4 text-xs text-muted-foreground border-t border-border/40 pt-6">
                            <a href="/privacy" className="hover:text-primary hover:underline transition-colors">
                                Privacy Policy
                            </a>
                            <span className="h-1 w-1 rounded-full bg-border" />
                            <a href="/terms" className="hover:text-primary hover:underline transition-colors">
                                Terms of Service
                            </a>
                            <span className="h-1 w-1 rounded-full bg-border" />
                            <a href="mailto:mockurlteam@gmail.com" className="hover:text-primary hover:underline transition-colors">
                                Contact
                            </a>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
