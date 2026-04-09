import { TeamSwitcher } from "@/components/TeamSwitcher";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import {
    Activity,
    BookOpen,
    Bot,
    Database,
    Globe,
    LayoutDashboard,
    LogIn,
    LogOut,
    Menu,
    Moon,
    Network,
    Settings,
    Sun,
    X,
    Zap
} from "lucide-react";
import { useMemo, useState, type ElementType } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

const navigation = [
    {
        to: "/",
        end: true,
        label: "Overview",
        description: "Health, traffic, and quick actions",
        icon: LayoutDashboard,
    },
    {
        to: "/requests",
        label: "Live Traffic",
        description: "Inspect and replay incoming requests",
        icon: Activity,
    },
    {
        to: "/endpoints",
        label: "Endpoints",
        description: "Create and manage mock surfaces",
        icon: Globe,
    },
    {
        to: "/tunnels",
        label: "Local Tunnels",
        description: "Expose services during local development",
        icon: Network,
    },
    {
        to: "/chaos",
        label: "Chaos Rules",
        description: "Inject delay, rate limits, and failures",
        icon: Zap,
    },
    {
        to: "/ai",
        label: "AI Studio",
        description: "Generate rules from natural language",
        icon: Bot,
    },
    {
        to: "/state",
        label: "State Store",
        description: "Persist values for stateful mocks",
        icon: Database,
    },
    {
        to: "/api-explorer",
        label: "API Explorer",
        description: "Docs, snippets, and admin access",
        icon: BookOpen,
    },
    {
        to: "/settings",
        label: "Settings",
        description: "Account, keys, and workspace controls",
        icon: Settings,
    },
] as const;

function getPageMeta(pathname: string) {
    if (pathname.startsWith("/team/settings")) {
        return {
            section: "Collaboration",
            title: "Team Settings",
            description: "Invite collaborators, adjust roles, and manage access for shared workspaces.",
        };
    }

    if (pathname === "/") {
        return {
            section: "Workspace",
            title: "Command Center",
            description: "Monitor mock endpoints, traffic, and operational health from a single surface.",
        };
    }

    if (pathname.startsWith("/requests")) {
        return {
            section: "Observability",
            title: "Live Traffic",
            description: "Inspect live requests in real time, replay them, and promote useful payloads into rules.",
        };
    }

    if (pathname.startsWith("/endpoints/")) {
        return {
            section: "Build",
            title: "Endpoint Configuration",
            description: "Tune matching rules, response behavior, and advanced endpoint controls.",
        };
    }

    if (pathname.startsWith("/endpoints")) {
        return {
            section: "Build",
            title: "Endpoints",
            description: "Create, import, and organize the mock APIs that power your environments.",
        };
    }

    if (pathname.startsWith("/chaos")) {
        return {
            section: "Reliability",
            title: "Chaos Engineering",
            description: "Exercise clients under delay, error, and rate-limit scenarios without touching production.",
        };
    }

    if (pathname.startsWith("/ai")) {
        return {
            section: "Automation",
            title: "AI Rule Studio",
            description: "Turn rough requirements into structured mock rules and apply them directly to endpoints.",
        };
    }

    if (pathname.startsWith("/api-explorer")) {
        return {
            section: "Developer Tools",
            title: "API Explorer",
            description: "Jump into docs, production-ready snippets, and operational tooling.",
        };
    }

    if (pathname.startsWith("/state")) {
        return {
            section: "Data",
            title: "State Store",
            description: "Manage per-endpoint state values that power dynamic, stateful mock behavior.",
        };
    }

    if (pathname.startsWith("/tunnels")) {
        return {
            section: "Connectivity",
            title: "Local Tunnels",
            description: "Expose localhost safely, verify tunnel health, and inspect active public routes.",
        };
    }

    if (pathname.startsWith("/settings")) {
        return {
            section: "Workspace",
            title: "Settings",
            description: "Manage your account, credentials, and environment-level preferences.",
        };
    }

    return {
        section: "Workspace",
        title: "Console",
        description: "Manage endpoints, collaborate with your team, and inspect behavior from the dashboard.",
    };
}

