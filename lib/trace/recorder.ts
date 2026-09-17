import { randomUUID } from "node:crypto";

export type SpanKind = "planner" | "specialist" | "llm" | "tool";

export type Span = {
  id: string;
  parentId: string | null;
  kind: SpanKind;
  name: string;
  provider?: string;
  modelId?: string;
  input?: unknown;
  output?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  startedAt: Date;
  latencyMs: number;
  error?: string;
};

type SpanUpdate = Partial<Pick<Span, "provider" | "modelId" | "output" | "inputTokens" | "outputTokens" | "error">>;

// Collects spans in memory during a run; the caller persists them once at the end.
export class TraceRecorder {
  readonly runId = randomUUID();
  readonly startedAt = Date.now();
  readonly spans: Span[] = [];

  start(kind: SpanKind, name: string, options: { parentId?: string | null; input?: unknown } = {}) {
    const span: Span = {
      id: randomUUID(),
      parentId: options.parentId ?? null,
      kind,
      name,
      input: options.input,
      startedAt: new Date(),
      latencyMs: 0,
    };
    this.spans.push(span);
    return {
      id: span.id,
      end: (update: SpanUpdate = {}) => {
        Object.assign(span, update);
        span.latencyMs = Date.now() - span.startedAt.getTime();
      },
    };
  }

  // For events that report their own duration after the fact, such as tool calls.
  record(kind: SpanKind, name: string, fields: Omit<Span, "id" | "kind" | "name" | "startedAt"> & { startedAt?: Date }) {
    this.spans.push({ id: randomUUID(), kind, name, startedAt: fields.startedAt ?? new Date(Date.now() - fields.latencyMs), ...fields });
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }
}
