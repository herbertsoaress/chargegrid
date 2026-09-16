import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "@/lib/AuthContext";
import type { Role } from "@/lib/types";

export function ProtectedRoute({ role, children }: { role: Role; children: ReactNode }) {
  const { isAuthenticated, role: currentRole } = useAuth();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (currentRole !== role) {
    return <Navigate to={currentRole === "operator" ? "/operador" : "/app"} replace />;
  }
  return <>{children}</>;
}
