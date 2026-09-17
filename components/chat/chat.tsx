"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart } from "ai";
import Link from "next/link";
import { useState } from "react";
import { CardList } from "@/components/cards/card-list";
import { Button } from "@/components/ui/button";
import type { Card, NextAction } from "@/lib/cards/types";
import { visibleAnswerText } from "@/lib/agents/present";
import type { AgentUIMessage } from "@/lib/agents/ui-types";
import type { Sources } from "@/lib/agents/sources";
import { Markdown } from "./markdown";


const EXAMPLES = [
  "Which disputes need a response?",
  "Why did payments fail in the last 7 days?",
  "What is our dispute rate over the last 30 days?",
  "Which subscriptions are past due?",
];

const TOOL_LABELS: Record<string, string> = {
  list_charges: "charges",
  get_charge: "a charge",
  list_customers: "customers",
  get_customer: "a customer",
  list_subscriptions: "subscriptions",
  list_invoices: "invoices",
  list_disputes: "disputes",
  get_dispute: "a dispute",
  get_balance: "the balance",
  search: "Stripe search",
  show_disputes: "dispute details",
  show_invoices: "invoice details",
};

function SourcesBlock({ sources }: { sources: Sources }) {
  const count = sources.cited.length;
  return (
    <details className="meta">
      <summary className="cursor-pointer select-none">
        Sources ({count === 0 ? "no objects cited" : `${count} Stripe object${count === 1 ? "" : "s"}`})
      </summary>
      <div className="mt-1 space-y-0.5 pl-3">
        {count > 0 && <p className="stripe-id break-all">{sources.cited.join("  ")}</p>}
        {sources.tools.length > 0 && <p>Looked at: {sources.tools.map((t) => TOOL_LABELS[t] ?? t).join(", ")}</p>}
        {sources.unverified.length > 0 && <p className="alert-text">Not found in tool results: {sources.unverified.join(", ")}</p>}
      </div>
    </details>
  );
}

function Answer({ message, streaming }: { message: AgentUIMessage; streaming: boolean }) {
  const texts: string[] = [];
  const cards: Card[] = [];
  let nextAction: NextAction | null = null;
  let sources: Sources | null = null;
  let agents: string[] = [];
  let pendingTool: string | null = null;

  for (const part of message.parts) {
    if (part.type === "text" && part.text.trim()) texts.push(part.text);
    else if (part.type === "data-plan") agents = part.data.agents;
    else if (part.type === "data-sources") sources = part.data;
    else if (part.type === "data-next") nextAction = part.data;
    else if (part.type === "data-cards") cards.push(...part.data.cards);
    else if (isToolUIPart(part)) {
      const name = getToolName(part);
      if (part.state !== "output-available") pendingTool = name;
    }
  }
  const finalAction = nextAction as NextAction | null;

  return (
    <div className="space-y-3">
      {agents.length > 0 && <p className="label">{agents.join(" and ")}</p>}
      {texts.map((text, i) => (
        <Markdown key={i} text={visibleAnswerText(text, cards.length > 0)} />
      ))}
      {cards.length > 0 && <CardList cards={cards} />}
      {streaming && pendingTool && pendingTool !== "finish_answer" && (
        <p className="meta">Checking {TOOL_LABELS[pendingTool] ?? pendingTool}...</p>
      )}
      {finalAction && (
        <div className="flex items-center justify-between gap-4 border-t border-strong-border pt-2">
          <p>
            <span className="label mr-2">Next</span>
            {finalAction.text}
          </p>
          {finalAction.button && (
            <Button asChild size="sm">
              <Link href={finalAction.button.href}>{finalAction.button.label}</Link>
            </Button>
          )}
        </div>
      )}
      {sources && <SourcesBlock sources={sources} />}
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

  // Pair each question with its answer, newest first.
  const exchanges: { question: AgentUIMessage; answer?: AgentUIMessage }[] = [];
  messages.forEach((message) => {
    if (message.role === "user") exchanges.push({ question: message });
    else if (exchanges.length) exchanges[exchanges.length - 1]!.answer = message;
  });
  exchanges.reverse();

  return (
    <div className="max-w-4xl space-y-4">
      <div className="page-header">
        <h1>Ask</h1>
        <span className="meta">
          {mode === "demo" ? "Demo account, read-only" : "Your connected account"}. Answers cite the Stripe objects they used.
        </span>
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
          placeholder="Ask about payments, disputes, invoices, or subscriptions"
          className="h-8 flex-1 rounded-sm border border-input px-2"
        />
        {busy ? (
          <Button type="button" variant="outline" size="lg" onClick={() => stop()}>
            Stop
          </Button>
        ) : (
          <Button type="submit" size="lg">
            Ask
          </Button>
        )}
      </form>

      {exchanges.length === 0 && (
        <div>
          <p className="label pb-1">Try</p>
          <ul className="space-y-0.5">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => send(example)}>
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="alert-row alert-text px-2 py-1.5">The answer failed. Try again in a minute.</p>}

      <div className="divide-y divide-strong-border border-t border-strong-border">
        {exchanges.map(({ question, answer }, index) => (
          <section key={question.id} className="space-y-2 py-4">
            <h2>{question.parts.map((part) => (part.type === "text" ? part.text : "")).join("")}</h2>
            {answer ? (
              <Answer message={answer} streaming={index === 0 && busy} />
            ) : (
              <p className="meta">Routing your question...</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
