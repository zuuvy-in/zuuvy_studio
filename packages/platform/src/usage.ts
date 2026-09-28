/**
 * AI usage: every edit attempt is a row, whether it produced a version or
 * not, because the tokens were spent either way. The studio shows a person
 * their own month; the internal dashboard (admin.ts) shows everyone's.
 */
import type { Tx } from "./db";

export type UsageOutcome = "version" | "no_change" | "refused" | "error";

export type UsageRecord = {
  userId: string | null;
  siteId: string | null;
  versionId?: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  requests: number;
  images: number;
  outcome: UsageOutcome;
  error?: string | null;
};

export async function recordUsage(tx: Tx, r: UsageRecord): Promise<void> {
  await tx.query(
    `insert into ai_usage (tenant_id, user_id, site_id, version_id, provider, model, input_tokens, output_tokens,
       cache_read_tokens, requests, images, outcome, error)
     values (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      r.userId, r.siteId, r.versionId ?? null, r.provider, r.model,
      r.inputTokens, r.outputTokens, r.cacheReadTokens, r.requests, r.images,
      r.outcome, r.error ? r.error.slice(0, 500) : null,
    ],
  );
}

export type UsageTotals = {
  attempts: number;
  versions: number;
  input_tokens: number;
  output_tokens: number;
  images: number;
};

/** The first instant of the current calendar month, in India time — the period people think in. */
export function monthStart(now = new Date()): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60_000);
}

const TOTALS = `count(*) as attempts,
  (count(*) filter (where outcome = 'version')) as versions,
  coalesce(sum(input_tokens), 0) as input_tokens,
  coalesce(sum(output_tokens), 0) as output_tokens,
  coalesce(sum(images), 0) as images`;

/** This business's usage since `since`, overall and for one person. */
export async function usageSummary(tx: Tx, userId: string, since = monthStart()): Promise<{ business: UsageTotals; mine: UsageTotals; since: Date }> {
  const business = await tx.get<UsageTotals>(`select ${TOTALS} from ai_usage where created_at >= $1`, [since]);
  const mine = await tx.get<UsageTotals>(`select ${TOTALS} from ai_usage where created_at >= $1 and user_id = $2`, [since, userId]);
  return { business, mine, since };
}

export type UsageByPerson = UsageTotals & { user_id: string | null; name: string | null; email: string | null };

/** Per person in this business since `since`, heaviest first. */
export async function usageByPerson(tx: Tx, since = monthStart()): Promise<UsageByPerson[]> {
  return tx.query<UsageByPerson>(
    `select x.user_id, u.name, u.email::text as email,
            count(*) as attempts,
            (count(*) filter (where x.outcome = 'version')) as versions,
            coalesce(sum(x.input_tokens), 0) as input_tokens,
            coalesce(sum(x.output_tokens), 0) as output_tokens,
            coalesce(sum(x.images), 0) as images
       from ai_usage x left join users u on u.id = x.user_id
      where x.created_at >= $1
      group by x.user_id, u.name, u.email
      order by coalesce(sum(x.input_tokens), 0) + coalesce(sum(x.output_tokens), 0) desc`,
    [since],
  );
}
