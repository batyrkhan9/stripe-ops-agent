import "server-only";
import { getDb } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import type { AuditRecord } from "@/lib/tools/types";

// Read tool calls are audited best effort: a logging failure is reported but does not block the answer.
// Write tools (Phase 3) must treat an audit failure as a failed action.
export function createAuditWriter(accountId: string) {
  return async (record: AuditRecord) => {
    try {
      await getDb().insert(auditLog).values({
        accountId,
        agent: record.agent,
        tool: record.tool,
        params: record.params ?? {},
        stripeIds: record.stripeIds,
        result: record.result as object,
      });
    } catch (error) {
      console.error("audit log insert failed", record.tool, error);
    }
  };
}
