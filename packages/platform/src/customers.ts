/**
 * Customers of a business: people who buy from its stores. An account lets
 * them sign in on any of the business's stores, check out without retyping
 * their address, and follow their orders.
 *
 * Accounts belong to the business, not the platform: the same email at two
 * businesses is two customers, and neither business can see the other's.
 * A session is bound to one business and lives in a cookie on the store's
 * own host, apart from the studio's.
 *
 * Orders are linked to an account only when placed while signed in. Linking
 * earlier orders by phone number would let anyone who typed that number see
 * someone else's orders, since a number is not proof of who you are.
 */
import { createHash } from "node:crypto";
import { hashPassword, verifyPassword } from "./auth";
import { type Tx, UserError, isUniqueViolation, isUuid, withTenant } from "./db";
import { normalisePhone, type PublicOrder, publicOrder } from "./orders";
import { randomToken } from "./secrets";

const SESSION_DAYS = 60;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const DUMMY = hashPassword("not-a-real-password");

export type CustomerAccount = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  address: string | null;
  created_at: Date;
};

const COLUMNS = "id, email, name, phone, address, created_at";

function cleanEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) throw new UserError("Enter a valid email address.");
  return email;
}

export async function signUpCustomer(
  tenantId: string,
  input: { name: string; email: string; password: string; phone?: string },
): Promise<{ customerId: string }> {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new UserError("Please enter your name.");
  const email = cleanEmail(input.email);
  if (input.password.length < 8) throw new UserError("Use a password of at least 8 characters.");
  const phone = input.phone?.trim() ? normalisePhone(input.phone) : null;
  if (input.phone?.trim() && !phone) throw new UserError("Please enter a 10-digit mobile number.");
  const hash = await hashPassword(input.password);
  try {
    const row = await withTenant(tenantId, (tx) =>
      tx.get<{ id: string }>(
        "insert into customers (tenant_id, email, name, phone, password_hash) values (app_tenant(), $1, $2, $3, $4) returning id",
        [email, name, phone, hash],
      ),
    );
    return { customerId: row.id };
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("That email already has an account here — sign in instead.");
    throw e;
  }
}

export async function signInCustomer(tenantId: string, rawEmail: string, password: string): Promise<{ customerId: string }> {
  const email = rawEmail.trim().toLowerCase();
  const found = await withTenant(tenantId, (tx) =>
    tx.one<{ id: string; password_hash: string }>("select id, password_hash from customers where lower(email) = $1", [email]),
  );
  // Verify even when there is no such customer, so timing does not reveal which emails have accounts.
  const ok = await verifyPassword(password, found?.password_hash ?? (await DUMMY));
  if (!found || !ok) throw new UserError("That email and password do not match.");
  await withTenant(tenantId, (tx) => tx.query("update customers set last_login_at = now() where id = $1", [found.id]));
  return { customerId: found.id };
}

export async function createCustomerSession(tenantId: string, customerId: string): Promise<{ token: string; expires: Date }> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await withTenant(tenantId, (tx) =>
    tx.query("insert into customer_sessions (token_hash, tenant_id, customer_id, expires_at) values ($1, app_tenant(), $2, $3)", [
      sha256(token),
      customerId,
      expires,
    ]),
  );
  return { token, expires };
}

/** The signed-in customer for this business, or null. A token from another business finds nothing (RLS). */
export async function customerFromSession(tenantId: string, token: string | undefined): Promise<CustomerAccount | null> {
  if (!token || token.length > 100) return null;
  return withTenant(tenantId, async (tx) =>
    (await tx.one<CustomerAccount>(
      `select ${COLUMNS.split(", ").map((c) => `c.${c}`).join(", ")}
         from customer_sessions s join customers c on c.id = s.customer_id
        where s.token_hash = $1 and s.expires_at > now()`,
      [sha256(token)],
    )) ?? null,
  );
}

export async function endCustomerSession(tenantId: string, token: string): Promise<void> {
  await withTenant(tenantId, (tx) => tx.query("delete from customer_sessions where token_hash = $1", [sha256(token)]));
}

export async function updateCustomerProfile(
  tenantId: string,
  customerId: string,
  input: { name: string; phone?: string; address?: string },
): Promise<void> {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new UserError("Please enter your name.");
  const phone = input.phone?.trim() ? normalisePhone(input.phone) : null;
  if (input.phone?.trim() && !phone) throw new UserError("Please enter a 10-digit mobile number.");
  const address = input.address?.trim().slice(0, 500) || null;
  await withTenant(tenantId, (tx) =>
    tx.query("update customers set name = $2, phone = $3, address = $4 where id = $1", [customerId, name, phone, address]),
  );
}

export async function changeCustomerPassword(tenantId: string, customerId: string, current: string, next: string): Promise<void> {
  if (next.length < 8) throw new UserError("Use a new password of at least 8 characters.");
  const row = await withTenant(tenantId, (tx) => tx.get<{ password_hash: string }>("select password_hash from customers where id = $1", [customerId], "customer"));
  if (!(await verifyPassword(current, row.password_hash))) throw new UserError("Your current password is not right.");
  const hash = await hashPassword(next);
  await withTenant(tenantId, async (tx) => {
    await tx.query("update customers set password_hash = $2 where id = $1", [customerId, hash]);
    // Everywhere else they were signed in, they are not any more.
    await tx.query("delete from customer_sessions where customer_id = $1", [customerId]);
  });
}

export type CustomerOrderRow = { number: number; status: string; total: number; items: number; created_at: Date; public_token: string };

export async function customerOrders(tenantId: string, customerId: string): Promise<CustomerOrderRow[]> {
  return withTenant(tenantId, (tx) =>
    tx.query<CustomerOrderRow>(
      `select number, status, total::float8 as total, jsonb_array_length(lines)::int as items, created_at, public_token
         from orders where customer_id = $1 order by created_at desc limit 100`,
      [customerId],
    ),
  );
}

/** One of this customer's orders, with its timeline; null for anyone else's. */
export async function customerOrder(tenantId: string, customerId: string, number: number): Promise<PublicOrder | null> {
  if (!Number.isInteger(number)) return null;
  return withTenant(tenantId, async (tx) => {
    const row = await tx.one<{ id: string }>("select id from orders where customer_id = $1 and number = $2", [customerId, number]);
    return row ? publicOrder(tx, row.id) : null;
  });
}

/** The business's customers, with what they have ordered. */
export async function listCustomers(tx: Tx): Promise<(CustomerAccount & { orders: number; spent: number; last_order_at: Date | null })[]> {
  return tx.query(
    `select c.id, c.email, c.name, c.phone, c.address, c.created_at,
            count(o.id)::int as orders, coalesce(sum(o.total) filter (where o.status not in ('rejected', 'cancelled')), 0)::float8 as spent,
            max(o.created_at) as last_order_at
       from customers c left join orders o on o.customer_id = c.id
      group by c.id order by c.created_at desc limit 500`,
  );
}

export function isCustomerId(id: string | null | undefined): id is string {
  return Boolean(id && isUuid(id));
}
