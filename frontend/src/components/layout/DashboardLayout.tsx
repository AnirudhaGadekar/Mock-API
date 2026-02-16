
import { TeamSwitcher } from "@/components/TeamSwitcher";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    Activity,
    Database,
    Globe,
    LayoutDashboard,
    Menu,
    Network,
    Settings,
    X,
    Zap
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

export function DashboardLayout() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const location = useLocation();

    // Determine page title based on path
    const getPageTitle = (pathname: string) => {
        if (pathname === "/") return "Dashboard";
        if (pathname.startsWith("/requests")) return "Live Traffic";
        if (pathname.startsWith("/endpoints")) return "Endpoints";
        if (pathname.startsWith("/chaos")) return "Chaos Engineering";
        if (pathname.startsWith("/state")) return "State Store";
        if (pathname.startsWith("/tunnels")) return "Local Tunnels";
        if (pathname.startsWith("/settings")) return "Settings";
        if (pathname.startsWith("/team/settings")) return "Team Settings";
        return "Console";
    };

    return (
        <div className="flex min-h-screen bg-background text-foreground font-sans">
            {/* Mobile Sidebar Overlay */}
            {mobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden"
                    onClick={() => setMobileMenuOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={cn(
                "fixed md:sticky top-0 z-50 h-screen w-64 border-r border-border bg-card/95 backdrop-blur flex flex-col transition-transform duration-300 ease-in-out md:translate-x-0",
                mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                {/* Logo */}
                <div className="p-6 h-16 flex items-center border-b border-border/50">
                    <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary">
                            <Globe size={18} />
                        </div>
                        <span>MockURL</span>
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

                <div className="px-4 pt-4">
                    <TeamSwitcher />
                </div>

                {/* Navigation */}
                <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
                    <NavItem to="/" icon={LayoutDashboard} onClick={() => setMobileMenuOpen(false)}>
                        Overview
                    </NavItem>
                    <NavItem to="/requests" icon={Activity} onClick={() => setMobileMenuOpen(false)}>
                        Live Traffic
                    </NavItem>
                    <NavItem to="/endpoints" icon={Globe} onClick={() => setMobileMenuOpen(false)}>
                        Endpoints
                    </NavItem>
                    <NavItem to="/tunnels" icon={Network} onClick={() => setMobileMenuOpen(false)}>
                        Local Tunnels
                    </NavItem>
                    <NavItem to="/chaos" icon={Zap} onClick={() => setMobileMenuOpen(false)}>
                        Chaos Rules
                    </NavItem>
                    <NavItem to="/state" icon={Database} onClick={() => setMobileMenuOpen(false)}>
                        State Store
                    </NavItem>
                    <NavItem to="/settings" icon={Settings} onClick={() => setMobileMenuOpen(false)}>
                        Settings
                    </NavItem>
                </nav>

                {/* Footer/User */}
                <div className="p-4 border-t border-border/50">
                    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary/50 border border-border/50">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                            DEV
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">Developer Mode</p>
                            <p className="text-xs text-muted-foreground truncate">Local Session</p>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0">
                <header className="h-16 border-b border-border/50 flex items-center px-4 md:px-8 bg-background/80 backdrop-blur sticky top-0 z-30">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="mr-2 md:hidden"
                        onClick={() => setMobileMenuOpen(true)}
                    >
                        <Menu size={20} />
                    </Button>

                    <h1 className="text-lg font-semibold text-foreground">
                        {getPageTitle(location.pathname)}
                    </h1>

                    <div className="ml-auto flex items-center gap-2">
                        {/* Header actions can go here */}
                        <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground bg-secondary/50 px-3 py-1.5 rounded-full border border-border/50">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            System Operational
                        </div>
                    </div>
                </header>

                <div className="flex-1 p-4 md:p-8 overflow-auto">
                    <div className="mx-auto max-w-6xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <Outlet />
                    </div>
                </div>
            </main>
        </div>
    )
}

function NavItem({
    to,
    icon: Icon,
    children,
    onClick
}: {
    to: string;
    icon: React.ElementType;
    children: React.ReactNode;
    onClick?: () => void;
}) {
    return (
        <NavLink
            to={to}
            onClick={onClick}
            className={({ isActive }) => cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                isActive
                    ? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
        >
            <Icon size={18} className="shrink-0" />
            {children}
        </NavLink>
    )
}
