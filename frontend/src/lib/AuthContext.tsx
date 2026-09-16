import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { api } from "./api";
import { clearSession, getName, getRole, getToken, saveSession } from "./auth";
import type { Role } from "./types";

interface AuthState {
  isAuthenticated: boolean;
  role: Role | null;
  name: string | null;
  login: (email: string, password: string) => Promise<Role>;
  signup: (name: string, email: string, password: string, role: Role) => Promise<Role>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(getRole());
  const [name, setName] = useState<string | null>(getName());

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password);
    saveSession(res.access_token, res.role, res.name, res.user_id);
    setRole(res.role);
    setName(res.name);
    return res.role;
  };

  const signup = async (fullName: string, email: string, password: string, targetRole: Role) => {
    const res = await api.signup(fullName, email, password, targetRole);
    saveSession(res.access_token, res.role, res.name, res.user_id);
    setRole(res.role);
    setName(res.name);
    return res.role;
  };

  const logout = () => {
    clearSession();
    setRole(null);
    setName(null);
  };

  const value = useMemo(
    () => ({ isAuthenticated: Boolean(getToken()), role, name, login, signup, logout }),
    [role, name],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
