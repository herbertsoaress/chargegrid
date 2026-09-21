import type { ChatMsg } from "./useAssistantChat";

export function ChatBubble({ msg, compact = false }: { msg: ChatMsg; compact?: boolean }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`${compact ? "max-w-[85%] text-[11px] px-2.5 py-2" : "max-w-[88%] text-xs px-3 py-2"} rounded-2xl leading-relaxed whitespace-pre-line ${
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted/50 border border-white/5 text-foreground rounded-bl-sm"
        }`}
      >
        {msg.text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={i} className="font-semibold">
              {part.slice(2, -2)}
            </strong>
          ) : (
            part
          )
        )}
        {msg.origem === "ia" && (
          <span className="mt-1 flex items-center gap-1 text-[9px] font-medium text-primary/80">✨ Resposta gerada por IA</span>
        )}
      </div>
    </div>
  );
}

export function TypingDots() {
  return (
    <div className="flex justify-start">
      <div className="bg-muted/50 border border-white/5 rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce"
            style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
          />
        ))}
      </div>
    </div>
  );
}

export function SuggestionChips({
  items,
  onPick,
}: {
  items: string[];
  onPick: (s: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <button
          key={s}
          onClick={() => onPick(s)}
          className="px-2.5 py-1.5 rounded-full text-[10px] font-medium border border-white/10 bg-card/60 text-muted-foreground hover:bg-primary/10 hover:border-primary/40 hover:text-foreground transition"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
