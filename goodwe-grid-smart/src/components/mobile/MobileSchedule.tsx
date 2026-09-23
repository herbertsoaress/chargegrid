import { CheckCircle2, Sun, TrendingDown, Zap } from "lucide-react";
import type { ApiSchedule } from "@/lib/backend/types";

interface Props {
  schedule: ApiSchedule;
}

// Cor de cada bloco no "trilho" do plano, conforme o motivo escolhido pelo agendamento.
const REASON_CLS: Record<string, string> = {
  solar: "bg-goodwe-orange",
  preco_baixo: "bg-goodwe-blue",
  meta_em_risco: "bg-primary",
  pico_evitado: "bg-white/10",
  ocioso: "bg-white/5",
};

const REASON_LABEL: Record<string, string> = {
  solar: "Solar",
  preco_baixo: "Preço baixo",
  meta_em_risco: "Meta em risco (potência máxima)",
  pico_evitado: "Pico evitado",
  ocioso: "Sem carga",
};

/** Plano do Energy Autopilot: os "degraus" de potência decididos até o horário de saída, com os
 * selos do resultado. Extensão aprovada pelo grupo -- ver docs/ENERGY_AUTOPILOT.md. */
export function MobileSchedule({ schedule }: Props) {
  if (!schedule.has_plan) return null;

  const departureLabel = schedule.departure
    ? new Date(schedule.departure).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "--";

  return (
    <div className="glass-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-primary" /> Energy Autopilot
        </h3>
        <span className="text-[9px] text-muted-foreground">saída {departureLabel}</span>
      </div>

      <div className="flex w-full h-3 rounded-full overflow-hidden bg-black/30" title="Plano de potência por bloco de 15 min">
        {schedule.blocks.map((b, i) => (
          <div key={i} className={`flex-1 ${REASON_CLS[b.reason] ?? "bg-white/5"}`} title={`${REASON_LABEL[b.reason]} · ${b.charging ? "carregando" : "parado"}`} />
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full border flex items-center gap-1 ${schedule.on_track ? "border-goodwe-green/40 text-goodwe-green" : "border-primary/40 text-primary"}`}>
          <CheckCircle2 className="w-2.5 h-2.5" /> {schedule.on_track ? "Meta garantida" : "Meta em risco"}
        </span>
        {schedule.peak_avoided && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-goodwe-blue/40 text-goodwe-blue flex items-center gap-1">
            <TrendingDown className="w-2.5 h-2.5" /> Pico evitado
          </span>
        )}
        {(schedule.solar_kwh ?? 0) > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-goodwe-orange/40 text-goodwe-orange flex items-center gap-1">
            <Sun className="w-2.5 h-2.5" /> {schedule.solar_kwh?.toFixed(1)} kWh solar
          </span>
        )}
        {(schedule.idle_savings_rs ?? 0) > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-goodwe-green/40 text-goodwe-green">
            R$ {schedule.idle_savings_rs?.toFixed(2).replace(".", ",")} de ociosidade evitada
          </span>
        )}
      </div>
      <p className="text-[9px] text-muted-foreground">
        Plano simulado: potência do carregador ao longo da sessão, considerando preço previsto e sobra de energia solar (também simulada).
      </p>
    </div>
  );
}
