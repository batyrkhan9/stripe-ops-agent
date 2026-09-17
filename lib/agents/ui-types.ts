import type { UIMessage } from "ai";
import type { AgentName } from "./registry";
import type { Card, NextAction } from "@/lib/cards/types";
import type { Sources } from "./sources";

// Shared by the chat route and the chat page. No server-only imports here.
export type AgentUIMessage = UIMessage<
  never,
  {
    plan: { agents: AgentName[]; reason: string; source: "model" | "keywords" };
    section: { agent: AgentName };
    sources: Sources;
    next: NextAction;
    cards: { cards: Card[] };
    served: { provider: string; modelId: string; fellBack: boolean; failures: string[] };
    // Present only when the answer is replayed from the demo cache.
    cached: { savedAt: string };
  }
>;
