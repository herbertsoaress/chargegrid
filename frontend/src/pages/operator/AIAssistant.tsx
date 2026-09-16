import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  text: string;
}

const QUICK_QUERIES = [
  "Quantas sessoes estao ativas agora?",
  "Qual o faturamento de hoje?",
  "Tem algum carregador em manutencao?",
  "Como esta a carga da rede GoodWe?",
];

export function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Ola! Posso responder sobre manutencao, faturamento, sessoes e carga da rede. O que voce quer saber?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const send = async (question: string) => {
    if (!question.trim()) return;
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setLoading(true);
    try {
      const res = await api.assistantQuery(question);
      setMessages((prev) => [...prev, { role: "assistant", text: res.answer }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Nao consegui consultar o backend agora." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Assistente IA</h1>
        <p className="text-sm text-white/50">Respostas baseadas em regras sobre os dados reais do backend</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUICK_QUERIES.map((q) => (
          <Button key={q} variant="outline" size="sm" onClick={() => send(q)}>
            {q}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conversa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                m.role === "user" ? "ml-auto bg-brand-red text-white" : "bg-white/10 text-white/90",
              )}
            >
              {m.text}
            </div>
          ))}
          {loading && <p className="text-xs text-white/40">Consultando...</p>}
        </CardContent>
      </Card>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className="flex-1 rounded-lg border border-white/10 bg-navy-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-red"
          placeholder="Pergunte algo sobre a operacao..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button type="submit">Enviar</Button>
      </form>
    </div>
  );
}
