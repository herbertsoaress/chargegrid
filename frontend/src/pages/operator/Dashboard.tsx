import { useEffect, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { SimBadge } from "@/components/shared/SimBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { BillingSummary, ChargingSession, GoodWeReading, PowerCurvePoint, Station } from "@/lib/types";
import { formatCurrency, formatKwh } from "@/lib/utils";

interface LivePoint {
  time: string;
  power_kw: number;
}

export function Dashboard() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [demandCurve, setDemandCurve] = useState<PowerCurvePoint[]>([]);
  const [sessions, setSessions] = useState<ChargingSession[]>([]);
  const [liveSeries, setLiveSeries] = useState<LivePoint[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [origem, setOrigem] = useState<"simulado" | "real">("simulado");

  useEffect(() => {
    api.listStations().then(setStations).catch(() => setStations([]));
    api.billingPowerCurve("comercial").then(setDemandCurve).catch(() => setDemandCurve([]));
  }, []);

  useEffect(() => {
    const poll = () => {
      api.billingSummary().then(setSummary).catch(() => undefined);
      api.listSessions().then((all) => setSessions(all.filter((s) => !s.ended_at))).catch(() => undefined);
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (stations.length === 0) return;
    const stationId = stations[0].id;
    const poll = () => {
      api
        .getStationTelemetry(stationId)
        .then((reading: GoodWeReading) => {
          setOrigem(reading.origem);
          setLiveSeries((prev) => {
            const next = [...prev, { time: new Date(reading.timestamp).toLocaleTimeString("pt-BR"), power_kw: reading.power_kw }];
            return next.slice(-20);
          });
        })
        .catch(() => undefined);
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [stations]);

  const weeklyRevenue = summary
    ? Array.from({ length: 7 }).map((_, i) => ({
        dia: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"][i],
        receita: Math.round(summary.daily_revenue * (0.6 + 0.4 * Math.abs(Math.sin(i + 1))) * 100) / 100,
      }))
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Painel Geral</h1>
        <p className="text-sm text-white/50">Visao consolidada da rede ChargeGrid</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Capacidade da rede</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {summary ? summary.network_used_kw.toFixed(0) : "--"}/{summary ? summary.network_capacity_kw.toFixed(0) : "--"} kW
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Energia diaria</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary ? formatKwh(summary.daily_energy_kwh) : "--"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sessoes ativas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {summary?.active_sessions ?? "--"}{" "}
              <span className="text-sm font-normal text-white/50">com {summary?.available_chargers ?? "--"} livres</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Faturamento diario</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary ? formatCurrency(summary.daily_revenue) : "--"}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Potencia ao vivo (janela recente)</CardTitle>
            <SimBadge origem={origem} />
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={liveSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff1a" />
                <XAxis dataKey="time" stroke="#ffffff66" fontSize={11} />
                <YAxis stroke="#ffffff66" fontSize={11} unit="kW" />
                <Tooltip contentStyle={{ background: "#0f2440", border: "none" }} />
                <Area type="monotone" dataKey="power_kw" stroke="#c0155e" fill="#c0155e33" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Demanda 24h - ChargeGrid Intelligence</CardTitle>
            <SimBadge origem="simulado" />
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={demandCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff1a" />
                <XAxis dataKey="hour" stroke="#ffffff66" fontSize={11} unit="h" />
                <YAxis stroke="#ffffff66" fontSize={11} unit="kW" />
                <Tooltip contentStyle={{ background: "#0f2440", border: "none" }} />
                <Line type="monotone" dataKey="power_kw" stroke="#2e9e83" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Receita semanal (estimada)</CardTitle>
            <SimBadge origem="simulado" />
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyRevenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff1a" />
                <XAxis dataKey="dia" stroke="#ffffff66" fontSize={11} />
                <YAxis stroke="#ffffff66" fontSize={11} />
                <Tooltip contentStyle={{ background: "#0f2440", border: "none" }} />
                <Bar dataKey="receita" fill="#c0155e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sessoes ativas</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-white/40">
                <th className="pb-2 font-medium">Sessao</th>
                <th className="pb-2 font-medium">Carregador</th>
                <th className="pb-2 font-medium">Modo</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Energia</th>
                <th className="pb-2 font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-white/40">
                    Nenhuma sessao ativa no momento
                  </td>
                </tr>
              )}
              {sessions.map((s) => (
                <tr key={s.id} className="border-t border-white/10">
                  <td className="py-2">#{s.id}</td>
                  <td className="py-2">Carregador {s.charger_id}</td>
                  <td className="py-2 capitalize">{s.mode}</td>
                  <td className="py-2">
                    <Badge variant={s.status === "carregando" ? "success" : "outline"}>{s.status.replaceAll("_", " ")}</Badge>
                  </td>
                  <td className="py-2">{formatKwh(s.energy_kwh)}</td>
                  <td className="py-2">{formatCurrency(s.amount_due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
