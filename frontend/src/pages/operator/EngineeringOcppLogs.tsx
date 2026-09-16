import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { SessionEvent } from "@/lib/types";

const OCPP_LABEL: Record<string, string> = {
  session_created: "BootNotification / StartTransaction.req",
  payment_confirmed: "Authorize (pre-autorizacao de pagamento)",
  rfid_authenticated: "Authorize.conf (RFID aprovado)",
  rfid_denied: "Authorize.conf (RFID negado)",
  cable_connected: "StatusNotification: Charging",
  maintenance_bypass_enabled: "ChangeAvailability (bypass de manutencao)",
  payment_finalized: "MeterValues + StopTransaction.conf (pagamento liquidado)",
  session_stopped: "StopTransaction.req",
};

interface LogRow extends SessionEvent {
  session_id: number;
}

export function EngineeringOcppLogs() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const sessions = await api.listSessions().catch(() => []);
      const allEvents = await Promise.all(
        sessions.map(async (s) => {
          const events = await api.getSessionEvents(s.id).catch(() => []);
          return events.map((e) => ({ ...e, session_id: s.id }));
        }),
      );
      const flat = allEvents.flat().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setRows(flat);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Logs OCPP</h1>
        <p className="text-sm text-white/50">Eventos da maquina de estados de sessao, formatados como mensagens OCPP</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trilha de eventos</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-white/40">
                <th className="pb-2 font-medium">Horario</th>
                <th className="pb-2 font-medium">Sessao</th>
                <th className="pb-2 font-medium">Mensagem OCPP</th>
                <th className="pb-2 font-medium">Evento interno</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-white/40">
                    Nenhum evento registrado ainda
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-white/10 font-mono">
                  <td className="py-2">{new Date(row.created_at).toLocaleString("pt-BR")}</td>
                  <td className="py-2">#{row.session_id}</td>
                  <td className="py-2">{OCPP_LABEL[row.type] ?? row.type}</td>
                  <td className="py-2 text-white/50">{row.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
