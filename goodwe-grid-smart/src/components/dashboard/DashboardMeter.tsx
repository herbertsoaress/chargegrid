import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { backend as api } from "@/lib/backend/client";
import type { ApiMeter } from "@/lib/backend/types";
import { useLiveData } from "./LiveDataProvider";

const fmt = (v: number | undefined, digits = 1) => (v === undefined ? "—" : v.toFixed(digits).replace(".", ","));

/**
 * Leitura do medidor de energia do local por MODBUS TCP. Hoje o medidor e SIMULADO pelo backend
 * (MODBUS_SIMULATOR=true); com um medidor fisico so muda o endereco. So aparece com backend + operador logado.
 */
export function DashboardMeter() {
  const { backend } = useLiveData();
  const token = backend.operatorToken;
  const [meter, setMeter] = useState<ApiMeter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    if (backend.status !== "online" || !token) return;
    let cancelled = false;
    const load = async () => {
      try {
        const m = await api.meter(token);
        if (!cancelled) {
          setMeter(m);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "erro");
      }
    };
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [backend.status, token]);

  if (backend.status !== "online" || !token) return null;

  const r = meter?.reading ?? undefined;
  const avg = (a?: number, b?: number, c?: number) =>
    a === undefined || b === undefined || c === undefined ? undefined : (a + b + c) / 3;

  return (
    <div className="glass-card card-hover p-4" data-testid="meter-card">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Gauge className="w-4 h-4 text-goodwe-blue" />
        <h3 className="text-sm font-semibold text-foreground">Medidor de energia do local — MODBUS TCP</h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full border bg-goodwe-orange/15 text-goodwe-orange border-goodwe-orange/30">
          Simulado
        </span>
        {meter && (
          <span className="ml-auto text-[10px] font-mono text-muted-foreground">
            {meter.host}:{meter.port} · unit {meter.unit_id}
            {meter.age_s !== null && meter.fresh ? ` · lido há ${Math.round(meter.age_s)} s` : ""}
          </span>
        )}
      </div>

      {error && <p className="text-[11px] text-goodwe-orange">Não foi possível ler o medidor: {error}</p>}

      {meter && !meter.enabled && (
        <p className="text-[11px] text-muted-foreground">
          Medidor virtual desligado (<span className="font-mono">MODBUS_SIMULATOR=false</span> no backend). O balanceamento usa o
          cenário de referência para a carga do prédio.
        </p>
      )}

      {meter?.enabled && !meter.fresh && (
        <p className="text-[11px] text-muted-foreground">
          Aguardando leitura do medidor…{meter.error ? ` (${meter.error})` : ""}
        </p>
      )}

      {meter?.enabled && meter.fresh && r && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {[
              { label: "Potência ativa total", value: `${fmt(r.active_power_w / 1000)} kW` },
              { label: "Tensão média", value: `${fmt(avg(r.voltage_l1_v, r.voltage_l2_v, r.voltage_l3_v))} V` },
              { label: "Corrente média", value: `${fmt(avg(r.current_l1_a, r.current_l2_a, r.current_l3_a), 0)} A` },
              { label: "Frequência", value: `${fmt(r.frequency_hz, 2)} Hz` },
              { label: "Energia importada", value: `${fmt(r.import_energy_kwh, 0)} kWh` },
            ].map((tile) => (
              <div key={tile.label} className="rounded-lg bg-black/30 border border-white/5 p-2.5">
                <p className="text-sm font-bold text-foreground tabular-nums">{tile.value}</p>
                <p className="text-[10px] text-muted-foreground">{tile.label}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Este valor é o total do local (prédio + carros) e alimenta o balanceamento no lugar do valor fixo de referência.
          </p>
        </>
      )}

      {meter && (
        <div className="mt-2">
          <button onClick={() => setShowMap((v) => !v)} className="text-[10px] text-goodwe-blue hover:underline">
            {showMap ? "Ocultar" : "Ver"} mapa de registradores (assumido)
          </button>
          {showMap && (
            <table className="mt-2 w-full text-[10px] font-mono">
              <thead>
                <tr className="text-muted-foreground border-b border-white/5">
                  <th className="text-left py-1">Endereço</th>
                  <th className="text-left py-1">Grandeza</th>
                  <th className="text-left py-1">Unidade</th>
                  <th className="text-right py-1">Valor lido</th>
                </tr>
              </thead>
              <tbody>
                {meter.register_map.map((row) => (
                  <tr key={row.address} className="border-b border-white/5">
                    <td className="py-1 text-muted-foreground">{row.address}–{row.address + 1}</td>
                    <td className="py-1 text-foreground">{row.name}</td>
                    <td className="py-1 text-muted-foreground">{row.unit}</td>
                    <td className="py-1 text-right tabular-nums">{fmt(r?.[row.name], 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
