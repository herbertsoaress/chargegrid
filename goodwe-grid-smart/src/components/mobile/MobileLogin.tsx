import { FormEvent, useState } from "react";
import { ArrowLeft, Loader2, Zap } from "lucide-react";
import { ApiError } from "@/lib/backend/client";
import { useLiveData } from "@/components/dashboard/LiveDataProvider";

export type AuthMode = "login" | "signup";

interface Props {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onDone: () => void;
  onBack: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mensagem amigavel para o motorista (o servidor devolve texto tecnico em alguns casos). */
export function authErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return "Não foi possível falar com o servidor. Tente de novo em instantes.";
    if (e.status === 422) return "Confira os dados: nome com 2+ letras, e-mail válido e senha com 6+ caracteres.";
    if (e.status === 401) return "E-mail ou senha inválidos.";
    if (e.status === 429) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Erro inesperado.";
}

export function MobileLogin({ mode, onModeChange, onDone, onBack }: Props) {
  const { backend, login, signup, loginDemo } = useLiveData();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";
  const connecting = backend.status === "connecting";
  const offline = backend.status === "error";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isSignup && name.trim().length < 2) return setError("Informe seu nome.");
    if (!EMAIL_RE.test(email.trim())) return setError("Informe um e-mail válido.");
    if (password.length < 6) return setError("A senha precisa ter pelo menos 6 caracteres.");
    setBusy(true);
    try {
      if (isSignup) await signup(name, email, password);
      else await login("driver", email, password);
      onDone();
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
      await loginDemo("driver");
      onDone();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full bg-muted/60 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition";

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-goodwe-dark via-goodwe-dark to-goodwe-red/20 px-5 pt-4 pb-5 overflow-y-auto">
      <button onClick={onBack} aria-label="Voltar" className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <ArrowLeft className="w-4 h-4 text-foreground" />
      </button>

      <div className="flex flex-col items-center gap-2 mt-4 mb-5">
        <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center glow-red">
          <Zap className="w-7 h-7 text-primary-foreground" />
        </div>
        <h2 className="text-lg font-bold text-foreground">{isSignup ? "Criar conta" : "Entrar"}</h2>
        <p className="text-[10px] text-muted-foreground text-center">
          {isSignup ? "Cadastre-se para gravar suas recargas e comprovantes." : "Use o e-mail e a senha da sua conta ChargeGrid."}
        </p>
      </div>

      {offline && (
        <div className="mb-3 rounded-xl border border-goodwe-orange/30 bg-goodwe-orange/10 p-3 text-[10px] text-goodwe-orange" role="status">
          Servidor indisponível. Você pode continuar em <strong>modo simulado</strong> (nada é gravado).
        </div>
      )}
      {connecting && <p className="mb-3 text-[10px] text-muted-foreground text-center">Conectando ao servidor…</p>}

      <form onSubmit={submit} className="space-y-3" noValidate>
        {isSignup && (
          <label className="block">
            <span className="text-[10px] text-muted-foreground">Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Seu nome"
              className={`${inputCls} mt-1`}
              disabled={busy || offline}
            />
          </label>
        )}
        <label className="block">
          <span className="text-[10px] text-muted-foreground">E-mail</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="voce@email.com"
            className={`${inputCls} mt-1`}
            disabled={busy || offline}
          />
        </label>
        <label className="block">
          <span className="text-[10px] text-muted-foreground">Senha</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? "new-password" : "current-password"}
            placeholder="Mínimo 6 caracteres"
            className={`${inputCls} mt-1`}
            disabled={busy || offline}
          />
        </label>

        {error && (
          <p role="alert" className="text-[11px] text-primary bg-primary/10 border border-primary/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || connecting || offline}
          className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm glow-red flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {isSignup ? "Criar conta e entrar" : "Entrar"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => onModeChange(isSignup ? "login" : "signup")}
        className="mt-3 text-[11px] text-goodwe-blue hover:underline self-center"
      >
        {isSignup ? "Já tenho conta — entrar" : "Não tenho conta — criar agora"}
      </button>

      {backend.demoLogin && !offline && (
        <button
          type="button"
          onClick={demo}
          disabled={busy}
          className="mt-4 w-full py-2.5 rounded-xl border border-white/10 text-[11px] text-muted-foreground hover:bg-white/5 transition disabled:opacity-50"
        >
          Entrar como demonstração
        </button>
      )}

      {offline && (
        <button
          type="button"
          onClick={onDone}
          className="mt-4 w-full py-2.5 rounded-xl border border-white/10 text-[11px] text-foreground hover:bg-white/5 transition"
        >
          Continuar em modo simulado
        </button>
      )}
    </div>
  );
}
