import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AppLayout } from "@/app/layout/AppLayout";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { ChannelsPage } from "@/features/channels/ChannelsPage";
import { ChannelDetailPage } from "@/features/channels/ChannelDetailPage";
import { MarketPage } from "@/features/market/MarketPage";
import { ModelsPage } from "@/features/models/ModelsPage";
import { TestingPage } from "@/features/testing/TestingPage";
import { RequestsPage } from "@/features/requests/RequestsPage";
import { RequestDetailPage } from "@/features/requests/RequestDetailPage";
import { SettingsPage } from "@/features/settings/SettingsPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/channels" element={<ChannelsPage />} />
              <Route path="/channels/:id" element={<ChannelDetailPage />} />
              <Route path="/models" element={<ModelsPage />} />
              <Route path="/market" element={<MarketPage />} />
              <Route path="/testing" element={<Navigate to="/testing/api" replace />} />
              <Route path="/testing/:tab" element={<TestingPage />} />
              <Route path="/requests" element={<RequestsPage />} />
              <Route path="/requests/:traceId" element={<RequestDetailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster />
      </QueryClientProvider>
    </StrictMode>
  );
}
