import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { ChargingSession } from "@/lib/types";
import { formatCurrency, formatKwh } from "@/lib/utils";

export function History() {
  const [sessions, setSessions] = useState<ChargingSession[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .listSessions()
      .then((all) => setSessions(all.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())))
      .catch(() => setSessions([]));
  }, []);

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Historico de sessoes</h1>
      {sessions.length === 0 && <p className="text-sm text-white/40">Nenhuma sessao ainda.</p>}
      {sessions.map((s) => (
        <Card key={s.id} className="cursor-pointer" onClick={() => navigate(`/app/sessao/${s.id}`)}>
          <CardHeader>
            <CardTitle className="text-white">Sessao #{s.id}</CardTitle>
            <Badge variant={s.ended_at ? "outline" : "success"}>{s.ended_at ? "Encerrada" : "Em andamento"}</Badge>
          </CardHeader>
          <CardContent className="flex justify-between text-sm text-white/70">
            <span>{new Date(s.started_at).toLocaleString("pt-BR")}</span>
            <span>{formatKwh(s.energy_kwh)}</span>
            <span>{formatCurrency(s.amount_due)}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
