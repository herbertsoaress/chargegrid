import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";

import { ProtectedRoute } from "@/components/shared/ProtectedRoute";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { Login } from "@/pages/auth/Login";
import { Signup } from "@/pages/auth/Signup";
import { DriverLayout } from "@/pages/driver/DriverLayout";
import { History } from "@/pages/driver/History";
import { LiveSession } from "@/pages/driver/LiveSession";
import { StationList } from "@/pages/driver/StationList";
import { AIAssistant } from "@/pages/operator/AIAssistant";
import { Balancing } from "@/pages/operator/Balancing";
import { Billing } from "@/pages/operator/Billing";
import { Dashboard } from "@/pages/operator/Dashboard";
import { EngineeringForecast } from "@/pages/operator/EngineeringForecast";
import { EngineeringOcppLogs } from "@/pages/operator/EngineeringOcppLogs";
import { EngineeringSimulator } from "@/pages/operator/EngineeringSimulator";
import { OperatorLayout } from "@/pages/operator/OperatorLayout";
import { Stations } from "@/pages/operator/Stations";
import { UsersFleets } from "@/pages/operator/UsersFleets";

function RootRedirect() {
  const { isAuthenticated, role } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to={role === "operator" ? "/operador" : "/app"} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      <Route
        path="/operador"
        element={
          <ProtectedRoute role="operator">
            <OperatorLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="balanceamento" element={<Balancing />} />
        <Route path="estacoes" element={<Stations />} />
        <Route path="assistente-ia" element={<AIAssistant />} />
        <Route path="engenharia/logs-ocpp" element={<EngineeringOcppLogs />} />
        <Route path="engenharia/ia-previsao" element={<EngineeringForecast />} />
        <Route path="engenharia/simulador" element={<EngineeringSimulator />} />
        <Route path="comercial/faturamento" element={<Billing />} />
        <Route path="comercial/usuarios-frotas" element={<UsersFleets />} />
      </Route>

      <Route
        path="/app"
        element={
          <ProtectedRoute role="driver">
            <DriverLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<StationList />} />
        <Route path="sessao/:id" element={<LiveSession />} />
        <Route path="historico" element={<History />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
