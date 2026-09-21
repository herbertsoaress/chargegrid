import { useEffect, useState } from "react";
import { Database, Plug, Receipt, ScrollText, ShieldCheck } from "lucide-react";
import { backend as api } from "@/lib/backend/client";
import { describeEvent, formatBrl, parseUtc } from "@/lib/backend/mappers";
import type {
  ApiEvent,
  ApiGoodWeDevice,
  ApiGoodWePlant,
  ApiGoodWeStatus,
  ApiHealth,
  ApiIntegrationLog,
  ApiInvoice,
} from "@/lib/backend/types";
import { useLiveData } from "./LiveDataProvider";

interface Snapshot {
  health: ApiHealth | null;
  goodwe: ApiGoodWeStatus | null;
  plants: ApiGoodWePlant[];
  devices: ApiGoodWeDevice[];
  logs: ApiIntegrationLog[];
  events: ApiEvent[];
  invoices: ApiInvoice[];
}

const EMPTY: Snapshot = { health: null, goodwe: null, plants: [], devices: [], logs: [], events: [], invoices: [] };

const time = (iso: string) => parseUtc(iso).toLocaleTimeString("pt-BR", { hour12: false });

function OrigemBadge({ origem }: { origem: "simulado" | "real" }) {
  return origem === "real" ? (
    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-goodwe-green/15 text-goodwe-green border-goodwe-green/30">
      GoodWe real
    </span>
  ) : (
    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-goodwe-orange/15 text-goodwe-orange border-goodwe-orange/30">
      Dados simulados
    </span>
  );
}

/**
 * Mostra o que vem do backend (FastAPI + Supabase) no console do operador.
 * `only="invoices"` (aba Faturamento) mostra so os comprovantes; `only="integration"`
 * (aba Logs OCPP) mostra saude do banco, GoodWe, eventos e auditoria.
 */
