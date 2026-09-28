/**
 * Built-in templates. A template is a function from a few facts about the
 * business to a complete site tree — the marketplace's templates will be the
 * same thing, stored as data with `{{businessName}}`-style slots.
 */
import { type SiteData, parseData } from "../data";
import { SCHEMA_VERSION, type SiteTree, newId, parseTree } from "../tree";

export type SiteKind = "landing" | "portfolio" | "store";

export type TemplateInput = {
  businessName: string;
  tagline?: string;
  email?: string;
  phone?: string;
};

export type Template = {
  id: string;
  name: string;
  kind: SiteKind;
  description: string;
  build: (input: TemplateInput) => SiteTree;
  /** Starting data for the site's collections (a portfolio's profile and sample entries). */
  data?: (input: TemplateInput) => SiteData;
};

const year = () => new Date().getFullYear();

function footer(name: string) {
  return { text: `© ${year()} ${name}. All rights reserved.`, links: [] };
}

const store: Template = {
  id: "store-classic",
  name: "Classic store",
  kind: "store",
  description: "A storefront with a hero, your catalogue and a way to reach you. Products come from Zuuvy.",
  build: ({ businessName, tagline, email, phone }) =>
    parseTree({
      schemaVersion: SCHEMA_VERSION,
      meta: {
        title: businessName,
        description: tagline ?? `Shop ${businessName} online — order in a few taps.`,
      },
      theme: {
        colors: {
          primary: "#1f4fd8",
          background: "#ffffff",
          surface: "#f4f6fb",
          text: "#0f172a",
          muted: "#64748b",
          accent: "#f59e0b",
        },
        fonts: { heading: "Manrope", body: "Inter" },
        radius: "md",
      },
      nav: {
        brand: businessName,
        links: [
          { label: "Shop", href: "/#shop" },
          { label: "About", href: "/about" },
          { label: "Contact", href: "/#contact" },
        ],
        cta: { label: "Order now", href: "/#shop" },
      },
      footer: footer(businessName),
      pages: [
        {
          id: newId("p"),
          path: "/",
          title: "Home",
          sections: [
            {
              id: newId("s"),
              type: "hero",
              props: {
                eyebrow: "Now taking orders online",
                heading: tagline ?? `Everything from ${businessName}, delivered`,
                highlight: tagline ? undefined : "delivered",
                subheading: "Browse the range, place your order, and we'll confirm it with you directly.",
                primaryCta: { label: "Start shopping", href: "/#shop" },
                align: "center",
                layout: "stacked",
                backdrop: "mesh",
                badges: ["Cash on delivery", "Genuine products", "Help on WhatsApp"],
              },
            },
            {
              id: newId("s"),
              type: "marquee",
              props: { items: ["Pay on delivery", "Genuine products", "Fast local delivery", "Easy returns"], icon: "sparkle", speed: "normal", tone: "primary" },
            },
            {
              id: "shop",
              type: "productGrid",
              props: { heading: "Shop the range", limit: 12, sort: "name", showPrices: true, columns: 3 },
            },
            {
              id: newId("s"),
              type: "features",
              style: { background: "surface", pattern: "dots" },
              props: {
                heading: "Why order from us",
                columns: 3,
                layout: "bento",
                items: [
                  { title: "Genuine products", body: "Sourced directly and backed by the manufacturer's warranty.", icon: "badge-check" },
                  { title: "Pay on delivery", body: "Order now and pay when it reaches you.", icon: "wallet" },
                  { title: "Real people", body: "Questions? Our team answers on WhatsApp.", icon: "message-circle" },
                  { title: "Delivered fast", body: "Local orders leave the shop the same day.", icon: "truck" },
                ],
              },
            },
            {
              id: newId("s"),
              type: "steps",
              props: {
                heading: "Ordering takes a minute",
                layout: "cards",
                items: [
                  { title: "Pick what you need", body: "Add it to your bag — no account needed.", icon: "shopping-bag" },
                  { title: "We confirm", body: "The shop checks stock and confirms your order.", icon: "circle-check" },
                  { title: "Pay on delivery", body: "It reaches your door; pay when it does.", icon: "truck" },
                ],
              },
            },
            {
              id: newId("s"),
              type: "cta",
              props: { heading: "Found something you like?", body: "Order in a few taps — pay when it arrives.", button: { label: "Start shopping", href: "/#shop" }, style: "glow" },
            },
            {
              id: "contact",
              type: "contact",
              props: {
                heading: "Get in touch",
                body: "Call, message or drop by — we're happy to help.",
                ...(email ? { email } : {}),
                ...(phone ? { phone, whatsapp: phone } : {}),
              },
            },
          ],
        },
        {
          id: newId("p"),
          path: "/about",
          title: "About",
          sections: [
            {
              id: newId("s"),
              type: "richText",
              props: {
                heading: `About ${businessName}`,
                body: `${businessName} has served its customers for years. This page is yours to tell that story — ask the AI to write it from a few facts.`,
              },
            },
          ],
        },
      ],
    }),
};

