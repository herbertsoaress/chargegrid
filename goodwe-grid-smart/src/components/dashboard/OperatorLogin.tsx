import { FormEvent, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { authErrorMessage } from "@/components/mobile/MobileLogin";
import { useLiveData } from "./LiveDataProvider";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Tela de acesso do Console do Operador (aparece quando o backend esta ligado e ninguem entrou). */
export function OperatorLogin() {
  const { backend, login, loginDemo } = useLiveData();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const connecting = backend.status === "connecting";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email.trim())) return setError("Informe um e-mail válido.");
    if (!password) return setError("Informe a senha.");
    setBusy(true);
    try {
      await login("operator", email, password);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const demo = async () => {
    setError(null);
    setBusy(true);
    try {
      await loginDemo("operator");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full bg-muted/60 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition";

  return (
    <div className="h-full flex items-center justify-center bg-background grid-bg p-6">
      <div className="glass-card-glow w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center glow-red">
            <ShieldCheck className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">Console do Operador</h2>
            <p className="text-[10px] text-muted-foreground">Acesso restrito a operadores da rede</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3" noValidate>
          <label className="block">
            <span className="text-[10px] text-muted-foreground">E-mail</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              placeholder="operador@empresa.com"
              className={`${inputCls} mt-1`}
              disabled={busy}
            />
          </label>
          <label className="block">
            <span className="text-[10px] text-muted-foreground">Senha</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className={`${inputCls} mt-1`}
              disabled={busy}
            />
          </label>
          {error && (
            <p role="alert" className="text-[11px] text-primary bg-primary/10 border border-primary/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || connecting}
            className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-xs glow-red flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {(busy || connecting) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {connecting ? "Conectando à API…" : "Entrar no console"}
          </button>
        </form>

        {backend.demoLogin && (
          <button
            type="button"
            onClick={demo}
            disabled={busy}
            className="w-full py-2 rounded-xl border border-white/10 text-[11px] text-muted-foreground hover:bg-white/5 transition disabled:opacity-50"
          >
            Entrar como demonstração
          </button>
        )}
        <p className="text-[9px] text-muted-foreground/70 leading-relaxed">
          Contas de operador são definidas pelo administrador do sistema. Cadastros feitos no app criam apenas contas de motorista.
        </p>
      </div>
    </div>
  );
}
