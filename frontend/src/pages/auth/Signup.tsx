import { Zap } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/AuthContext";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm outline-none transition-colors duration-200 focus:border-brand-red focus:ring-2 focus:ring-brand-red/20";

export function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resultRole = await signup(name, email, password, "driver");
      navigate(resultRole === "operator" ? "/operador" : "/app");
    } catch {
      setError("Nao foi possivel criar a conta (e-mail ja cadastrado?)");
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
          <p className="text-xs text-white/50">Criar conta</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={onSubmit}>
            <input
              required
              placeholder="Nome completo"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
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