const landing: Template = {
  id: "landing-launch",
  name: "Launch landing page",
  kind: "landing",
  description: "One page that explains what you do and gets people to act.",
  build: ({ businessName, tagline, email, phone }) =>
    parseTree({
      schemaVersion: SCHEMA_VERSION,
      meta: { title: businessName, description: tagline ?? `${businessName} — what we do and how to reach us.` },
      theme: {
        colors: {
          primary: "#7c3aed",
          background: "#ffffff",
          surface: "#f6f3ff",
          text: "#111827",
          muted: "#6b7280",
          accent: "#10b981",
        },
        fonts: { heading: "Space Grotesk", body: "Inter" },
        radius: "lg",
      },
      nav: {
        brand: businessName,
        links: [
          { label: "Features", href: "/#features" },
          { label: "FAQ", href: "/#faq" },
        ],
        cta: { label: "Contact us", href: "/#contact" },
      },
      footer: footer(businessName),
      pages: [
        {
          id: newId("p"),
          path: "/",
          title: "Home",
          sections: [
            {
              id: newId("s"),
              type: "hero",
              props: {
                heading: tagline ?? `${businessName} makes it`,
                ...(tagline ? {} : { rotating: ["simple", "fast", "personal"] }),
                subheading: "Say in one sentence what you do and who it's for.",
                primaryCta: { label: "Get started", href: "/#contact" },
                secondaryCta: { label: "Learn more", href: "/#features" },
                align: "left",
                layout: "classic",
                backdrop: "grid",
              },
            },
            {
              id: newId("s"),
              type: "stats",
              style: { spacing: "compact" },
              props: {
                items: [
                  { value: "10+", label: "Years", icon: "calendar-check" },
                  { value: "5000+", label: "Customers", icon: "users" },
                  { value: "4.9★", label: "Rating", icon: "star" },
                ],
              },
            },
            {
              id: "features",
              type: "features",
              style: { background: "surface", divider: "wave" },
              props: {
                heading: "What you get",
                columns: 3,
                layout: "icons",
                items: [
                  { title: "Fast", body: "Describe the first benefit.", icon: "zap" },
                  { title: "Reliable", body: "Describe the second benefit.", icon: "shield-check" },
                  { title: "Friendly", body: "Describe the third benefit.", icon: "smile" },
                ],
              },
            },
            {
              id: newId("s"),
              type: "steps",
              props: {
                heading: "How it works",
                layout: "timeline",
                items: [
                  { title: "Tell us what you need", body: "A call or a message is enough.", icon: "message-circle" },
                  { title: "We get to work", body: "Describe what happens next.", icon: "hammer" },
                  { title: "You're sorted", body: "Describe the result.", icon: "party-popper" },
                ],
              },
            },
            {
              id: "faq",
              type: "faq",
              props: {
                heading: "Questions",
                items: [{ question: "How do I get started?", answer: "Get in touch and we'll take it from there." }],
              },
            },
            {
              id: newId("s"),
              type: "cta",
              style: { background: "gradient" },
              props: { heading: "Ready when you are", body: "One message and we'll take it from there.", button: { label: "Get started", href: "/#contact" }, style: "minimal" },
            },
            {
              id: "contact",
              type: "contact",
              props: { heading: "Talk to us", ...(email ? { email } : {}), ...(phone ? { phone } : {}) },
            },
          ],
        },
      ],
    }),
};