export function DashboardBackend({ only }: { only: "invoices" | "integration" }) {
  const { backend } = useLiveData();
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const token = backend.operatorToken;

  useEffect(() => {
    if (backend.status !== "online" || !token) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [health, goodwe, plants, devices, logs, events, invoices] = await Promise.all([
          api.health(),
          api.goodweStatus(),
          api.goodwePlants(token),
          api.goodweDevices(token),
          api.integrationLogs(token),
          api.events(token),
          api.invoices(token),
        ]);
        if (!cancelled) {
          setData({ health, goodwe, plants, devices, logs, events, invoices });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "erro ao consultar a API");
      }
    };
    load();
    const timer = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [backend.status, token]);

  if (!backend.enabled) {
    return (
      <div className="glass-card p-4 border-goodwe-orange/30">
        <div className="flex items-center gap-2 mb-1">
          <Database className="w-4 h-4 text-goodwe-orange" />
          <h3 className="text-sm font-semibold text-foreground">Backend desativado — simulação local</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Sessões, comprovantes e eventos não estão sendo gravados. Para ligar o banco (Supabase), defina{" "}
          <span className="font-mono text-foreground">VITE_API_URL</span> no arquivo{" "}
          <span className="font-mono text-foreground">.env</span> e reinicie o <span className="font-mono">npm run dev</span>{" "}
          (passo a passo no GUIA_DO_PROJETO.md).
        </p>
      </div>
    );
  }

  if (backend.status !== "online") {
    return (
      <div className="glass-card p-4">
        <p className="text-xs text-muted-foreground">
          {backend.status === "connecting"
            ? "Conectando à API…"
            : `API indisponível: ${backend.error ?? "erro desconhecido"}. O app segue em simulação local.`}
        </p>
      </div>
    );
  }

  const invoicesCard = (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Receipt className="w-4 h-4 text-goodwe-green" />
        <h3 className="text-sm font-semibold text-foreground">Comprovantes gravados no banco</h3>
        <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full border border-goodwe-orange/30 bg-goodwe-orange/10 text-goodwe-orange">
          pagamento sandbox
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-white/5">
              <th className="text-left py-2 font-medium">Comprovante</th>
              <th className="text-left py-2 font-medium">Cliente</th>
              <th className="text-left py-2 font-medium">Carregador</th>
              <th className="text-left py-2 font-medium">Energia</th>
              <th className="text-left py-2 font-medium">R$/kWh</th>
              <th className="text-left py-2 font-medium">Total</th>
              <th className="text-left py-2 font-medium">Método</th>
            </tr>
          </thead>
          <tbody>
            {data.invoices.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-muted-foreground">
                  Nenhum comprovante ainda. Finalize uma recarga pelo app para gerar o primeiro.
                </td>
              </tr>
            )}
            {data.invoices.map((inv) => (
              <tr key={inv.receipt_number} className="border-b border-white/5">
                <td className="py-2 font-mono text-foreground">{inv.receipt_number}</td>
                <td className="py-2 text-muted-foreground">{inv.user_name}</td>
                <td className="py-2 font-mono text-muted-foreground">{inv.charger_code}</td>
                <td className="py-2 tabular-nums text-goodwe-blue">{inv.energy_kwh.toFixed(2)} kWh</td>
                <td className="py-2 tabular-nums text-muted-foreground">{formatBrl(inv.price_per_kwh)}</td>
                <td className="py-2 tabular-nums font-semibold text-goodwe-green">{formatBrl(inv.amount)}</td>
                <td className="py-2 uppercase text-muted-foreground">{inv.method}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (only === "invoices") return invoicesCard;

  return (
    <div className="space-y-4">
      {error && <p className="text-[11px] text-goodwe-orange">Falha ao atualizar: {error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Database className="w-4 h-4 text-goodwe-blue" />
            <h3 className="text-sm font-semibold text-foreground">Banco de dados &amp; API</h3>
            <span
              className={`ml-auto text-[10px] px-2 py-0.5 rounded-full border ${
                data.health?.database.ok
                  ? "bg-goodwe-green/15 text-goodwe-green border-goodwe-green/30"
                  : "bg-primary/15 text-primary border-primary/30"
              }`}
            >
              {data.health?.database.ok ? "banco acessível" : "banco com problema"}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Motor</dt>
            <dd className="text-foreground font-mono">
              {data.health?.database.engine === "postgresql" ? "PostgreSQL" : data.health?.database.engine ?? "—"}
            </dd>
            <dt className="text-muted-foreground">Ambiente</dt>
            <dd className="text-foreground font-mono">{data.health?.env ?? "—"}</dd>
            <dt className="text-muted-foreground">Versão da API</dt>
            <dd className="text-foreground font-mono">{data.health?.version ?? "—"}</dd>
          </dl>
          <p className="mt-3 flex items-start gap-1.5 text-[10px] text-muted-foreground">
            <ShieldCheck className="w-3 h-3 mt-px shrink-0 text-goodwe-green" />
            Credenciais e tokens da GoodWe ficam só no backend; este console nunca as recebe.
          </p>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Plug className="w-4 h-4 text-goodwe-orange" />
            <h3 className="text-sm font-semibold text-foreground">Integração GoodWe (SEMS+)</h3>
            {data.goodwe && (
              <span className="ml-auto">
                <OrigemBadge origem={data.goodwe.origem} />
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">
            Somente leitura. {data.goodwe?.origem === "simulado" ? "Aguardando credenciais da FIAP/GoodWe." : "Conectado à GoodWe OpenAPI."}
          </p>
          <ul className="space-y-1.5 text-xs">
            {data.plants.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span className="text-foreground">{p.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {p.capacity_kw} kW · {p.status}
                </span>
              </li>
            ))}
            {data.devices.map((d) => (
              <li key={d.id} className="flex justify-between gap-2 text-muted-foreground">
                <span>
                  {d.type} <span className="text-[10px]">({d.category})</span>
                </span>
                <span className="font-mono text-[10px]">
                  {d.serial_masked} · {d.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {invoicesCard}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <ScrollText className="w-4 h-4 text-goodwe-blue" />
            <h3 className="text-sm font-semibold text-foreground">Eventos de sessão persistidos</h3>
          </div>
          <ul className="space-y-1 font-mono text-[11px]">
            {data.events.length === 0 && <li className="text-muted-foreground">Nenhum evento gravado ainda.</li>}
            {data.events.map((e) => (
              <li key={e.id} className="flex gap-2">
                <span className="text-muted-foreground/60 shrink-0">{time(e.created_at)}</span>
                <span className="text-goodwe-blue shrink-0">{e.charger_code}</span>
                <span className="text-foreground/90 truncate">
                  #{e.session_id} {describeEvent(e)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4 text-goodwe-orange" />
            <h3 className="text-sm font-semibold text-foreground">Auditoria de integrações</h3>
          </div>
          <ul className="space-y-1 font-mono text-[11px]">
            {data.logs.length === 0 && <li className="text-muted-foreground">Sem registros (nenhum erro nem ação registrada).</li>}
            {data.logs.map((l) => (
              <li key={l.id} className="flex gap-2">
                <span className="text-muted-foreground/60 shrink-0">{time(l.created_at)}</span>
                <span className={`shrink-0 ${l.level === "ERR" ? "text-primary" : "text-goodwe-orange"}`}>[{l.level}]</span>
                <span className="text-foreground/90">{l.message}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
