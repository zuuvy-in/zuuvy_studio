/**
 * One component per block type. Everything here is a server component: a
 * published site ships HTML and CSS, no JavaScript, which is what makes it
 * fast on a cheap phone on a slow connection.
 */
import type { BlockProps, BlockType, Link as LinkT } from "@zsite/core";
import type { ReactNode } from "react";
import type { ProductView, RenderContext } from "./context";

type P<T extends BlockType> = { props: BlockProps<T>; ctx: RenderContext; id: string };

function A({ link, ctx, className }: { link: LinkT; ctx: RenderContext; className?: string }) {
  return (
    <a href={ctx.href(link.href)} className={className}>
      {link.label}
    </a>
  );
}

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i}>{p}</p>
        ))}
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

function Hero({ props, ctx, id }: P<"hero">) {
  return (
    <section id={id} className={`zs-hero zs-hero-${props.align} ${props.image ? "zs-hero-image" : ""}`}>
      <div className="zs-container zs-hero-inner">
        <div className="zs-hero-copy">
          {props.eyebrow && <p className="zs-eyebrow">{props.eyebrow}</p>}
          <h1>{props.heading}</h1>
          {props.subheading && <p className="zs-lede">{props.subheading}</p>}
          {(props.primaryCta || props.secondaryCta) && (
            <div className="zs-actions">
              {props.primaryCta && <A link={props.primaryCta} ctx={ctx} className="zs-btn zs-btn-primary" />}
              {props.secondaryCta && <A link={props.secondaryCta} ctx={ctx} className="zs-btn zs-btn-ghost" />}
            </div>
          )}
        </div>
        {props.image && <Img src={props.image} alt={props.heading} className="zs-hero-img" />}
      </div>
    </section>
  );
}

function Features({ props, id }: P<"features">) {
  return (
    <Section id={id}>
      <Heading heading={props.heading} subheading={props.subheading} center />
      <div className={`zs-grid zs-cols-${props.columns}`}>
        {props.items.map((item, i) => (
          <div key={i} className="zs-card zs-feature">
            <span className="zs-feature-mark" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
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
        <Img src={props.image} alt={props.heading} className="zs-split-img" />
        <div className="zs-prose">
          <h2>{props.heading}</h2>
          <Paragraphs text={props.body} />
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
  return (
    <Section id={id}>
      <Heading heading={props.heading} />
      <div className={`zs-grid zs-cols-${props.columns}`}>
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

function Testimonials({ props, id }: P<"testimonials">) {
  return (
    <Section id={id} className="zs-surface">
      <Heading heading={props.heading} center />
      <div className={`zs-grid zs-cols-${Math.min(3, props.items.length)}`}>
        {props.items.map((t, i) => (
          <figure key={i} className="zs-card zs-quote">
            <blockquote>“{t.quote}”</blockquote>
            <figcaption>
              <strong>{t.author}</strong>
              {t.role && <span>{t.role}</span>}
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}

function Stats({ props, id }: P<"stats">) {
  return (
    <Section id={id} className="zs-stats-section">
      <dl className={`zs-stats zs-cols-${Math.min(4, props.items.length)}`}>
        {props.items.map((s, i) => (
          <div key={i}>
            <dt>{s.label}</dt>
            <dd>{s.value}</dd>
          </div>
        ))}
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
  return (
    <Section id={id}>
      <div className="zs-cta">
        <h2>{props.heading}</h2>
        {props.body && <p>{props.body}</p>}
        <A link={props.button} ctx={ctx} className="zs-btn zs-btn-invert" />
      </div>
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

type AnySection = { id: string; type: BlockType; props: unknown };

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
  collection: Collection,
} as const;

export function blockSwitch(section: AnySection, ctx: RenderContext) {
  const Component = COMPONENTS[section.type] as (p: { props: unknown; ctx: RenderContext; id: string }) => ReactNode;
  if (!Component) return null;
  return <Component key={section.id} id={section.id} props={section.props} ctx={ctx} />;
}
