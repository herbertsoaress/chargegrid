import { Zap } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/AuthContext";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm outline-none transition-colors duration-200 focus:border-brand-red focus:ring-2 focus:ring-brand-red/20";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const role = await login(email, password);
      navigate(role === "operator" ? "/operador" : "/app");
    } catch {
      setError("E-mail ou senha invalidos");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell-bg flex min-h-screen items-center justify-center bg-navy-950 px-4 text-white">
      <Card className="w-full max-w-sm animate-fade-in-up hover:translate-y-0">
        <CardHeader className="flex-col items-start gap-1">
          <span className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg bg-brand-red/15 text-brand-red ring-1 ring-inset ring-brand-red/30">
            <Zap className="h-4.5 w-4.5" fill="currentColor" />
          </span>
          <CardTitle className="text-xl text-white">
            Charge<span className="text-brand-red">Grid</span>
          </CardTitle>
          <p className="text-xs text-white/50">Entrar na sua conta</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={onSubmit}>
            <input
              type="email"
              required
              placeholder="E-mail"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              required
              placeholder="Senha"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <p className="text-xs text-brand-red">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-white/50">
            Nao tem conta? <Link to="/signup" className="text-brand-red">Criar conta</Link>
          </p>
          <div className="mt-4 rounded-lg bg-white/5 p-3 text-[11px] text-white/40">
            Demo: operador@chargegrid.demo / motorista@chargegrid.demo -- senha chargegrid123
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
