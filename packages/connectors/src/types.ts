/**
 * What a connector is. Connectors describe an external system and translate
 * to and from it; they never touch the database. The platform package owns
 * persistence, secrets and retries, so a connector is easy to test and a
 * marketplace connector can later run out of process behind the same shape.
 */

export type Capability = "catalog" | "orders" | "order_updates" | "messaging" | "payments";

export type FieldSpec = {
  name: string;
  label: string;
  kind: "text" | "url" | "secret";
  placeholder?: string;
  help?: string;
  required?: boolean;
};

/** A product as the platform stores it, from whichever source. */
export type CatalogItem = {
  externalId: string;
  name: string;
  description: string;
  category: string | null;
  price: number | null;
  mrp: number | null;
  unitLabel: string | null;
  images: string[];
  stock: number | null;
  inStock: boolean;
  /** false = no longer offered online; the platform hides it. */
  listed: boolean;
};

export type CatalogPage = { items: CatalogItem[]; nextCursor: string | null };

export type OutboundOrder = {
  /** Our order id — the idempotency key on the other side. */
  requestId: string;
  reference: string;
  customer: { name: string; phone: string; address: string };
  lines: { externalProductId: string; name: string; quantity: number; unitPrice: number }[];
  payment: { method: "cod" | "online"; status: "unpaid" | "paid"; gateway?: string; reference?: string };
  subtotal: number;
  total: number;
  note?: string;
};

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "packed"
  | "shipped"
  | "delivered"
  | "cancelled";

/** An inbound event, already verified and translated into platform terms. */
export type InboundEvent =
  | {
      kind: "order.status";
      deliveryId: string;
      requestId: string;
      externalOrderId: string;
      status: OrderStatus;
      externalStatus: string;
      note?: string;
    }
  | { kind: "product.upsert"; deliveryId: string; item: CatalogItem }
  | { kind: "product.remove"; deliveryId: string; externalId: string }
  | { kind: "ignored"; deliveryId: string; topic: string };

export type ConnectionInfo = {
  /** Shown on the integration page: "Pooja Communications · price tier Retail". */
  headline: string;
  details: Record<string, string>;
};

export class ConnectorError extends Error {
  override name = "ConnectorError";
  constructor(
    message: string,
    /** Whether trying again later could succeed (network, 5xx) or not (bad key). */
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type Connection<Config, Secrets> = { config: Config; secrets: Secrets };

export type Connector<Config = Record<string, string>, Secrets = Record<string, string>> = {
  kind: string;
  name: string;
  tagline: string;
  description: string;
  category: "commerce" | "data" | "payments" | "messaging";
  availability: "available" | "coming_soon";
  capabilities: Capability[];
  fields: FieldSpec[];
  /** Turn the dashboard form into config (stored plainly) and secrets (sealed). */
  parse(input: Record<string, string>): Connection<Config, Secrets>;
  /** Prove the credentials work; say what they reach. */
  test(conn: Connection<Config, Secrets>): Promise<ConnectionInfo>;
  /** Tell the other side where to send events, when it supports that. */
  registerWebhook?(conn: Connection<Config, Secrets>, url: string, secret: string): Promise<void>;
  fetchCatalog?(conn: Connection<Config, Secrets>, opts: { since: Date | null; cursor: string | null }): Promise<CatalogPage>;
  pushOrder?(conn: Connection<Config, Secrets>, order: OutboundOrder): Promise<{ externalOrderId: string; externalStatus: string; status: OrderStatus }>;
  /** Verify a delivery and translate it; throws ConnectorError(…, false) when forged. */
  parseWebhook?(
    webhookSecret: string,
    headers: Record<string, string | undefined>,
    rawBody: string,
    now?: Date,
  ): InboundEvent;
};

/** Registry entries are heterogeneous; the platform treats them uniformly. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyConnector = Connector<any, any>;
