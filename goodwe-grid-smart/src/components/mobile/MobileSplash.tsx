import { Zap } from "lucide-react";

interface Props {
  onLogin: () => void;
  onSignup: () => void;
}

export function MobileSplash({ onLogin, onSignup }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-gradient-to-b from-goodwe-dark via-goodwe-dark to-goodwe-red/20 p-6">
      <div className="flex flex-col items-center gap-6 fade-in">
        <div className="w-20 h-20 rounded-2xl bg-primary flex items-center justify-center glow-red">
          <Zap className="w-10 h-10 text-primary-foreground" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">GoodWe</h1>
          <p className="text-sm text-goodwe-blue font-medium tracking-widest uppercase mt-1">ChargeGrid</p>
        </div>
        <p className="text-muted-foreground text-xs text-center mt-4">
          Recarga inteligente para veículos elétricos
        </p>
      </div>
      <button
        onClick={onLogin}
        className="mt-16 w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all glow-red"
      >
        Entrar
      </button>
      <button
        onClick={onSignup}
        className="mt-3 w-full py-3.5 rounded-xl border border-white/10 text-foreground font-medium text-sm hover:bg-white/5 transition-all"
      >
        Criar conta
      </button>
    </div>
  );
}
