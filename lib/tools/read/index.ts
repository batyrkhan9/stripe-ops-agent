import { getBalance } from "./get-balance";
import { getCharge } from "./get-charge";
import { getCustomer } from "./get-customer";
import { getDispute } from "./get-dispute";
import { listCharges } from "./list-charges";
import { listCustomers } from "./list-customers";
import { listDisputes } from "./list-disputes";
import { listInvoices } from "./list-invoices";
import { listSubscriptions } from "./list-subscriptions";
import { search } from "./search";

export const READ_TOOLS = {
  list_charges: listCharges,
  get_charge: getCharge,
  list_customers: listCustomers,
  get_customer: getCustomer,
  list_subscriptions: listSubscriptions,
  list_invoices: listInvoices,
  list_disputes: listDisputes,
  get_dispute: getDispute,
  get_balance: getBalance,
  search,
} as const;

export type ReadToolName = keyof typeof READ_TOOLS;
