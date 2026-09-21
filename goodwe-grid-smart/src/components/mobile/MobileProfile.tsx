import { FormEvent, useState } from "react";
import { ArrowLeft, CreditCard, LogOut, Loader2, Smartphone, Trash2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/backend/client";
import { useLiveData } from "@/components/dashboard/LiveDataProvider";

interface Props {
  onBack: () => void;
  onNavigate: (screen: string) => void;
  onLogout: () => void;
}

// Persona do modo simulado (sem servidor): mesma dos dados de exemplo do dashboard.
const LOCAL_USER = { name: "João Silva", email: "joao.silva@email.com" };
const PLATE_RE = /^[A-Za-z0-9-]{5,10}$/;

function vehicleError(e: unknown): string {
  if (e instanceof ApiError) return e.status === 422 ? "Confira modelo e placa (ex.: ABC1D23)." : e.message;
  return e instanceof Error ? e.message : "Erro inesperado.";
}

export function MobileProfile({ onBack, onNavigate, onLogout }: Props) {
  const { backend, vehicles, addVehicle, removeVehicle, logout } = useLiveData();
  const user = backend.driver;
  const name = user?.name ?? LOCAL_USER.name;
  const email = user?.email ?? LOCAL_USER.email;

  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitVehicle = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (model.trim().length < 2) return setError("Informe o modelo do veículo.");
    if (!PLATE_RE.test(plate.trim())) return setError("Placa inválida (ex.: ABC1D23).");
    setBusy(true);
    try {
      await addVehicle(plate, model);
      setModel("");
      setPlate("");
      toast.success("Veículo cadastrado");
    } catch (err) {
      setError(vehicleError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await removeVehicle(id);
      toast.success("Veículo removido");
    } catch (err) {
      toast.error("Não foi possível remover", { description: vehicleError(err) });
    }
  };

  const signOut = () => {
    logout("driver");
    onLogout();
  };

  const inputCls =
    "w-full bg-muted/60 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition";

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        <button onClick={onBack} aria-label="Voltar" className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </button>
        <h2 className="text-base font-bold text-foreground">Perfil</h2>
      </div>

      <div className="flex-1 px-4 space-y-3 pb-4 overflow-y-auto">
        <div className="glass-card-glow p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <span className="text-lg font-bold text-primary">{name.charAt(0).toUpperCase()}</span>
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{name}</h3>
            <p className="text-[10px] text-muted-foreground truncate">{email}</p>
            {!user && <p className="text-[9px] text-goodwe-orange mt-0.5">Conta de exemplo (modo simulado)</p>}
          </div>
        </div>

        <div className="glass-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Meus veículos</h3>
          {user ? (
            <>
              {vehicles.length === 0 && <p className="text-[11px] text-muted-foreground mb-2">Nenhum veículo cadastrado ainda.</p>}
              <ul className="space-y-2 mb-3">
                {vehicles.map((v) => (
                  <li key={v.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{v.model}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{v.plate}</p>
                    </div>
                    <button
                      onClick={() => remove(v.id)}
                      aria-label={`Remover ${v.model}`}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-white/5 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              <form onSubmit={submitVehicle} className="space-y-2" noValidate>
                <div className="grid grid-cols-5 gap-2">
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Modelo (ex.: BYD Dolphin)"
                    aria-label="Modelo do veículo"
                    className={`${inputCls} col-span-3`}
                    disabled={busy}
                  />
                  <input
                    value={plate}
                    onChange={(e) => setPlate(e.target.value.toUpperCase())}
                    placeholder="Placa"
                    aria-label="Placa"
                    maxLength={10}
                    className={`${inputCls} col-span-2 font-mono`}
                    disabled={busy}
                  />
                </div>
                {error && (
                  <p role="alert" className="text-[10px] text-primary">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-2 rounded-lg bg-primary/15 border border-primary/30 text-primary text-[11px] font-semibold hover:bg-primary/25 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {busy && <Loader2 className="w-3 h-3 animate-spin" />} Adicionar veículo
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-foreground">BYD Dolphin Mini</p>
              <p className="text-[10px] text-muted-foreground">Exemplo do modo simulado. Entre com uma conta para cadastrar o seu.</p>
            </>
          )}
        </div>

        <div className="glass-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Pagamento</h3>
          <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
            <Smartphone className="w-4 h-4 text-goodwe-blue" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-foreground">PIX (ambiente de teste)</p>
              <p className="text-[10px] text-muted-foreground">Pagamento simulado: nenhuma cobrança real é feita.</p>
            </div>
            <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full">Padrão</span>
          </div>
        </div>

        <div className="glass-card overflow-hidden">
          <button
            onClick={() => onNavigate("pricing")}
            className="w-full flex items-center gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-all"
          >
            <CreditCard className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-foreground flex-1 text-left">Tarifas</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
          <button onClick={signOut} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-all">
            <LogOut className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-foreground flex-1 text-left">Sair</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}
