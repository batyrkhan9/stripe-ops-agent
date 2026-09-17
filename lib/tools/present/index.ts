import { finishAnswer } from "./finish-answer";
import { showAlerts } from "./show-alerts";
import { showDisputes } from "./show-disputes";
import { showInvoices } from "./show-invoices";

// Presentation tools read Stripe to build cards or record the next action. They never change data.
export const PRESENT_TOOLS = {
  show_disputes: showDisputes,
  show_invoices: showInvoices,
  show_alerts: showAlerts,
  finish_answer: finishAnswer,
} as const;

export type PresentToolName = keyof typeof PRESENT_TOOLS;
