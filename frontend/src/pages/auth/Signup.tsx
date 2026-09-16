import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/AuthContext";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("driver");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resultRole = await signup(name, email, password, role);
      navigate(resultRole === "operator" ? "/operador" : "/app");
    } catch {
      setError("Nao foi possivel criar a conta (e-mail ja cadastrado?)");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4 text-white">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex-col items-start gap-1">
          <CardTitle className="text-xl text-white">
            Charge<span className="text-brand-red">Grid</span>
          </CardTitle>
          <p className="text-xs text-white/50">Criar conta</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={onSubmit}>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm",
                  role === "driver" ? "border-brand-red bg-brand-red/10" : "border-white/10 text-white/60",
                )}
                onClick={() => setRole("driver")}
              >
                Motorista
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm",
                  role === "operator" ? "border-brand-red bg-brand-red/10" : "border-white/10 text-white/60",
                )}
                onClick={() => setRole("operator")}
              >
                Operador
              </button>
            </div>
            <input
              required
              placeholder="Nome completo"
              className="w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm outline-none focus:border-brand-red"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              type="email"
              required
              placeholder="E-mail"
              className="w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm outline-none focus:border-brand-red"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              required
              placeholder="Senha"
              className="w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm outline-none focus:border-brand-red"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <p className="text-xs text-brand-red">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Criando..." : "Criar conta"}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-white/50">
            Ja tem conta? <Link to="/login" className="text-brand-red">Entrar</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
