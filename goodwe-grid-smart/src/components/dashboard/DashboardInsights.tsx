import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Brain, CheckCircle2, Clock, Download, Lightbulb, RefreshCw, TrendingUp } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine,
} from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { tariffsCsvUrl } from "@/lib/backend/client";
import {
  CONTRACTED_KW, IDLE_GRACE_MIN, IDLE_RATE_PER_MIN, MODE_POWER_FACTOR, MODE_SURCHARGE_PER_KWH,
  PRICE_CAP_PER_KWH, TIME_RATE_PER_MIN, WEEKDAY_NAMES, hourlyForecast, type Band, type ForecastPointView,
} from "@/lib/pricing";
import { useLiveData } from "./LiveDataProvider";

const BAND_LABEL: Record<Band, string> = { "fora de ponta": "Fora de ponta", intermediaria: "Intermediária", ponta: "Ponta" };
const BAND_COLOR: Record<Band, string> = { "fora de ponta": "#22c55e", intermediaria: "#FF7759", ponta: "#E60012" };
const MODE_LABEL: Record<keyof typeof MODE_SURCHARGE_PER_KWH, string> = {
  eco: "Econômico", sustentavel: "Sustentável", garantido: "Garantido", rapido: "Rápido",
};
const TOOLTIP_STYLE = { background: "#1F1F1F", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 };

const hh = (h: number) => `${String(h).padStart(2, "0")}h`;
const brl = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Faixas do dia agrupadas: horas, preco medio, energia e receita previstas (1 h por ponto). */
function bandRows(points: ForecastPointView[]) {
  return (["fora de ponta", "intermediaria", "ponta"] as Band[])
    .map((band) => {
      const rows = points.filter((p) => p.band === band);
      const kwh = rows.reduce((s, p) => s + p.evLoadKw, 0);
      return {
        band,
        hours: rows.map((p) => p.hour),
        avgPrice: rows.length ? rows.reduce((s, p) => s + p.price, 0) / rows.length : 0,
        kwh,
        revenue: rows.reduce((s, p) => s + p.evLoadKw * p.price, 0),
      };
    })
    .filter((r) => r.hours.length > 0);
}

/** [0,1,2,20,21] -> "00h–03h, 20h–22h" */
function hourWindows(hours: number[]): string {
  const out: string[] = [];
  let start = hours[0];
  let prev = hours[0];
  for (const h of [...hours.slice(1), Infinity]) {
    if (h !== prev + 1) {
      out.push(`${hh(start)}–${hh(prev + 1)}`);
      start = h;
    }
    prev = h;
  }
  return out.join(", ");
}

