"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart } from "ai";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AgentUIMessage } from "@/lib/agents/ui-types";

const EXAMPLES = [
  "Which disputes need a response, and when is evidence due?",
  "Why did payments fail in the last 7 days?",
  "What is our dispute rate over the last 30 days?",
  "Which subscriptions are past due, and what do their customers owe?",
];

function Sources({ data }: { data: Extract<AgentUIMessage["parts"][number], { type: "data-sources" }>["data"] }) {
  return (
    <div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
      {data.cited.length ? (
        <p>
          <span className="font-medium text-foreground">Sources:</span> {data.cited.join(", ")}
        </p>
      ) : (
        <p>
          <span className="font-medium text-foreground">Sources:</span> no Stripe objects cited.
          {data.tools.length ? ` Looked at: ${data.tools.join(", ")}.` : " No tools were used."}
        </p>
      )}
      {data.unverified.length > 0 && <p className="text-red-700">Not found in tool results: {data.unverified.join(", ")}</p>}
    </div>
  );
}

function Message({ message }: { message: AgentUIMessage }) {
  if (message.role === "user") {
    return (
      <div className="rounded bg-muted px-3 py-2 text-sm">
        {message.parts.map((part, i) => (part.type === "text" ? <span key={i}>{part.text}</span> : null))}
      </div>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      {message.parts.map((part, i) => {
        if (part.type === "text") return <p key={i} className="whitespace-pre-wrap">{part.text}</p>;
        if (part.type === "data-plan")
          return (
            <p key={i} className="text-xs text-muted-foreground">
              Routed to {part.data.agents.join(" and ")}
              {part.data.source === "keywords" ? " (keyword fallback)" : ""}
            </p>
          );
        if (part.type === "data-section") return <p key={i} className="pt-2 font-medium capitalize">{part.data.agent}</p>;
        if (part.type === "data-sources") return <Sources key={i} data={part.data} />;
        if (isToolUIPart(part)) {
          const done = part.state === "output-available" || part.state === "output-error";
          return (
            <p key={i} className="font-mono text-xs text-muted-foreground">
              {done ? "Looked up" : "Looking up"} {getToolName(part)}
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}

export function Chat({ mode }: { mode: "demo" | "connected" }) {
  const { messages, sendMessage, status, error, stop } = useChat<AgentUIMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Chat</h1>
        <p className="text-sm text-muted-foreground">
          {mode === "demo"
            ? "Ask about the read-only demo account: a coffee subscription business in Stripe test mode."
            : "Ask about your connected Stripe test account."}{" "}
          Answers cite the Stripe objects they used.
        </p>
      </div>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <Button key={example} variant="outline" size="sm" onClick={() => send(example)}>
              {example}
            </Button>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
        {status === "submitted" && <p className="text-xs text-muted-foreground">Routing your question...</p>}
        {error && <p className="text-sm text-red-700">Something went wrong. Please try again.</p>}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          maxLength={2000}
          placeholder="Ask about payments, disputes, invoices, subscriptions..."
          className="flex-1 rounded border px-3 py-2 text-sm"
        />
        {busy ? (
          <Button type="button" variant="outline" onClick={() => stop()}>
            Stop
          </Button>
        ) : (
          <Button type="submit">Ask</Button>
        )}
      </form>
    </div>
  );
}
