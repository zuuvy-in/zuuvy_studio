/**
 * One component per block type. Everything here is a server component: a
 * published site ships HTML and CSS, no JavaScript, which is what makes it
 * fast on a cheap phone on a slow connection.
 */
import type { BlockProps, BlockType, Link as LinkT, SectionStyle } from "@zsite/core";
import type { ReactNode } from "react";
import type { ProductView, RenderContext } from "./context";
import { SiteIcon } from "./icons";

type P<T extends BlockType> = { props: BlockProps<T>; ctx: RenderContext; id: string };

function A({ link, ctx, className }: { link: LinkT; ctx: RenderContext; className?: string }) {
  return (
    <a href={ctx.href(link.href)} className={className}>
      {link.label}
    </a>
  );
}

/** Blank lines separate paragraphs; a run of lines starting "- " or "• " is a list. Never HTML. */
function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => {
          const lines = p.split("\n").map((l) => l.trim());
          if (lines.every((l) => /^[-•*]\s+/.test(l))) {
            return (
              <ul key={i} className="zs-list">
                {lines.map((l, j) => (
                  <li key={j}>{l.replace(/^[-•*]\s+/, "")}</li>
                ))}
              </ul>
            );
          }
          return <p key={i}>{p}</p>;
        })}
    </>
  );
}

/** Where an image would be: a soft gradient with the subject's initials. */
export function Placeholder({ label, className }: { label: string; className?: string }) {
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <div className={`zs-placeholder ${className ?? ""}`} aria-hidden="true">
      <span>{initials}</span>
    </div>
  );
}

function Img({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  if (!src) return <Placeholder label={alt} className={className} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} loading="lazy" />;
}

function Section({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={`zs-section ${className ?? ""}`}>
      <div className="zs-container">{children}</div>
    </section>
  );
}

function Heading({ heading, subheading, center }: { heading?: string; subheading?: string; center?: boolean }) {
  if (!heading && !subheading) return null;
  return (
    <header className={`zs-section-head ${center ? "zs-center" : ""}`}>
      {heading && <h2>{heading}</h2>}
      {subheading && <p className="zs-lede">{subheading}</p>}
    </header>
  );
}

/** Paint `highlight` (words from the heading) in the brand gradient. */
function Highlighted({ text, highlight }: { text: string; highlight?: string }) {
  const at = highlight ? text.indexOf(highlight) : -1;
  if (!highlight || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="zs-gradient-text">{highlight}</span>
      {text.slice(at + highlight.length)}
    </>
  );
}