export function DashboardInsights() {
  const { load, chargers, applyPeakShaving, peakShavingActive, forecast, retrainForecast, backend } = useLiveData();
  const [openTariffs, setOpenTariffs] = useState(false);
  const [openReport, setOpenReport] = useState(false);
  const [openMaint, setOpenMaint] = useState(false);
  const [retraining, setRetraining] = useState(false);

  const maintOptions = useMemo(
    () => [...chargers].sort((a, b) => (a.status === "faulted" ? -1 : 0) - (b.status === "faulted" ? -1 : 0)),
    [chargers]
  );
  const [maintCharger, setMaintCharger] = useState("");
  const [maintDate, setMaintDate] = useState("");
  const [maintTech, setMaintTech] = useState("");
  const [maintNote, setMaintNote] = useState("");

  const { summary, points, now } = forecast;
  const currentHour = new Date().getHours();
  const liveTotal = load.length ? load[load.length - 1].total : null;

  const demandData = useMemo(
    () => points.map((p) => ({ time: hh(p.hour), prev: p.totalDemandKw, real: p.hour === currentHour ? liveTotal : null })),
    [points, currentHour, liveTotal]
  );
  const priceData = useMemo(() => points.map((p) => ({ time: hh(p.hour), price: p.price, band: p.band })), [points]);
  const bands = useMemo(() => bandRows(points), [points]);

  const savingPct = Math.round((1 - summary.minPrice / summary.maxPrice) * 100);
  const weekdayAvg = forecast.weekdayIndex.slice(0, 5).reduce((s, v) => s + v, 0) / 5;
  const weekendAvg = forecast.weekdayIndex.slice(5).reduce((s, v) => s + v, 0) / 2;
  const weekendDrop = Math.round((1 - weekendAvg / weekdayAvg) * 100);
  const busiestDay = WEEKDAY_NAMES[forecast.weekdayIndex.indexOf(Math.max(...forecast.weekdayIndex))];
  const quietWindow = `${hh(summary.quietestStart)}–${hh(summary.quietestEnd)}`;
  const weekdayChart = forecast.weekdayIndex.map((v, i) => ({ day: WEEKDAY_NAMES[i].slice(0, 3), index: Math.round(v * 100) / 100 }));

  const confirmMaint = () => {
    toast.success("Manutenção agendada", {
      description: `${maintCharger || "Carregador"} · ${maintDate || "data a definir"} · ${maintTech || "técnico a definir"}`,
    });
    setOpenMaint(false);
  };

  const handleShaving = () => {
    applyPeakShaving();
    toast.success("Peak Shaving ativado", { description: "Reduzindo a potência dos carregadores em modo Econômico por 30 s." });
  };

  const downloadTariffs = () => {
    if (forecast.origin === "backend") {
      window.open(tariffsCsvUrl(), "_blank", "noopener");
      return;
    }
    // sem servidor: gera o mesmo CSV no navegador a partir do modelo embutido
    const util = hourlyForecast(forecast.weekdayIndex, null);
    const sat = hourlyForecast(forecast.weekdayIndex, 5);
    const sun = hourlyForecast(forecast.weekdayIndex, 6);
    const lines = [
      "# Gerado pelo modelo embutido no app (sem servidor). Preço de venda do kWh; não é a tarifa da concessionária.",
      "hora,faixa_dia_util,preco_dia_util_rs_kwh,preco_sabado_rs_kwh,preco_domingo_rs_kwh",
      ...util.map((u, i) => `${hh(u.hour).replace("h", ":00")},${u.band},${u.price.toFixed(2)},${sat[i].price.toFixed(2)},${sun[i].price.toFixed(2)}`),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "tarifas_horarias.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRetrain = async () => {
    setRetraining(true);
    try {
      toast.success("Modelo retreinado", { description: await retrainForecast() });
    } catch (e) {
      toast.error("Não foi possível retreinar", { description: e instanceof Error ? e.message : "erro desconhecido" });
    } finally {
      setRetraining(false);
    }
  };

  const insights = [
    summary.saturationAlert
      ? {
          type: "warning" as const,
          icon: AlertTriangle,
          title: `Saturação prevista: ${hourWindows(summary.saturationHours)}`,
          description: `Ocupação prevista de até ${pct(summary.peakOccupancy)} da capacidade para carros (${forecast.weekdayName}). Recomendação: ativar Peak Shaving e incentivar recargas entre ${quietWindow}.`,
          action: peakShavingActive ? "Peak Shaving Ativo ✓" : "Ativar Peak Shaving",
          disabled: peakShavingActive,
          onClick: handleShaving,
        }
      : {
          type: "ok" as const,
          icon: CheckCircle2,
          title: "Sem saturação prevista hoje",
          description: `Pico previsto de ${pct(summary.peakOccupancy)} da capacidade para carros às ${hh(summary.peakHour)} (${forecast.weekdayName}). O preço varia de ${brl(summary.minPrice)} a ${brl(summary.maxPrice)}.`,
          action: "Ver faixas de tarifa",
          disabled: false,
          onClick: () => setOpenTariffs(true),
        },
    {
      type: "insight" as const,
      icon: Lightbulb,
      title: "Preço por faixa de horário",
      description: `Carregar entre ${quietWindow} custa até ${savingPct}% menos que no horário de pico (${brl(summary.minPrice)} contra ${brl(summary.maxPrice)} por kWh). Preço médio de hoje: ${brl(summary.avgPrice)}.`,
      action: "Ver análise por faixa",
      disabled: false,
      onClick: () => setOpenTariffs(true),
    },
    {
      type: "insight" as const,
      icon: TrendingUp,
      title: "Padrão semanal",
      description: `No histórico usado no modelo, o fim de semana consome cerca de ${weekendDrop}% menos que os dias úteis. O dia de maior demanda é ${busiestDay}.`,
      action: "Ver índice por dia da semana",
      disabled: false,
      onClick: () => setOpenReport(true),
    },
    {
      type: "insight" as const,
      icon: Clock,
      title: "Horário ideal para manutenção",
      description: `Menor ocupação prevista entre ${quietWindow}. Janela ideal para manutenção preventiva dos carregadores com falha.`,
      action: "Agendar manutenção",
      disabled: false,
      onClick: () => setOpenMaint(true),
    },
  ];

  return (
    <div className="space-y-4 fade-in">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Brain className="w-5 h-5 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Inteligência Artificial - Previsão de Demanda e Preço</h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">{forecast.modelLabel}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={downloadTariffs}
            className="text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 flex items-center gap-1.5"
          >
            <Download className="w-3 h-3" /> tarifas_horarias.csv
          </button>
          {backend.status === "online" && (
            <button
              onClick={handleRetrain}
              disabled={retraining}
              className="text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 disabled:opacity-60 flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3 h-3 ${retraining ? "animate-spin" : ""}`} /> Retreinar modelo
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="glass-card-glow p-4">
          <p className="text-[10px] text-muted-foreground">Preço agora</p>
          <p className="text-2xl font-bold tabular-nums" style={{ color: BAND_COLOR[now.band] }}>
            {brl(now.price)}<span className="text-xs text-muted-foreground font-normal">/kWh</span>
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            Faixa {BAND_LABEL[now.band].toLowerCase()} · ocupação usada {pct(now.occupancyUsed)} (prevista {pct(now.occupancyPredicted)} · real {pct(now.occupancyLive)})
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] text-muted-foreground">Pico previsto hoje ({forecast.weekdayName})</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">{hh(summary.peakHour)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{pct(summary.peakOccupancy)} da capacidade para carros</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-[10px] text-muted-foreground">Preço médio previsto hoje</p>
          <p className="text-2xl font-bold text-goodwe-green tabular-nums">{brl(summary.avgPrice)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Faixa de {brl(summary.minPrice)} a {brl(summary.maxPrice)}</p>
        </div>
      </div>

      <div className="glass-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-1">Tarifa por modo de recarga</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Além do preço do kWh acima, cada modo soma um acréscimo (potência maior = mais caro) e a sessão cobra R$ {TIME_RATE_PER_MIN.toFixed(2)}/min de uso.
          Ociosidade (bateria cheia): R$ {IDLE_RATE_PER_MIN.toFixed(2)}/min após {IDLE_GRACE_MIN} min de tolerância. Teto: R$ {PRICE_CAP_PER_KWH.toFixed(2)}/kWh entregue.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {(Object.keys(MODE_SURCHARGE_PER_KWH) as (keyof typeof MODE_SURCHARGE_PER_KWH)[]).map((mode) => (
            <div key={mode} className="glass-card p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{MODE_LABEL[mode]}</p>
              <p className="text-sm font-bold text-foreground tabular-nums">{brl(now.price + MODE_SURCHARGE_PER_KWH[mode])}/kWh</p>
              <p className="text-[10px] text-muted-foreground">{Math.round(MODE_POWER_FACTOR[mode] * 100)}% da potência do carregador</p>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card-glow p-4">
        <h3 className="text-sm font-semibold text-foreground mb-1">Previsão de Demanda — hoje (kW)</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Linha pontilhada: demanda total prevista (prédio + carros). Ponto azul: demanda medida agora (simulada no navegador). Linha vermelha: limite contratado de {CONTRACTED_KW} kW.
        </p>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={demandData}>
            <defs>
              <linearGradient id="prevGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#E60012" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#E60012" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#999" }} interval={2} />
            <YAxis tick={{ fontSize: 10, fill: "#999" }} domain={[100, 210]} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <ReferenceLine y={CONTRACTED_KW} stroke="#E60012" strokeDasharray="4 4" />
            <Area type="monotone" dataKey="prev" stroke="#E60012" fill="url(#prevGrad)" strokeWidth={2} strokeDasharray="5 5" name="Previsão (kW)" isAnimationActive={false} />
            <Area type="monotone" dataKey="real" stroke="#00AEEF" fill="none" strokeWidth={2} dot={{ r: 5, fill: "#00AEEF" }} name="Medido agora (kW)" isAnimationActive={false} connectNulls={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="glass-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-1">Preço previsto por hora (R$/kWh)</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Preço = R$ 1,10 + R$ 0,90 × ocupação prevista. Verde: fora de ponta · laranja: intermediária · vermelho: ponta.
        </p>
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={priceData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#999" }} interval={2} />
            <YAxis tick={{ fontSize: 10, fill: "#999" }} domain={[1, 2.1]} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [brl(v), "Preço"]} />
            <Bar dataKey="price" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {priceData.map((p) => (
                <Cell key={p.time} fill={BAND_COLOR[p.band]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {insights.map((ins, i) => (
          <div key={i} className={`glass-card p-4 ${ins.type === "warning" ? "border-goodwe-orange/30" : ""}`}>
            <div className="flex items-start gap-3">
              <ins.icon className={`w-5 h-5 mt-0.5 ${ins.type === "warning" ? "text-goodwe-orange" : ins.type === "ok" ? "text-goodwe-green" : "text-goodwe-blue"}`} />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-foreground">{ins.title}</h4>
                <p className="text-xs text-muted-foreground mt-1">{ins.description}</p>
                <button
                  onClick={ins.onClick}
                  disabled={ins.disabled}
                  className="mt-2 text-xs font-semibold text-primary hover:underline disabled:opacity-60 disabled:no-underline"
                >
                  {ins.action} {!ins.disabled && "→"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground/80 leading-relaxed">{forecast.note}</p>

      {/* Tarifas */}
      <Dialog open={openTariffs} onOpenChange={setOpenTariffs}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Análise de tarifas vs receita prevista</DialogTitle>
            <DialogDescription>Estimativa do modelo para hoje ({forecast.weekdayName}), por faixa de preço</DialogDescription>
          </DialogHeader>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-white/5">
                <th className="text-left py-2 font-medium">Faixa</th>
                <th className="text-left py-2 font-medium">Horas</th>
                <th className="text-right py-2 font-medium">Preço médio</th>
                <th className="text-right py-2 font-medium">kWh</th>
                <th className="text-right py-2 font-medium">Receita</th>
              </tr>
            </thead>
            <tbody>
              {bands.map((r) => (
                <tr key={r.band} className="border-b border-white/5">
                  <td className="py-2 text-foreground">{BAND_LABEL[r.band]}</td>
                  <td className="py-2 text-muted-foreground">{hourWindows(r.hours)}</td>
                  <td className="py-2 text-right tabular-nums" style={{ color: BAND_COLOR[r.band] }}>{brl(r.avgPrice)}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{Math.round(r.kwh)}</td>
                  <td className="py-2 text-right tabular-nums text-goodwe-green">{brl(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-muted-foreground">Energia e receita são previsões do modelo (não medições).</p>
        </DialogContent>
      </Dialog>

      {/* Indice semanal */}
      <Dialog open={openReport} onOpenChange={setOpenReport}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Índice de demanda por dia da semana</DialogTitle>
            <DialogDescription>1,00 = média diária do histórico (contando os dias sem recarga). {forecast.modelLabel}.</DialogDescription>
          </DialogHeader>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={weekdayChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#999" }} />
              <YAxis tick={{ fontSize: 10, fill: "#999" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <ReferenceLine y={1} stroke="#999" strokeDasharray="4 4" />
              <Bar dataKey="index" name="Índice" fill="#00AEEF" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </DialogContent>
      </Dialog>

      {/* Manutenção */}
      <Dialog open={openMaint} onOpenChange={setOpenMaint}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Agendar manutenção</DialogTitle>
            <DialogDescription>Janela recomendada pelo modelo: {quietWindow}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Carregador</label>
              <select
                value={maintCharger}
                onChange={(e) => setMaintCharger(e.target.value)}
                className="mt-1 w-full rounded-md bg-black/30 border border-white/10 text-xs text-foreground px-2 py-2"
              >
                <option value="">Selecione…</option>
                {maintOptions.map((c) => (
                  <option key={c.id} value={`${c.id} — ${c.name}`}>
                    {c.id} — {c.name}{c.status === "faulted" ? " (falha)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Data</label>
              <Input type="date" value={maintDate} onChange={(e) => setMaintDate(e.target.value)} className="mt-1 text-xs" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Técnico responsável</label>
              <Input value={maintTech} onChange={(e) => setMaintTech(e.target.value)} placeholder="Ex: Marcos Andrade" className="mt-1 text-xs" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Observação</label>
              <Textarea value={maintNote} onChange={(e) => setMaintNote(e.target.value)} placeholder="Detalhe o procedimento previsto…" className="mt-1 text-xs" />
            </div>
            <button
              onClick={confirmMaint}
              className="w-full text-xs font-semibold px-3 py-2 rounded-lg bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition"
            >
              Confirmar agendamento
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