const portfolio: Template = {
  id: "portfolio-studio",
  name: "Studio portfolio",
  kind: "portfolio",
  description: "Show your work: a gallery of projects, a short story and a contact.",
  build: ({ businessName, tagline, email }) =>
    parseTree({
      schemaVersion: SCHEMA_VERSION,
      meta: { title: businessName, description: tagline ?? `Selected work by ${businessName}.` },
      theme: {
        colors: {
          primary: "#111111",
          background: "#fbfaf7",
          surface: "#f1eee7",
          text: "#171717",
          muted: "#737373",
          accent: "#c2410c",
        },
        fonts: { heading: "Playfair Display", body: "DM Sans" },
        radius: "none",
      },
      nav: {
        brand: businessName,
        links: [
          { label: "Work", href: "/#work" },
          { label: "About", href: "/about" },
        ],
        cta: { label: "Hire me", href: "/#contact" },
      },
      footer: footer(businessName),
      pages: [
        {
          id: newId("p"),
          path: "/",
          title: "Home",
          sections: [
            {
              id: newId("s"),
              type: "hero",
              props: { heading: tagline ?? `${businessName} — design & build`, ...(tagline ? {} : { highlight: "design & build" }), align: "left", layout: "stacked", backdrop: "spotlight" },
            },
            { id: newId("s"), type: "collection", props: { collection: "profile", layout: "about" } },
            { id: "work", type: "collection", style: { background: "surface" }, props: { collection: "projects", heading: "Selected work", layout: "cards" } },
            { id: newId("s"), type: "collection", props: { collection: "services", heading: "What I do" } },
            { id: newId("s"), type: "collection", props: { collection: "testimonials", heading: "Kind words" } },
            {
              id: "contact",
              type: "cta",
              props: {
                heading: "Have a project in mind?",
                button: { label: "Say hello", href: email ? `mailto:${email}` : "/about" },
                style: "glow",
              },
            },
          ],
        },
        {
          id: newId("p"),
          path: "/about",
          title: "About",
          sections: [
            { id: newId("s"), type: "collection", props: { collection: "profile", layout: "about" } },
            { id: newId("s"), type: "collection", props: { collection: "experience", heading: "Experience" } },
            { id: newId("s"), type: "collection", props: { collection: "education", heading: "Education" } },
            { id: newId("s"), type: "collection", props: { collection: "skills", heading: "Skills & tools" } },
            { id: newId("s"), type: "collection", props: { collection: "awards", heading: "Recognition" } },
          ],
        },
      ],
    }),
  data: ({ businessName, tagline, email }) =>
    parseData({
      profile: [{ name: businessName, headline: tagline ?? "Designer and maker", bio: "A short story about you, what you make and how you work.", ...(email ? { email } : {}) }],
      projects: [
        { id: "p1", title: "Project one", summary: "What it was, and what you did", tags: ["Brand", "Web"] },
        { id: "p2", title: "Project two", summary: "What it was, and what you did", tags: ["Product"] },
        { id: "p3", title: "Project three", summary: "What it was, and what you did", tags: ["Campaign"] },
      ],
      services: [
        { id: "s1", title: "Brand identity", description: "Logo, colours and type that fit the business." },
        { id: "s2", title: "Websites", description: "Fast, clear sites that bring enquiries." },
      ],
      skills: [
        { id: "k1", name: "Design" },
        { id: "k2", name: "Illustration" },
        { id: "k3", name: "Web" },
      ],
    }),
};

export const TEMPLATES: Template[] = [store, landing, portfolio];

export function getTemplate(id: string): Template {
  const t = TEMPLATES.find((t) => t.id === id);
  if (!t) throw new Error(`no template ${id}`);
  return t;
}
