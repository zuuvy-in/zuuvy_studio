import type { Tone } from "./ui";
import { Badge } from "./ui";

const ORDER: Record<string, [string, Tone]> = {
  pending: ["Awaiting confirmation", "amber"],
  confirmed: ["Confirmed", "blue"],
  packed: ["Packed", "violet"],
  shipped: ["Out for delivery", "violet"],
  delivered: ["Delivered", "green"],
  rejected: ["Declined", "red"],
  cancelled: ["Cancelled", "gray"],
};

export function OrderStatusBadge({ status }: { status: string }) {
  const [label, tone] = ORDER[status] ?? [status, "gray"];
  return <Badge tone={tone}>{label}</Badge>;
}

const SYNC: Record<string, [string, Tone]> = {
  not_linked: ["Not linked", "gray"],
  pending: ["Sending…", "amber"],
  sent: ["In Zuuvy", "green"],
  failed: ["Not sent", "red"],
};

export function SyncBadge({ state }: { state: string }) {
  const [label, tone] = SYNC[state] ?? [state, "gray"];
  return <Badge tone={tone}>{label}</Badge>;
}

const SOURCE: Record<string, [string, Tone]> = {
  template: ["Template", "gray"],
  ai: ["AI", "brand"],
  manual: ["Manual", "gray"],
  restore: ["Restored", "blue"],
  import: ["Imported code", "violet"],
};

export function SourceBadge({ source }: { source: string }) {
  const [label, tone] = SOURCE[source] ?? [source, "gray"];
  return <Badge tone={tone}>{label}</Badge>;
}
