/**
 * Every integration the dashboard offers. "Coming soon" entries are listed so
 * the catalogue shows where the platform is going; they cannot be connected.
 */
import type { AnyConnector, Capability, Connector } from "./types";
import { zuuvy } from "./zuuvy/connector";

function comingSoon(
  kind: string,
  name: string,
  tagline: string,
  category: Connector["category"],
  capabilities: Capability[],
): AnyConnector {
  return {
    kind,
    name,
    tagline,
    description: tagline,
    category,
    availability: "coming_soon",
    capabilities,
    fields: [],
    parse() {
      throw new Error(`${name} is not available yet`);
    },
    async test() {
      throw new Error(`${name} is not available yet`);
    },
  };
}

export const CONNECTORS: AnyConnector[] = [
  zuuvy,
  comingSoon("razorpay", "Razorpay", "Take UPI, card and netbanking payments at checkout", "payments", ["payments"]),
  comingSoon("cashfree", "Cashfree", "Payments and split settlements", "payments", ["payments"]),
  comingSoon("twilio-whatsapp", "WhatsApp (Twilio)", "Order updates and templates on WhatsApp, with approval status synced here", "messaging", ["messaging"]),
  comingSoon("google-sheets", "Google Sheets", "Use a spreadsheet as a data source for any section", "data", ["catalog"]),
  comingSoon("csv", "CSV import", "Upload a product or content list", "data", ["catalog"]),
];

export function getConnector(kind: string): AnyConnector {
  const c = CONNECTORS.find((c) => c.kind === kind);
  if (!c) throw new Error(`no connector ${kind}`);
  return c;
}
