import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { initSession } from "@/lib/api";
import Chaos from "@/pages/Chaos";
import Dashboard from "@/pages/Dashboard";
import EndpointConfig from "@/pages/EndpointConfig";
import Endpoints from "@/pages/Endpoints";
import Requests from "@/pages/Requests";
import Settings from "@/pages/Settings";
import StateStore from "@/pages/StateStore";
import { useEffect } from "react";
import { Toaster } from "react-hot-toast";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

export default function App() {
    // Initialize session on mount
    useEffect(() => {
        initSession().catch(console.error);
    }, []);

    return (
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
            <Routes>
                <Route path="/" element={<DashboardLayout />}>
                    <Route index element={<Dashboard />} />
                    <Route path="endpoints" element={<Endpoints />} />
                    <Route path="requests" element={<Requests />} />
                    <Route path="chaos" element={<Chaos />} />
                    <Route path="state" element={<StateStore />} />
                    <Route path="endpoints/:id" element={<EndpointConfig />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}
