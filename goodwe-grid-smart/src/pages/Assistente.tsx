import { useState, useRef, useEffect, FormEvent } from "react";
import { Link } from "react-router-dom";
import { Zap, Send, ArrowLeft } from "lucide-react";

type Msg = { id: number; role: "user" | "assistant"; text: string };

const suggestions = [
  "Qual a diferença entre carregador AC e DC?",
  "Quanto custa carregar 30 kWh no horário de pico?",
  "Como funciona o balanceamento de carga?",
];

const placeholderReply = (q: string) =>
  `Recebi sua pergunta: "${q}". Em breve responderei usando a IA da GoodWe ChargeGrid Intelligence — a integração com o modelo será conectada em seguida.`;

export default function Assistente() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    idRef.current += 1;
    const userMsg: Msg = { id: idRef.current, role: "user", text: t };
    idRef.current += 1;
    const botMsg: Msg = { id: idRef.current, role: "assistant", text: placeholderReply(t) };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setTimeout(() => setMessages((m) => [...m, botMsg]), 500);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-white/5 px-4 lg:px-6 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center glow-red">
            <Zap className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-foreground">⚡ GoodWe EV Assistant</h1>
            <p className="text-[10px] text-muted-foreground">
              Especialista em recarga de veículos elétricos para ambientes comerciais
            </p>
          </div>
        </Link>
        <Link
          to="/"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar
        </Link>
      </header>

      <div className="flex-1 flex flex-col min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-[780px] mx-auto w-full">
            {messages.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mx-auto mb-4 glow-red">
                  <Zap className="w-7 h-7 text-primary" />
                </div>
                <h2 className="text-lg font-semibold text-foreground mb-2">
                  👋 Olá! Como posso ajudar na sua recarga comercial hoje?
                </h2>
                <p className="text-xs text-muted-foreground mb-6">
                  Escolha uma sugestão ou faça sua pergunta abaixo.
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="px-3 py-2 rounded-full text-xs font-medium border border-white/10 bg-card/60 hover:bg-primary/10 hover:border-primary/40 hover:text-foreground text-muted-foreground transition"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {m.role === "assistant" && (
                      <div className="w-8 h-8 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-sm shrink-0">
                        ⚡
                      </div>
                    )}
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-card border border-white/5 text-foreground rounded-bl-sm"
                      }`}
                    >
                      {m.text}
                    </div>
                    {m.role === "user" && (
                      <div className="w-8 h-8 rounded-full bg-muted border border-white/10 flex items-center justify-center text-sm shrink-0">
                        🧑
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <form onSubmit={onSubmit} className="border-t border-white/5 bg-card/30 backdrop-blur-xl px-4 py-3">
          <div className="max-w-[780px] mx-auto flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pergunte sobre recarga comercial GoodWe..."
              className="flex-1 bg-muted/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition"
              aria-label="Enviar"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