export function DashboardLayout() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    const { user, isAnonymous, logout, loading } = useAuth();
    const { theme, toggleTheme } = useTheme();

    const pageMeta = useMemo(() => getPageMeta(location.pathname), [location.pathname]);

    const getUserInitials = () => {
        if (!user) return "?";
        if (user.name) {
            return user.name
                .split(" ")
                .map((segment) => segment[0])
                .join("")
                .toUpperCase()
                .slice(0, 2);
        }

        if (!isAnonymous && user.email) {
            return user.email[0].toUpperCase();
        }

        return "A";
    };

    return (
        <div className="min-h-screen">
            <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
            >
                Skip to content
            </a>

            {mobileMenuOpen && (
                <button
                    aria-label="Close navigation"
                    className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm md:hidden"
                    onClick={() => setMobileMenuOpen(false)}
                />
            )}

            <div className="relative flex min-h-screen flex-col md:flex-row">
                <aside
                    className={cn(
                        "fixed inset-y-0 left-0 z-50 flex w-[18.5rem] flex-col border-r border-border/70 bg-card/88 shadow-floating backdrop-blur-xl transition-transform duration-300 ease-out md:sticky md:top-0 md:m-4 md:h-[calc(100vh-2rem)] md:translate-x-0 md:rounded-[2rem] md:border",
                        mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
                    )}
                >
                    <div className="flex items-center gap-3 border-b border-border/70 px-5 py-5">
                        <div className="flex h-12 w-12 items-center justify-center rounded-[1.25rem] border border-primary/20 bg-primary/12 text-primary shadow-soft">
                            <Globe size={20} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                Mock Infrastructure
                            </p>
                            <h1 className="truncate text-lg font-semibold">MockAPI</h1>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="ml-auto md:hidden"
                            onClick={() => setMobileMenuOpen(false)}
                        >
                            <X size={18} />
                        </Button>
                    </div>

                    <div className="px-5 pt-5">
                        <div className="rounded-[1.35rem] border border-border/65 bg-background/45 p-2 shadow-soft">
                            <TeamSwitcher className="h-11 border-0 bg-transparent shadow-none" />
                        </div>
                    </div>

                    <div className="px-5 pt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Workspace
                    </div>

                    <nav className="flex-1 space-y-1.5 overflow-y-auto px-4 py-4">
                        {navigation.map((item) => (
                            <NavItem
                                key={item.to}
                                {...item}
                                onClick={() => setMobileMenuOpen(false)}
                            />
                        ))}
                    </nav>

                    <div className="border-t border-border/70 px-4 py-4">
                        <div className="mb-3 flex flex-col gap-2 rounded-[1.2rem] border border-border/70 bg-background/55 p-3 text-xs text-muted-foreground shadow-soft">
                            <NavLink to="/terms" className="flex items-center gap-2 transition-colors hover:text-primary">
                                <span className="h-1.5 w-1.5 rounded-full bg-primary/40" />
                                Terms of Service
                            </NavLink>
                            <NavLink to="/privacy" className="flex items-center gap-2 transition-colors hover:text-primary">
                                <span className="h-1.5 w-1.5 rounded-full bg-primary/40" />
                                Privacy Policy
                            </NavLink>
                        </div>

                        {loading ? (
                            <div className="rounded-[1.4rem] border border-border/70 bg-background/55 p-4 shadow-soft">
                                <div className="flex items-center gap-3">
                                    <div className="h-11 w-11 rounded-2xl bg-muted/50 animate-pulse" />
                                    <div className="min-w-0 flex-1 space-y-2">
                                        <div className="h-4 w-24 rounded-full bg-muted/50 animate-pulse" />
                                        <div className="h-3 w-32 rounded-full bg-muted/40 animate-pulse" />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-[1.4rem] border border-border/70 bg-background/60 p-4 shadow-soft">
                                <div className="flex items-center gap-3">
                                    {user?.picture ? (
                                        <img
                                            src={user.picture}
                                            alt="avatar"
                                            className="h-11 w-11 rounded-2xl object-cover"
                                        />
                                    ) : (
                                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/15 bg-primary/12 text-sm font-bold text-primary">
                                            {getUserInitials()}
                                        </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-semibold">
                                            {isAnonymous
                                                ? "Anonymous session"
                                                : user?.name || user?.email?.split("@")[0] || "User"}
                                        </p>
                                        <p className="truncate text-xs text-muted-foreground">
                                            {isAnonymous ? "Ephemeral workspace" : user?.email}
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-4 space-y-2">
                                    {isAnonymous ? (
                                        <Button
                                            className="w-full"
                                            onClick={() => navigate("/login")}
                                        >
                                            <LogIn size={14} />
                                            Sign in or create account
                                        </Button>
                                    ) : (
                                        <Button
                                            variant="ghost"
                                            className="w-full justify-center"
                                            onClick={logout}
                                        >
                                            <LogOut size={14} />
                                            Sign out
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </aside>

                <main className="flex min-w-0 flex-1 flex-col">
                    <header className="sticky top-0 z-30 px-4 pt-4 md:px-0">
                        <div className="mx-auto flex max-w-[calc(100%-2rem)] items-start gap-4 rounded-[2rem] border border-border/70 bg-card/82 px-4 py-4 shadow-card backdrop-blur-xl md:mr-4 md:mt-4 md:max-w-none md:px-6">
                            <Button
                                variant="outline"
                                size="icon"
                                className="md:hidden"
                                onClick={() => setMobileMenuOpen(true)}
                            >
                                <Menu size={19} />
                            </Button>

                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    <span>{pageMeta.section}</span>
                                    <span className="hidden sm:inline">/</span>
                                    <span className="hidden truncate sm:inline">{pageMeta.title}</span>
                                </div>
                                <h2 className="mt-2 text-2xl font-semibold md:text-[2rem]">
                                    {pageMeta.title}
                                </h2>
                                <p className="mt-1 max-w-3xl text-sm text-muted-foreground md:text-[15px]">
                                    {pageMeta.description}
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-2">
                                {isAnonymous && (
                                    <button
                                        onClick={() => navigate("/signup")}
                                        className="hidden items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/16 xl:flex"
                                    >
                                        <span className="h-2 w-2 rounded-full bg-warning animate-pulse" />
                                        Save this workspace
                                    </button>
                                )}

                                <div className="hidden items-center gap-4 rounded-full border border-border/70 bg-background/65 px-4 py-2 text-xs text-muted-foreground shadow-soft lg:flex">
                                    <NavLink to="/terms" className="transition-colors hover:text-primary">
                                        Terms
                                    </NavLink>
                                    <span className="h-1 w-1 rounded-full bg-border" />
                                    <NavLink to="/privacy" className="transition-colors hover:text-primary">
                                        Privacy
                                    </NavLink>
                                </div>

                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={toggleTheme}
                                    title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
                                >
                                    {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                                </Button>
                            </div>
                        </div>
                    </header>

                    <div className="flex-1 px-4 pb-8 pt-6 md:px-8 md:pb-10 md:pt-8">
                        <div
                            id="main-content"
                            className="mx-auto max-w-7xl animate-in fade-in slide-in-from-bottom-4 duration-500"
                        >
                            <Outlet />
                        </div>

                        <footer className="mx-auto mt-12 flex max-w-7xl flex-col items-center justify-between gap-4 border-t border-border/40 pt-8 text-xs text-muted-foreground sm:flex-row">
                            <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-foreground/70">MockAPI</span>
                                <span>&copy; {new Date().getFullYear()}</span>
                                <span className="hidden sm:inline">·</span>
                                <span>Built for developers</span>
                            </div>
                            <div className="flex items-center gap-6">
                                <NavLink to="/privacy" className="transition-colors hover:text-primary hover:underline">
                                    Privacy Policy
                                </NavLink>
                                <NavLink to="/terms" className="transition-colors hover:text-primary hover:underline">
                                    Terms of Service
                                </NavLink>
                                <a 
                                    href="mailto:mockurlteam@gmail.com" 
                                    className="transition-colors hover:text-primary hover:underline"
                                >
                                    Contact
                                </a>
                            </div>
                        </footer>
                    </div>
                </main>
            </div>
        </div>
    );
}

function NavItem({
    to,
    end,
    icon: Icon,
    label,
    description,
    onClick
}: {
    to: string;
    end?: boolean;
    icon: ElementType;
    label: string;
    description: string;
    onClick?: () => void;
}) {
    return (
        <NavLink
            to={to}
            end={end}
            onClick={onClick}
            className={({ isActive }) =>
                cn(
                    "group flex items-center gap-3 rounded-[1.25rem] border px-3 py-3 transition-[border-color,background-color,box-shadow,transform] duration-200",
                    isActive
                        ? "border-primary/20 bg-primary/12 text-foreground shadow-soft"
                        : "border-transparent text-muted-foreground hover:border-border/65 hover:bg-background/45 hover:text-foreground"
                )
            }
        >
            {({ isActive }) => (
                <>
                    <div
                        className={cn(
                            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-colors",
                            isActive
                                ? "border-primary/25 bg-primary/14 text-primary"
                                : "border-border/60 bg-background/55 text-muted-foreground group-hover:text-foreground"
                        )}
                    >
                        <Icon size={18} />
                    </div>
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{label}</div>
                        <div className="truncate text-xs text-muted-foreground">{description}</div>
                    </div>
                </>
            )}
        </NavLink>
    );
}
