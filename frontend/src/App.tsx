
import { AuthModal } from "@/components/AuthModal";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ThemeProvider } from "@/contexts/ThemeContext";
import AuthCallback from "@/pages/AuthCallback";
import AuthError from "@/pages/AuthError";
import Chaos from "@/pages/Chaos";
import Dashboard from "@/pages/Dashboard";
import EndpointConfig from "@/pages/EndpointConfig";
import Endpoints from "@/pages/Endpoints";
import Requests from "@/pages/Requests";
import Settings from "@/pages/Settings";
import StateStore from "@/pages/StateStore";
import TeamSettings from "@/pages/TeamSettings";
import TunnelDashboard from "@/pages/TunnelDashboard";
import { Toaster } from "react-hot-toast";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

export default function App() {
    return (
        <ThemeProvider>
            <BrowserRouter>
                <Toaster
                    position="bottom-right"
                    toastOptions={{
                        style: {
                            background: '#0f172a',
                            color: '#fff',
                            border: '1px solid #1e293b'
                        }
                    }}
                />
                {/* Global Auth Modal — triggered via useAuth().showAuthModal() */}
                <AuthModal />
                <Routes>
                    {/* OAuth callback — no sidebar/layout */}
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route path="/auth/error" element={<AuthError />} />

                    <Route path="/" element={<DashboardLayout />}>
                        <Route index element={<Dashboard />} />
                        <Route path="endpoints" element={<Endpoints />} />
                        <Route path="requests" element={<Requests />} />
                        <Route path="chaos" element={<Chaos />} />
                        <Route path="state" element={<StateStore />} />
                        <Route path="tunnels" element={<TunnelDashboard />} />
                        <Route path="team/settings" element={<TeamSettings />} />
                        <Route path="endpoints/:id" element={<EndpointConfig />} />
                        <Route path="settings" element={<Settings />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Route>
                </Routes>
            </BrowserRouter>
        </ThemeProvider>
    );
}