function Hero({ props, ctx, id }: P<"hero">) {
  const layout = props.layout ?? "classic";
  const words = props.rotating?.filter(Boolean) ?? [];
  const copy = (
    <div className="zs-hero-copy">
      {props.eyebrow && <p className="zs-eyebrow">{props.eyebrow}</p>}
      <h1>
        <Highlighted text={props.heading} highlight={props.highlight} />
        {words.length > 0 && (
          <>
            {" "}
            <span className="zs-rotator" data-n={Math.min(words.length, 5)}>
              <span className="zs-rotator-track">
                {[...words, words[0]].map((w, i) => (
                  <span key={i} aria-hidden={i > 0 || undefined}>{w}</span>
                ))}
              </span>
            </span>
          </>
        )}
      </h1>
      {props.subheading && <p className="zs-lede">{props.subheading}</p>}
      {(props.primaryCta || props.secondaryCta) && (
        <div className="zs-actions">
          {props.primaryCta && <A link={props.primaryCta} ctx={ctx} className="zs-btn zs-btn-primary" />}
          {props.secondaryCta && <A link={props.secondaryCta} ctx={ctx} className="zs-btn zs-btn-ghost" />}
        </div>
      )}
      {props.badges && props.badges.length > 0 && (
        <ul className="zs-hero-badges">
          {props.badges.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <section
      id={id}
      className={`zs-hero zs-hero-${props.align} ${props.image ? "zs-hero-image" : ""}`}
      data-layout={layout}
      data-backdrop={props.backdrop ?? "glow"}
      style={layout === "fullbleed" && props.image ? { ["--zs-hero-bg" as string]: `url("${props.image.replace(/"/g, "%22")}")` } : undefined}
    >
      <div className="zs-container zs-hero-inner">
        {copy}
        {props.image && layout !== "fullbleed" && <Img src={props.image} alt={props.heading} className="zs-hero-img" />}
      </div>
    </section>
  );
}

function Features({ props, id }: P<"features">) {
  const layout = props.layout ?? "cards";
  return (
    <Section id={id}>
      <Heading heading={props.heading} subheading={props.subheading} center />
      <div className={`zs-grid zs-cols-${props.columns} zs-features-${layout}`}>
        {props.items.map((item, i) => (
          <div key={i} className={layout === "cards" || layout === "bento" ? "zs-card zs-feature" : "zs-feature"}>
            {item.icon ? (
              <span className="zs-feature-icon">
                <SiteIcon name={item.icon} size={layout === "list" ? 20 : 24} />
              </span>
            ) : layout === "list" ? (
              <span className="zs-feature-icon"><SiteIcon name="check" size={20} /></span>
            ) : (
              <span className="zs-feature-mark" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
            )}
            <div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

type Card = ProductView & { groupCard?: { id: string; variants: number; fromPrice: boolean } };

/** Variants of one group become one card: the group's name and photo, the lowest price, in stock if any variant is. */
export function productCards(products: ProductView[]): Card[] {
  const out: Card[] = [];
  const groups = new Map<string, Card>();
  for (const p of products) {
    if (!p.group) {
      out.push(p);
      continue;
    }
    const seen = groups.get(p.group.id);
    if (!seen) {
      const card: Card = {
        ...p,
        id: p.group.id,
        name: p.group.name,
        images: [...p.group.images, ...p.images],
        groupCard: { id: p.group.id, variants: 1, fromPrice: false },
      };
      groups.set(p.group.id, card);
      out.push(card);
      continue;
    }
    seen.groupCard!.variants++;
    if (p.price !== null && (seen.price === null || p.price !== seen.price)) seen.groupCard!.fromPrice = true;
    if (p.price !== null && (seen.price === null || p.price < seen.price)) {
      seen.price = p.price;
      seen.mrp = p.mrp;
    }
    if (p.inStock) seen.inStock = true;
    if (!seen.images.length) seen.images = p.images;
  }
  return out;
}

function ProductGrid({ props, ctx, id }: P<"productGrid">) {
  let items = productCards(ctx.products).filter((p) => !props.category || (p.category ?? "").toLowerCase() === props.category.toLowerCase());
  items = [...items].sort((a, b) => {
    switch (props.sort) {
      case "price_asc":
        return (a.price ?? Infinity) - (b.price ?? Infinity);
      case "price_desc":
        return (b.price ?? -Infinity) - (a.price ?? -Infinity);
      case "newest":
        return 0;
      default:
        return a.name.localeCompare(b.name);
    }
  });
  items = items.slice(0, props.limit);
  return (
    <Section id={id}>
      <Heading heading={props.heading} subheading={props.subheading} center />
      {items.length === 0 ? (
        <p className="zs-empty">
          {ctx.mode === "preview"
            ? "No products yet — add them under Products, or connect Zuuvy in Integrations."
            : "New products are on their way. Check back soon."}
        </p>
      ) : (
        <div className={`zs-grid zs-cols-${props.columns} zs-products`}>
          {items.map((p) => {
            const href = p.groupCard ? ctx.groupHref?.(p.groupCard.id) : ctx.productHref?.(p.id);
            const body = (
              <>
                <div className="zs-product-media">
                  <Img src={p.images[0]} alt={p.name} className="zs-product-img" />
                  {!p.inStock && <span className="zs-badge">{p.backorders ? "Made to order" : "Out of stock"}</span>}
                </div>
                <div className="zs-product-body">
                  {p.category && <p className="zs-product-cat">{p.category}</p>}
                  <h3>{p.name}</h3>
                  {props.showPrices && p.price !== null && (
                    <p className="zs-price">
                      {p.groupCard?.fromPrice && <span className="zs-from">from </span>}
                      {inr(p.price)}
                      {p.mrp !== null && p.mrp > p.price && <s>{inr(p.mrp)}</s>}
                    </p>
                  )}
                  {p.groupCard && p.groupCard.variants > 1 && <p className="zs-muted zs-small">{p.groupCard.variants} options</p>}
                </div>
              </>
            );
            const action = !p.groupCard && ctx.cardAction ? ctx.cardAction(p) : null;
            return (
              <div key={p.id} className="zs-card zs-product">
                {href ? (
                  <a href={href} className="zs-product-link">
                    {body}
                  </a>
                ) : (
                  body
                )}
                {action && <div className="zs-product-action">{action}</div>}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function RichText({ props, id }: P<"richText">) {
  return (
    <Section id={id} className="zs-prose-section">
      <div className="zs-prose">
        {props.heading && <h2>{props.heading}</h2>}
        <Paragraphs text={props.body} />
      </div>
    </Section>
  );
}

function ImageText({ props, ctx, id }: P<"imageText">) {
  return (
    <Section id={id}>
      <div className={`zs-split zs-split-${props.imageSide}`}>
        <div className="zs-split-media">
          <Img src={props.image} alt={props.heading} className="zs-split-img" />
          {props.badge && <span className="zs-float-badge">{props.badge}</span>}
        </div>
        <div className="zs-prose">
          {props.eyebrow && <p className="zs-eyebrow">{props.eyebrow}</p>}
          <h2>{props.heading}</h2>
          <Paragraphs text={props.body} />
          {props.bullets && props.bullets.length > 0 && (
            <ul className="zs-bullets">
              {props.bullets.map((b, i) => (
                <li key={i}>
                  <SiteIcon name={b.icon ?? "circle-check"} size={20} />
                  <span>{b.text}</span>
                </li>
              ))}
            </ul>
          )}
          {props.cta && (
            <div className="zs-actions">
              <A link={props.cta} ctx={ctx} className="zs-btn zs-btn-primary" />
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function Gallery({ props, ctx, id }: P<"gallery">) {
  const layout = props.layout ?? "grid";
  return (
    <Section id={id}>
      <Heading heading={props.heading} />
      <div className={layout === "grid" ? `zs-grid zs-cols-${props.columns}` : `zs-gallery-${layout} zs-cols-${props.columns}`}>
        {props.items.map((item, i) => {
          const inner = (
            <>
              <Img src={item.image} alt={item.title} className="zs-gallery-img" />
              <div className="zs-gallery-meta">
                <h3>{item.title}</h3>
                {item.caption && <p>{item.caption}</p>}
              </div>
            </>
          );
          return item.href ? (
            <a key={i} href={ctx.href(item.href)} className="zs-gallery-item">
              {inner}
            </a>
          ) : (
            <div key={i} className="zs-gallery-item">
              {inner}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function Stars({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="zs-stars" aria-label={`${n} out of 5`}>
      {"★★★★★".slice(0, n)}
      <span aria-hidden="true">{"★★★★★".slice(n)}</span>
    </span>
  );
}

function Testimonials({ props, id }: P<"testimonials">) {
  const layout = props.layout ?? "cards";
  const quote = (t: (typeof props.items)[number], i: number, extra = "") => (
    <figure key={i} className={`zs-card zs-quote ${extra}`}>
      <Stars n={t.rating} />
      <blockquote>“{t.quote}”</blockquote>
      <figcaption>
        <span className="zs-avatar" aria-hidden="true">{t.author.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
        <span>
          <strong>{t.author}</strong>
          {t.role && <span>{t.role}</span>}
        </span>
      </figcaption>
    </figure>
  );
  return (
    <Section id={id} className="zs-surface">
      <Heading heading={props.heading} center />
      {layout === "marquee" ? (
        <div className="zs-marquee-wrap">
          <div className="zs-marquee-track zs-quote-track">
            {[...props.items, ...props.items].map((t, i) => (
              <div key={i} aria-hidden={i >= props.items.length || undefined}>
                {quote(t, i)}
              </div>
            ))}
          </div>
        </div>
      ) : layout === "spotlight" ? (
        <div className="zs-spotlight">
          {props.items[0] && quote(props.items[0], 0, "zs-quote-big")}
          {props.items.length > 1 && <div className={`zs-grid zs-cols-${Math.min(3, props.items.length - 1)}`}>{props.items.slice(1).map((t, i) => quote(t, i + 1))}</div>}
        </div>
      ) : (
        <div className={`zs-grid zs-cols-${Math.min(3, props.items.length)}`}>{props.items.map((t, i) => quote(t, i))}</div>
      )}
    </Section>
  );
}

/** "12,000+" → 12000 with "+" after; values that do not start with a number are shown as written. */
function countable(value: string): { n: number; before: string; after: string; decimals: number } | null {
  const m = value.match(/^([^\d]*)(\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  const digits = m[2]!.replace(/,/g, "");
  const n = Number(digits);
  if (!Number.isFinite(n) || n > 1e9) return null;
  return { n, before: m[1]!, after: m[3]!, decimals: digits.includes(".") ? digits.split(".")[1]!.length : 0 };
}

function Stats({ props, id }: P<"stats">) {
  return (
    <Section id={id} className="zs-stats-section">
      {props.heading && <Heading heading={props.heading} center />}
      <dl className={`zs-stats zs-cols-${Math.min(4, props.items.length)}`}>
        {props.items.map((s, i) => {
          const c = countable(s.value);
          return (
            <div key={i}>
              <dt>{s.label}</dt>
              <dd>
                {s.icon && <SiteIcon name={s.icon} className="zs-stat-icon" size={22} />}
                {c && c.decimals === 0 && !s.value.includes(",") ? (
                  // Counts up in browsers that animate registered properties; the number is always in the text too.
                  <span className="zs-count" style={{ ["--to" as string]: c.n }} data-before={c.before} data-after={c.after}>
                    <span className="zs-count-text">{s.value}</span>
                  </span>
                ) : (
                  s.value
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </Section>
  );
}

function Faq({ props, id }: P<"faq">) {
  return (
    <Section id={id}>
      <div className="zs-narrow">
        <Heading heading={props.heading} center />
        <div className="zs-faq">
          {props.items.map((f, i) => (
            <details key={i}>
              <summary>{f.question}</summary>
              <Paragraphs text={f.answer} />
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

function Cta({ props, ctx, id }: P<"cta">) {
  const style = props.style ?? "banner";
  return (
    <Section id={id}>
      <div className={`zs-cta zs-cta-${style}`}>
        <div>
          <h2>{props.heading}</h2>
          {props.body && <p>{props.body}</p>}
        </div>
        <div className="zs-actions">
          <A link={props.button} ctx={ctx} className={`zs-btn ${style === "minimal" ? "zs-btn-primary" : "zs-btn-invert"}`} />
          {props.secondary && <A link={props.secondary} ctx={ctx} className="zs-btn zs-btn-ghost" />}
        </div>
      </div>
    </Section>
  );
}

function Logos({ props, ctx, id }: P<"logos">) {
  const item = (l: (typeof props.items)[number], i: number, hidden?: boolean) => {
    const inner = l.image ? <img src={l.image} alt={hidden ? "" : l.name} loading="lazy" /> : <span>{l.name}</span>;
    return l.href && !hidden ? (
      <a key={i} href={ctx.href(l.href)} className="zs-logo">{inner}</a>
    ) : (
      <div key={i} className="zs-logo" aria-hidden={hidden || undefined}>{inner}</div>
    );
  };
  return (
    <Section id={id} className="zs-logos-section">
      {props.heading && <p className="zs-logos-heading">{props.heading}</p>}
      {props.marquee ? (
        <div className="zs-marquee-wrap">
          <div className="zs-marquee-track">
            {props.items.map((l, i) => item(l, i))}
            {props.items.map((l, i) => item(l, i + props.items.length, true))}
          </div>
        </div>
      ) : (
        <div className="zs-logo-row">{props.items.map((l, i) => item(l, i))}</div>
      )}
    </Section>
  );
}

function Marquee({ props, id }: P<"marquee">) {
  const run = (hidden: boolean) =>
    props.items.map((t, i) => (
      <span key={`${hidden}-${i}`} className="zs-band-item" aria-hidden={hidden || undefined}>
        {t}
        <SiteIcon name={props.icon ?? "sparkle"} size={18} />
      </span>
    ));
  return (
    <section id={id} className={`zs-band zs-band-${props.tone}`} data-speed={props.speed}>
      <div className="zs-marquee-wrap">
        <div className="zs-marquee-track">
          {run(false)}
          {run(true)}
        </div>
      </div>
    </section>
  );
}

function Steps({ props, id }: P<"steps">) {
  return (
    <Section id={id}>
      <Heading heading={props.heading} subheading={props.subheading} center />
      <ol className={`zs-steps-block zs-steps-${props.layout} zs-cols-${Math.min(4, props.items.length)}`}>
        {props.items.map((step, i) => (
          <li key={i} className={props.layout === "cards" ? "zs-card" : undefined}>
            <span className="zs-step-badge">{step.icon ? <SiteIcon name={step.icon} size={22} /> : i + 1}</span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Contact({ props, id }: P<"contact">) {
  const wa = props.whatsapp?.replace(/\D/g, "");
  const waNumber = wa && wa.length === 10 ? `91${wa}` : wa;
  return (
    <Section id={id} className="zs-surface">
      <div className="zs-contact">
        <div>
          <h2>{props.heading}</h2>
          {props.body && <p className="zs-lede">{props.body}</p>}
        </div>
        <ul className="zs-contact-list">
          {props.phone && (
            <li>
              <span>Call</span>
              <a href={`tel:${props.phone.replace(/[^\d+]/g, "")}`}>{props.phone}</a>
            </li>
          )}
          {waNumber && (
            <li>
              <span>WhatsApp</span>
              <a href={`https://wa.me/${waNumber}`}>Message us</a>
            </li>
          )}
          {props.email && (
            <li>
              <span>Email</span>
              <a href={`mailto:${props.email}`}>{props.email}</a>
            </li>
          )}
          {props.address && (
            <li>
              <span>Visit</span>
              <address>{props.address}</address>
            </li>
          )}
          {!props.phone && !waNumber && !props.email && !props.address && (
            <li className="zs-muted">Contact details coming soon.</li>
          )}
        </ul>
      </div>
    </Section>
  );
}

type AnySection = { id: string; type: BlockType; props: unknown; style?: SectionStyle };

// ---------------------------------------------------------------------------
// Collections: data drawn in one of a few layouts. Every field is optional
// except the collection's title field, so each layout checks before drawing.
// ---------------------------------------------------------------------------

type Item = Record<string, unknown> & { id?: string };
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
const years = (i: Item) => [str(i.start), str(i.end)].filter(Boolean).join(" – ") || (i.year ? String(i.year) : undefined);

const SOCIALS: [string, string][] = [
  ["website", "Website"], ["linkedin", "LinkedIn"], ["github", "GitHub"], ["instagram", "Instagram"], ["behance", "Portfolio"], ["resume", "Résumé"],
];

function About({ item, ctx }: { item: Item; ctx: RenderContext }) {
  const name = str(item.name) ?? "";
  return (
    <div className="zs-about">
      <Img src={str(item.photo)} alt={name} className="zs-about-photo" />
      <div>
        <h2>{name}</h2>
        {str(item.headline) && <p className="zs-lede">{str(item.headline)}</p>}
        {str(item.location) && <p className="zs-muted">{str(item.location)}</p>}
        {str(item.bio) && <Paragraphs text={str(item.bio)!} />}
        <div className="zs-actions">
          {str(item.email) && <a className="zs-btn zs-btn-primary" href={`mailto:${str(item.email)}`}>Email me</a>}
          {SOCIALS.filter(([k]) => str(item[k])).map(([k, label]) => (
            <a key={k} className="zs-btn zs-btn-ghost" href={ctx.href(str(item[k])!)} target="_blank" rel="noreferrer">{label}</a>
          ))}
        </div>
      </div>
    </div>
  );
}

function CollectionItem({ item, layout, titleField, ctx }: { item: Item; layout: string; titleField: string; ctx: RenderContext }) {
  const title = str(item[titleField]) ?? "";
  const image = str(item.image) ?? str(item.logo);
  const sub = [str(item.organisation), str(item.institution), str(item.client), str(item.issuer), str(item.venue), str(item.role) !== title ? str(item.role) : undefined, str(item.group)]
    .filter(Boolean)
    .join(" · ");
  const body = str(item.summary) ?? str(item.description) ?? str(item.details);
  const link = str(item.link);
  const tags = Array.isArray(item.tags) ? (item.tags as string[]) : [];
  if (layout === "chips") return <span className="zs-chip">{title}{str(item.level) && <em> · {str(item.level)}</em>}</span>;
  if (layout === "timeline") {
    return (
      <li className="zs-timeline-item">
        <span className="zs-timeline-when">{years(item)}</span>
        <div>
          <h3>{title}</h3>
          {sub && <p className="zs-muted">{sub}</p>}
          {body && <Paragraphs text={body} />}
        </div>
      </li>
    );
  }
  if (typeof item.quote === "string") {
    return (
      <figure className="zs-card zs-quote">
        <blockquote>“{item.quote}”</blockquote>
        <figcaption><strong>{str(item.author)}</strong>{str(item.role) && <span> · {str(item.role)}</span>}</figcaption>
      </figure>
    );
  }
  const inner = (
    <>
      {(layout === "cards" || layout === "grid") && (image || layout === "cards") && <Img src={image} alt={title} className="zs-collection-media" />}
      <div className="zs-collection-body">
        <h3>{title}</h3>
        {sub && <p className="zs-muted">{sub}</p>}
        {layout !== "grid" && body && <p>{body}</p>}
        {str(item.price) && <p className="zs-price">{str(item.price)}</p>}
        {years(item) && layout === "list" && <p className="zs-muted">{years(item)}</p>}
        {tags.length > 0 && <p className="zs-tags">{tags.map((t) => <span key={t} className="zs-chip">{t}</span>)}</p>}
      </div>
    </>
  );
  return link ? (
    <a href={ctx.href(link)} className={`zs-card zs-collection-item zs-collection-${layout}`} target={link.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
      {inner}
    </a>
  ) : (
    <div className={`zs-card zs-collection-item zs-collection-${layout}`}>{inner}</div>
  );
}

const DEFAULT_LAYOUT: Record<string, string> = {
  profile: "about", projects: "cards", experience: "timeline", education: "timeline", skills: "chips",
  services: "cards", testimonials: "cards", awards: "list", publications: "list", clients: "grid", gallery: "grid",
};
const TITLE_FIELD: Record<string, string> = {
  profile: "name", projects: "title", experience: "role", education: "qualification", skills: "name", services: "title",
  testimonials: "author", awards: "title", publications: "title", clients: "name", gallery: "caption",
};

function Collection({ props, ctx, id }: P<"collection">) {
  const items = (ctx.data?.[props.collection] ?? []).slice(0, props.limit ?? 60) as Item[];
  const layout = props.layout ?? DEFAULT_LAYOUT[props.collection] ?? "cards";
  if (!items.length) {
    // An empty collection shows nothing on a live site; the preview says why.
    if (ctx.mode === "live") return null;
    return (
      <Section id={id}>
        <Heading heading={props.heading} subheading={props.subheading} />
        <p className="zs-muted">No {props.collection} yet — add them under Content in the studio, or ask the AI.</p>
      </Section>
    );
  }
  if (layout === "about") {
    return (
      <Section id={id}>
        <Heading heading={props.heading} subheading={props.subheading} />
        <About item={items[0]!} ctx={ctx} />
      </Section>
    );
  }
  const titleField = TITLE_FIELD[props.collection] ?? "title";
  const list = items.map((item, i) => <CollectionItem key={item.id ?? i} item={item} layout={layout} titleField={titleField} ctx={ctx} />);
  return (
    <Section id={id} className={layout === "chips" || layout === "timeline" ? "" : "zs-surface"}>
      <Heading heading={props.heading} subheading={props.subheading} center={layout !== "timeline"} />
      {layout === "timeline" ? (
        <ol className="zs-timeline">{list}</ol>
      ) : layout === "chips" ? (
        <div className="zs-chips">{list}</div>
      ) : (
        <div className={`zs-grid zs-cols-${layout === "list" ? 2 : layout === "grid" ? 4 : 3}`}>{list}</div>
      )}
    </Section>
  );
}

function Field({ f }: { f: BlockProps<"form">["fields"][number] }) {
  const common = { name: f.name, required: f.required, placeholder: f.placeholder };
  if (f.type === "checkbox") {
    return (
      <label className="zs-check" data-width="full">
        <input type="checkbox" name={f.name} value="1" required={f.required} /> <span>{f.label}</span>
      </label>
    );
  }
  return (
    <label data-width={f.width}>
      <span>
        {f.label}
        {!f.required && <span className="zs-optional"> (optional)</span>}
      </span>
      {f.type === "textarea" ? (
        <textarea rows={4} {...common} />
      ) : f.type === "select" ? (
        <select name={f.name} required={f.required} defaultValue="">
          <option value="" disabled>
            {f.placeholder ?? "Choose…"}
          </option>
          {(f.options ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input type={f.type} {...common} autoComplete={f.type === "email" ? "email" : f.type === "tel" ? "tel" : f.name === "name" ? "name" : undefined} />
      )}
    </label>
  );
}

function Form({ props, ctx, id }: P<"form">) {
  const status = ctx.forms?.status?.section === id ? ctx.forms.status : undefined;
  const toUrl = props.destination.kind === "url";
  const live = Boolean(ctx.forms) || toUrl;
  const form = status?.ok ? (
    <p className="zs-ok" role="status">
      {props.successMessage}
    </p>
  ) : (
    <form
      className="zs-form zs-site-form"
      method={toUrl ? "get" : "post"}
      action={toUrl ? (props.destination as { url: string }).url : live ? ctx.forms!.action : undefined}
    >
      {!toUrl && (
        <>
          <input type="hidden" name="_section" value={id} />
          <input type="hidden" name="_page" value={ctx.forms?.page ?? "/"} />
          <input type="hidden" name="_t" value={ctx.forms?.renderedAt ?? 0} />
          {/* People never see this field; form-filling bots do. */}
          <input type="text" name="_website" tabIndex={-1} autoComplete="off" className="zs-hp" aria-hidden="true" />
        </>
      )}
      <div className="zs-form-fields">
        {props.fields.map((f) => (
          <Field key={f.name} f={f} />
        ))}
      </div>
      {status?.error && (
        <p className="zs-alert" role="alert">
          {status.error}
        </p>
      )}
      <button type={live ? "submit" : "button"} className="zs-btn zs-btn-primary">
        {props.submitLabel}
      </button>
      {!live && <p className="zs-muted zs-small">Preview — the form sends on the live site.</p>}
    </form>
  );
  if (props.layout === "split") {
    return (
      <Section id={id}>
        <div className="zs-form-split">
          <div>
            <Heading heading={props.heading} subheading={props.subheading} />
            {props.aside && <p className="zs-muted">{props.aside}</p>}
          </div>
          <div className="zs-card">{form}</div>
        </div>
      </Section>
    );
  }
  return (
    <Section id={id}>
      <div className="zs-narrow">
        <Heading heading={props.heading} subheading={props.subheading} center />
        {props.layout === "card" ? <div className="zs-card">{form}</div> : form}
      </div>
    </Section>
  );
}

function Table({ props, id }: P<"table">) {
  return (
    <Section id={id}>
      <Heading heading={props.heading} subheading={props.subheading} center />
      <div className={`zs-table-wrap zs-table-${props.style}`}>
        <table className={`zs-table ${props.highlightFirst ? "zs-table-first" : ""}`}>
          <thead>
            <tr>
              {props.columns.map((c, i) => (
                <th key={i} scope="col">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row, r) => (
              <tr key={r}>
                {props.columns.map((c, i) =>
                  i === 0 && props.highlightFirst ? (
                    <th key={i} scope="row" data-label={c}>{row[i] ?? ""}</th>
                  ) : (
                    <td key={i} data-label={c}>{row[i] ?? ""}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {props.caption && <p className="zs-muted zs-small zs-table-caption">{props.caption}</p>}
      </div>
    </Section>
  );
}

const COMPONENTS = {
  hero: Hero,
  features: Features,
  productGrid: ProductGrid,
  richText: RichText,
  imageText: ImageText,
  gallery: Gallery,
  testimonials: Testimonials,
  stats: Stats,
  faq: Faq,
  cta: Cta,
  contact: Contact,
  logos: Logos,
  marquee: Marquee,
  steps: Steps,
  form: Form,
  table: Table,
  collection: Collection,
} as const;

/**
 * Every section sits in a wrapper that carries its style — background,
 * texture, lower edge, spacing, entrance — so the blocks themselves stay
 * about content and one set of rules draws the look.
 */
export function blockSwitch(section: AnySection, ctx: RenderContext) {
  const Component = COMPONENTS[section.type] as (p: { props: unknown; ctx: RenderContext; id: string }) => ReactNode;
  if (!Component) return null;
  const st = section.style ?? {};
  const image = st.background === "image" && st.image ? st.image : null;
  return (
    <div
      key={section.id}
      className="zs-block"
      data-section={section.id}
      data-type={section.type}
      data-bg={st.background && st.background !== "default" ? st.background : undefined}
      data-pattern={st.pattern && st.pattern !== "none" ? st.pattern : undefined}
      data-divider={st.divider && st.divider !== "none" ? st.divider : undefined}
      data-spacing={st.spacing && st.spacing !== "normal" ? st.spacing : undefined}
      data-anim={st.animation && st.animation !== "auto" ? st.animation : undefined}
      style={image ? { ["--zs-section-image" as string]: `url("${image.replace(/"/g, "%22")}")` } : undefined}
    >
      <Component id={section.id} props={section.props} ctx={ctx} />
    </div>
  );
}
