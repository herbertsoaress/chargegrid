import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { MODE_FACTOR } from "@/lib/modeFactor";
import type { Charger, ChargingSession, PaymentMethod } from "@/lib/types";
import { formatCurrency, formatKwh } from "@/lib/utils";

const STEPS = [
  { key: "aguardando_confirmacao_pagamento", label: "Pagamento" },
  { key: "aguardando_autenticacao_rfid", label: "RFID" },
  { key: "aguardando_conexao_cabo", label: "Cabo" },
  { key: "carregando", label: "Carregando" },
  { key: "finalizada_cabo_liberado", label: "Concluida" },
];

export function LiveSession() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const navigate = useNavigate();

  const [session, setSession] = useState<ChargingSession | null>(null);
  const [charger, setCharger] = useState<Charger | null>(null);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [now, setNow] = useState(Date.now());

  const refresh = () => api.getSession(sessionId).then(setSession).catch(() => undefined);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [sessionId]);

  useEffect(() => {
    if (session) api.getCharger(session.charger_id).then(setCharger).catch(() => undefined);
  }, [session?.charger_id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!session) {
    return <p className="text-sm text-white/50">Carregando sessao...</p>;
  }

  const stepIndex = session.maintenance_bypass
    ? STEPS.length - 1
    : STEPS.findIndex((s) => s.key === session.status);

  const elapsedHours = (now - new Date(session.started_at).getTime()) / 3_600_000;
  const estimatedKwh = charger ? charger.max_power_kw * MODE_FACTOR[session.mode] * Math.max(elapsedHours, 0) : 0;
  const estimatedCost = estimatedKwh * session.price_per_kwh_snapshot;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Sessao #{session.id}</h1>
        <p className="text-xs text-white/50">Carregador {session.charger_id} - modo {session.mode}</p>
      </div>

      <div className="flex justify-between">
        {STEPS.map((step, i) => (
          <div key={step.key} className="flex flex-1 flex-col items-center">
            <div
              className={`h-2 w-full ${i <= stepIndex ? "bg-brand-red" : "bg-white/10"} ${i === 0 ? "rounded-l-full" : ""} ${
                i === STEPS.length - 1 ? "rounded-r-full" : ""
              }`}
            />
            <span className="mt-1 text-[10px] text-white/50">{step.label}</span>
          </div>
        ))}
      </div>

      {session.maintenance_bypass && (
        <Badge variant="warning">Bypass de manutencao acionado pelo operador</Badge>
      )}

      {!session.payment_confirmed && !session.maintenance_bypass && (
        <Card>
          <CardHeader>
            <CardTitle>1. Confirmar pagamento</CardTitle>
          </CardHeader>
          <CardContent>
            <Button className="w-full" disabled={busy} onClick={() => act(() => api.confirmPayment(session.id))}>
              Confirmar pre-autorizacao
            </Button>
          </CardContent>
        </Card>
      )}

      {session.payment_confirmed && !session.rfid_ok && !session.maintenance_bypass && (
        <Card>
          <CardHeader>
            <CardTitle>2. Autenticar RFID</CardTitle>
          </CardHeader>
          <CardContent>
            <Button className="w-full" disabled={busy} onClick={() => act(() => api.authenticateRfid(session.id, true))}>
              Aproximar cartao RFID
            </Button>
          </CardContent>
        </Card>
      )}

      {session.rfid_ok && !session.cable_connected && !session.maintenance_bypass && (
        <Card>
          <CardHeader>
            <CardTitle>3. Conectar cabo</CardTitle>
          </CardHeader>
          <CardContent>
            <Button className="w-full" disabled={busy} onClick={() => act(() => api.connectCable(session.id))}>
              Engatar conector no veiculo
            </Button>
          </CardContent>
        </Card>
      )}

      {session.power_released && !session.payment_finalized && (
        <Card>
          <CardHeader>
            <CardTitle>Carregando</CardTitle>
            <Badge variant="success">Energia liberada</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-bold">{formatKwh(estimatedKwh)}</p>
            <p className="text-sm text-white/50">Estimativa: {formatCurrency(estimatedCost)}</p>
            <div className="space-y-2 border-t border-white/10 pt-3">
              <p className="text-sm font-medium">4. Finalizar e pagar</p>
              <div className="flex gap-2">
                {(["pix", "cartao"] as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`flex-1 rounded-lg border py-2 text-sm capitalize ${
                      method === m ? "border-brand-red bg-brand-red/10" : "border-white/10 text-white/60"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <Button
                className="w-full"
                disabled={busy}
                onClick={() => act(() => api.paySession(session.id, method))}
              >
                Pagar (sandbox)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {session.lock_released && !session.ended_at && (
        <Card>
          <CardHeader>
            <CardTitle>5. Destravar cabo</CardTitle>
            <Badge variant="success">Trava liberada</Badge>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              variant="success"
              disabled={busy}
              onClick={() => act(() => api.stopSession(session.id))}
            >
              Desconectar e encerrar sessao
            </Button>
          </CardContent>
        </Card>
      )}

      {session.ended_at && (
        <Card>
          <CardHeader>
            <CardTitle>Recibo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p>Energia entregue: {formatKwh(session.energy_kwh)}</p>
            <p>Preco/kWh: {formatCurrency(session.price_per_kwh_snapshot)}</p>
            <p className="text-lg font-bold">Total: {formatCurrency(session.amount_due)}</p>
            <Button className="w-full" variant="outline" onClick={() => navigate("/app/historico")}>
              Ver historico
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
