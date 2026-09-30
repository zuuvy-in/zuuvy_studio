/**
 * Premade sites: ten finished designs for common kinds of business, built
 * with the same blocks the AI uses. They are seeded as real, published sites
 * on the platform's own account (scripts/seed-showcase.ts) and customers fork
 * one as their starting point — so what they preview is exactly what they get.
 *
 * Pictures are named by what they should show, never by a guessed URL: the
 * seed asks the photo library for each one, and a slot it cannot fill is left
 * empty (every block draws a tidy placeholder instead).
 */
import type { SiteKind } from "./templates";
import { type Commerce, SCHEMA_VERSION, type Section, type SiteTree, newId, parseTree } from "./tree";

/** Resolves a named picture to an https URL, or nothing. */
export type PhotoLookup = (slot: string) => string | undefined;

export type ShowcaseProduct = { name: string; category: string; price: number; mrp?: number; description: string; photo: string };

/** A form's table, created with the site so the form works from the first visit. */
export type ShowcaseTable = { key: string; name: string; columns: { key: string; label: string; type: "text" | "email" | "tel" | "number" | "textarea" | "select" | "checkbox" | "date" }[] };

export type ShowcaseDesign = {
  slug: string;
  name: string;
  /** What kind of business it is for, shown on the gallery card. */
  category: string;
  kind: SiteKind;
  description: string;
  /** The business name used in the sample text; replaced with the customer's own when forked. */
  sampleBusiness: string;
  /** Slot → what the picture should show, as a photo-library search. */
  photos: Record<string, string>;
  /** The slot used as the card's cover. */
  cover: string;
  tables?: ShowcaseTable[];
  products?: ShowcaseProduct[];
  build: (photo: PhotoLookup) => SiteTree;
};

// ---------------------------------------------------------------------------
// Small helpers so each design reads as content
// ---------------------------------------------------------------------------

type Style = Section["style"];
const sec = <T extends Section["type"]>(type: T, props: Extract<Section, { type: T }>["props"] | Record<string, unknown>, style?: Style, id?: string) =>
  ({ id: id ?? newId("s"), type, props, ...(style ? { style } : {}) }) as unknown as Section;

const img = (photo: PhotoLookup, slot: string, key = "image") => {
  const url = photo(slot);
  return url ? { [key]: url } : {};
};

const year = () => new Date().getFullYear();

function site(input: {
  title: string;
  description: string;
  theme: SiteTree["theme"];
  brand: string;
  links: { label: string; href: string }[];
  cta?: { label: string; href: string };
  footer: string;
  footerLinks?: { label: string; href: string }[];
  pages: { path: string; title: string; sections: Section[] }[];
  commerce?: Partial<Commerce>;
}): SiteTree {
  return parseTree({
    schemaVersion: SCHEMA_VERSION,
    meta: { title: input.title, description: input.description },
    theme: input.theme,
    nav: { brand: input.brand, links: input.links, ...(input.cta ? { cta: input.cta } : {}) },
    footer: { text: `© ${year()} ${input.footer}`, links: [...(input.footerLinks ?? []), { label: "Photos: Unsplash", href: "https://unsplash.com" }] },
    pages: input.pages.map((p) => ({ id: newId("p"), ...p })),
    ...(input.commerce ? { commerce: input.commerce } : {}),
  });
}

// ---------------------------------------------------------------------------
// 1. Bakery & café
// ---------------------------------------------------------------------------

const bakery: ShowcaseDesign = {
  slug: "bakery",
  name: "Warm Bakery",
  category: "Bakery & café",
  kind: "landing",
  description: "Soft, warm and hungry-making: a menu table, custom cake orders and the morning bake in pictures.",
  sampleBusiness: "Crumb & Co.",
  cover: "hero",
  photos: {
    hero: "artisan bakery counter croissants morning light",
    cake: "birthday cake decorated with berries",
    bread: "sourdough loaves on wooden shelf",
    g1: "croissants close up",
    g2: "coffee and pastry on cafe table",
    g3: "baker kneading dough flour",
    g4: "cupcakes pastel frosting",
    g5: "cinnamon rolls tray",
    g6: "bakery window display",
  },
  tables: [
    {
      key: "cake_orders",
      name: "Cake orders",
      columns: [
        { key: "name", label: "Name", type: "text" },
        { key: "phone", label: "Phone", type: "tel" },
        { key: "date", label: "Needed on", type: "date" },
        { key: "size", label: "Size", type: "select" },
        { key: "message", label: "Flavour and message", type: "textarea" },
      ],
    },
  ],
  build: (photo) =>
    site({
      title: "Crumb & Co. — fresh bakes every morning",
      description: "Sourdough, croissants and custom cakes, baked before sunrise and delivered warm across the city.",
      theme: {
        colors: { primary: "#b45309", background: "#fffaf3", surface: "#fbeedd", text: "#2b1d12", muted: "#7a6552", accent: "#e11d48" },
        fonts: { heading: "Playfair Display", body: "DM Sans" },
        radius: "lg",
        motion: "lively",
      },
      brand: "Crumb & Co.",
      links: [
        { label: "Menu", href: "/#menu" },
        { label: "Cakes", href: "/#cakes" },
        { label: "Visit", href: "/#visit" },
      ],
      cta: { label: "Order a cake", href: "/#cakes" },
      footer: "Crumb & Co. Baked by hand, every morning.",
      pages: [
        {
          path: "/",
          title: "Home",
          sections: [
            sec("hero", {
              eyebrow: "Out of the oven at 6 am",
              heading: "Bread worth waking up for",
              highlight: "waking up",
              subheading: "Slow-fermented sourdough, butter croissants and cakes made to order — baked before sunrise, at your door while still warm.",
              primaryCta: { label: "See today's menu", href: "/#menu" },
              secondaryCta: { label: "Order a cake", href: "/#cakes" },
              layout: "fullbleed",
              align: "left",
              badges: ["4.9★ on Google", "Eggless options", "Delivery by 11 am"],
              ...img(photo, "hero"),
            }),
            sec("marquee", { items: ["Fresh every morning", "Eggless on request", "No preservatives", "Delivered warm", "Custom cakes in 24 hours"], icon: "wheat", tone: "primary", speed: "slow" }),
            sec(
              "features",
              {
                heading: "Why the neighbourhood queues at 7",
                layout: "bento",
                items: [
                  { title: "48-hour sourdough", body: "Wild yeast, stone-ground flour and patience. Crackly crust, open crumb, no shortcuts.", icon: "wheat" },
                  { title: "Real butter only", body: "Our croissants take three days and a lot of butter.", icon: "croissant" },
                  { title: "Eggless, always", body: "Every cake comes eggless on request, at no extra cost.", icon: "leaf" },
                  { title: "Warm to your door", body: "Order by 9 pm; it arrives by 11 the next morning.", icon: "truck" },
                ],
              },
              { background: "surface", divider: "wave" },
            ),
            sec(
              "table",
              {
                heading: "Today's menu",
                subheading: "Baked this morning. When it's gone, it's gone.",
                columns: ["Bake", "What it is", "Price"],
                rows: [
                  ["Country sourdough", "Our 48-hour loaf, 800 g", "₹260"],
                  ["Butter croissant", "Three days, 27 layers", "₹120"],
                  ["Pain au chocolat", "Dark chocolate batons", "₹140"],
                  ["Cinnamon roll", "Brown butter and cardamom", "₹150"],
                  ["Banana walnut loaf", "Eggless, whole wheat", "₹320"],
                  ["Filter coffee", "South Indian, strong", "₹90"],
                ],
                style: "striped",
                caption: "Prices include GST. Eggless versions of every cake on request.",
              },
              undefined,
              "menu",
            ),
            sec("imageText", {
              eyebrow: "Made for your day",
              heading: "Cakes that look like the picture — and taste better",
              body: "Tell us the day, the flavour and what it should say. We bake it fresh the morning you need it and deliver it chilled.",
              bullets: [
                { text: "Ready in 24 hours", icon: "clock" },
                { text: "Eggless and sugar-free options", icon: "leaf" },
                { text: "Free message and candles", icon: "gift" },
              ],
              badge: "Baked the same morning",
              imageSide: "left",
              cta: { label: "Order yours", href: "/#cakes" },
              ...img(photo, "cake"),
            }),
            sec(
              "gallery",
              {
                heading: "This morning's bake",
                layout: "masonry",
                columns: 3,
                items: ["g1", "g2", "g3", "g4", "g5", "g6"].map((g, i) => ({
                  title: ["Croissants", "Coffee & a pastry", "Shaping the dough", "Cupcakes", "Cinnamon rolls", "The window"][i]!,
                  ...img(photo, g),
                })),
              },
              { background: "surface" },
            ),
            sec("testimonials", {
              heading: "Regulars say",
              layout: "marquee",
              items: [
                { quote: "The sourdough is the best I've had outside Europe. We buy two loaves every Sunday.", author: "Ritika S.", rating: 5 },
                { quote: "Ordered an eggless birthday cake the night before — it was perfect and still cold.", author: "Aman K.", rating: 5 },
                { quote: "Their cinnamon roll with filter coffee is my 8 am ritual.", author: "Dev P.", rating: 5 },
                { quote: "Lovely people, honest prices, and the croissants shatter like they should.", author: "Meera J.", rating: 5 },
              ],
            }),
            sec(
              "form",
              {
                heading: "Order a cake",
                subheading: "Tell us about it — we'll call to confirm the design and price.",
                layout: "split",
                aside: "We reply within two hours between 8 am and 8 pm. Orders need 24 hours; weddings a week.",
                fields: [
                  { name: "name", label: "Your name", type: "text", required: true, width: "half" },
                  { name: "phone", label: "Phone", type: "tel", required: true, width: "half" },
                  { name: "date", label: "Needed on", type: "date", required: true, width: "half" },
                  { name: "size", label: "Size", type: "select", options: ["Half kg", "1 kg", "2 kg", "Tiered"], required: true, width: "half" },
                  { name: "message", label: "Flavour and message on the cake", type: "textarea", width: "full" },
                ],
                submitLabel: "Request my cake",
                successMessage: "Thank you! We'll call you within two hours to confirm.",
                destination: { kind: "table", table: "cake_orders" },
              },
              { background: "surface" },
              "cakes",
            ),
            sec("contact", { heading: "Come say hello", body: "Open every day, 7 am to 9 pm. Parking in front.", phone: "+91 98765 43210", whatsapp: "919876543210", address: "12 Boring Road, Patna 800001" }, undefined, "visit"),
          ],
        },
      ],
    }),
};

// ---------------------------------------------------------------------------
// 2. Restaurant
// ---------------------------------------------------------------------------

const restaurant: ShowcaseDesign = {
  slug: "restaurant",
  name: "Evening Table",
  category: "Restaurant",
  kind: "landing",
  description: "Dark, candle-lit and appetising: a signature menu, the chef's story and table reservations.",
  sampleBusiness: "Saffron Table",
  cover: "hero",
  photos: {
    hero: "indian fine dining restaurant dinner table candle",
    chef: "indian chef plating dish kitchen",
    g1: "butter chicken in copper bowl",
    g2: "biryani handi",
    g3: "tandoori platter",
    g4: "restaurant interior warm lights",
    g5: "cocktail bar evening",
    g6: "gulab jamun dessert plated",
  },
  tables: [
    {
      key: "reservations",
      name: "Reservations",
      columns: [
        { key: "name", label: "Name", type: "text" },
        { key: "phone", label: "Phone", type: "tel" },
        { key: "date", label: "Date", type: "date" },
        { key: "time", label: "Time", type: "select" },
        { key: "guests", label: "Guests", type: "number" },
        { key: "note", label: "Occasion or requests", type: "textarea" },
      ],
    },
  ],
  build: (photo) =>
    site({
      title: "Saffron Table — modern Indian dining",
      description: "Slow-cooked classics from across India, a warm room and a table waiting for you.",
      theme: {
        colors: { primary: "#d4a24c", background: "#120d0a", surface: "#1d1612", text: "#f6ede1", muted: "#bba993", accent: "#c2410c" },
        fonts: { heading: "Playfair Display", body: "Manrope" },
        radius: "sm",
        motion: "subtle",
      },
      brand: "Saffron Table",
      links: [
        { label: "Menu", href: "/#menu" },
        { label: "Our story", href: "/#story" },
        { label: "Find us", href: "/#visit" },
      ],
      cta: { label: "Book a table", href: "/#book" },
      footer: "Saffron Table. Dinner from 7 pm, lunch on weekends.",
      pages: [
        {
          path: "/",
          title: "Home",
          sections: [
            sec("hero", {
              eyebrow: "Dinner · 7 pm to midnight",
              heading: "Recipes from grandmothers' kitchens, served by candlelight",
              subheading: "Dum biryani sealed for six hours, dal cooked overnight on coal, and a room made for long conversations.",
              primaryCta: { label: "Book a table", href: "/#book" },
              secondaryCta: { label: "See the menu", href: "/#menu" },
              layout: "fullbleed",
              align: "center",
              badges: ["Times Food Awards 2025", "4.8★ on Zomato"],
              ...img(photo, "hero"),
            }),
            sec(
              "stats",
              {
                items: [
                  { value: "6 hrs", label: "Dum on every biryani", icon: "flame" },
                  { value: "14", label: "Regional recipes", icon: "map" },
                  { value: "4.8★", label: "From 3,200 diners", icon: "star" },
                ],
              },
              { spacing: "compact", background: "surface" },
            ),
            sec(
              "table",
              {
                heading: "Signatures",
                subheading: "A short menu, cooked properly.",
                columns: ["Dish", "From", "Price"],
                rows: [
                  ["Dal Saffron (cooked overnight)", "Punjab", "₹420"],
                  ["Lucknowi mutton biryani", "Awadh", "₹680"],
                  ["Kosha mangsho", "Bengal", "₹640"],
                  ["Malabar prawn curry", "Kerala", "₹720"],
                  ["Tandoori broccoli, cheese crust", "Our kitchen", "₹390"],
                  ["Warm gulab jamun, rabri", "Old Delhi", "₹260"],
                ],
                style: "lined",
                caption: "Vegetarian and Jain versions on request. Prices exclude GST.",
              },
              undefined,
              "menu",
            ),
            sec(
              "imageText",
              {
                eyebrow: "The kitchen",
                heading: "Chef Arjun cooks the food he grew up on",
                body: "Twenty years in hotel kitchens taught him technique; his mother's kitchen in Lucknow taught him patience. Everything here is made from scratch every day — the masalas are ground each morning.",
                bullets: [
                  { text: "Masalas ground fresh daily", icon: "sparkles" },
                  { text: "Coal-fired tandoor and dum", icon: "flame" },
                ],
                imageSide: "right",
                ...img(photo, "chef"),
              },
              { background: "surface" },
              "story",
            ),
            sec("gallery", {
              heading: "An evening here",
              layout: "carousel",
              columns: 3,
              items: ["g1", "g2", "g3", "g4", "g5", "g6"].map((g, i) => ({
                title: ["Butter chicken", "Dum biryani", "From the tandoor", "The room", "The bar", "Dessert"][i]!,
                ...img(photo, g),
              })),
            }),
            sec("testimonials", {
              heading: "What guests remember",
              layout: "spotlight",
              items: [
                { quote: "The biryani arrived sealed and the whole table went quiet when they broke the crust. Unforgettable anniversary dinner.", author: "Nisha & Rahul", rating: 5 },
                { quote: "Service that feels like being at a friend's house — if your friend was a great cook.", author: "Kabir M.", rating: 5 },
                { quote: "Dal Saffron alone is worth the drive.", author: "Sunita R.", rating: 5 },
              ],
            }),
            sec(
              "form",
              {
                heading: "Book a table",
                subheading: "We hold tables for 15 minutes. For groups over 10, call us.",
                layout: "split",
                aside: "You'll get a confirmation call within the hour. Birthdays and anniversaries get a little something from the kitchen.",
                fields: [
                  { name: "name", label: "Name", type: "text", required: true, width: "half" },
                  { name: "phone", label: "Phone", type: "tel", required: true, width: "half" },
                  { name: "date", label: "Date", type: "date", required: true, width: "half" },
                  { name: "time", label: "Time", type: "select", options: ["7:00 pm", "7:30 pm", "8:00 pm", "8:30 pm", "9:00 pm", "9:30 pm", "10:00 pm"], required: true, width: "half" },
                  { name: "guests", label: "Guests", type: "number", required: true, width: "half" },
                  { name: "note", label: "Occasion or requests", type: "textarea", width: "full" },
                ],
                submitLabel: "Request a table",
                successMessage: "Thank you — we'll call to confirm your table within the hour.",
                destination: { kind: "table", table: "reservations" },
              },
              { background: "surface" },
              "book",
            ),
            sec("contact", { heading: "Find us", body: "Valet parking at the gate. Closed Mondays.", phone: "+91 98765 43210", address: "3rd floor, Maurya Lok, Patna" }, undefined, "visit"),
          ],
        },
      ],
    }),
};

// ---------------------------------------------------------------------------
// 3. Clinic
// ---------------------------------------------------------------------------

const clinic: ShowcaseDesign = {
  slug: "clinic",
  name: "Calm Clinic",
  category: "Doctor & clinic",
  kind: "landing",
  description: "Clean and reassuring: services, doctors, timings and an appointment request that lands in your Data tab.",
  sampleBusiness: "CarePoint Clinic",
  cover: "hero",
  photos: {
    hero: "friendly doctor consultation clinic bright",
    team: "medical team smiling hospital corridor",
  },
  tables: [
    {
      key: "appointments",
      name: "Appointments",
      columns: [
        { key: "name", label: "Patient name", type: "text" },
        { key: "phone", label: "Phone", type: "tel" },
        { key: "department", label: "Department", type: "select" },
        { key: "date", label: "Preferred date", type: "date" },
        { key: "concern", label: "What it's about", type: "textarea" },
      ],
    },
  ],
  build: (photo) =>
    site({
      title: "CarePoint Clinic — family doctors and specialists",
      description: "Unhurried consultations, a lab on site and appointments that start on time.",
      theme: {
        colors: { primary: "#0f766e", background: "#ffffff", surface: "#f0f7f6", text: "#0f1f1d", muted: "#55706b", accent: "#2563eb" },
        fonts: { heading: "Manrope", body: "Inter" },
        radius: "lg",
        motion: "subtle",
      },
      brand: "CarePoint Clinic",
      links: [
        { label: "Services", href: "/#services" },
        { label: "Timings", href: "/#timings" },
        { label: "FAQ", href: "/#faq" },
      ],
      cta: { label: "Book an appointment", href: "/#book" },
      footer: "CarePoint Clinic. In an emergency, call 108.",
      pages: [
        {
          path: "/",
          title: "Home",
          sections: [
            sec("hero", {
              eyebrow: "Family medicine · Paediatrics · Diagnostics",
              heading: "Care that listens first",
              highlight: "listens",
              subheading: "Unhurried consultations with experienced doctors, a lab on site, and appointments that actually start on time.",
              primaryCta: { label: "Book an appointment", href: "/#book" },
              secondaryCta: { label: "Call the clinic", href: "tel:+919876543210" },
              layout: "split",
              align: "left",
              badges: ["NABH-accredited lab", "Open 7 days"],
              ...img(photo, "hero"),
            }),
            sec("logos", { heading: "Cashless with", marquee: false, items: ["Star Health", "HDFC Ergo", "ICICI Lombard", "Niva Bupa", "Care Health"].map((name) => ({ name })) }, { spacing: "compact" }),
            sec(
              "features",
              {
                heading: "Everything your family needs, under one roof",
                columns: 3,
                layout: "cards",
                items: [
                  { title: "General medicine", body: "Fevers, BP, diabetes and everything in between — with follow-ups that remember you.", icon: "stethoscope" },
                  { title: "Children's care", body: "Vaccinations, growth checks and a paediatrician who is good with nervous little ones.", icon: "baby" },
                  { title: "Women's health", body: "Gynaecology, pregnancy care and screenings in a private, respectful setting.", icon: "heart-pulse" },
                  { title: "Diagnostics lab", body: "Blood tests and ECG on site; most reports on WhatsApp the same day.", icon: "microscope" },
                  { title: "Home sample pickup", body: "We come to you for blood tests from 7 am.", icon: "house" },
                  { title: "Tele-consults", body: "Follow-ups on video, with prescriptions on WhatsApp.", icon: "video" },
                ],
              },
              { background: "surface" },
              "services",
            ),
            sec("steps", {
              heading: "How a visit works",
              layout: "timeline",
              items: [
                { title: "Request a slot", body: "Online or on the phone; we confirm within an hour.", icon: "calendar" },
                { title: "Arrive, no queue", body: "Your token is ready. Average wait: under 10 minutes.", icon: "clock" },
                { title: "Take-home plan", body: "Prescription and reports on WhatsApp, and a follow-up date.", icon: "clipboard-check" },
              ],
            }),
            sec(
              "table",
              {
                heading: "Doctors and timings",
                columns: ["Department", "Doctor", "Days", "Hours"],
                rows: [
                  ["General medicine", "Dr. A. Sinha, MD", "Mon–Sat", "9 am – 1 pm, 5 – 8 pm"],
                  ["Paediatrics", "Dr. R. Verma, MD", "Mon–Sat", "10 am – 2 pm"],
                  ["Gynaecology", "Dr. S. Kumari, MS", "Tue, Thu, Sat", "11 am – 3 pm"],
                  ["Diagnostics lab", "—", "Every day", "7 am – 9 pm"],
                ],
                style: "cards",
                caption: "Sunday: general medicine 10 am – 1 pm only.",
              },
              { background: "surface" },
              "timings",
            ),
            sec("imageText", {
              heading: "Doctors who have time for you",
              body: "We book fewer patients per hour than most clinics so every consultation has room for questions. Our doctors have practised in the city for over fifteen years.",
              bullets: [
                { text: "15-minute minimum consultations", icon: "clock" },
                { text: "Hindi, English and Maithili spoken", icon: "languages" },
              ],
              imageSide: "left",
              ...img(photo, "team"),
            }),
            sec(
              "faq",
              {
                heading: "Before you visit",
                items: [
                  { question: "Do I need an appointment?", answer: "Walk-ins are welcome, but booking gets you a token and almost no waiting." },
                  { question: "Is the lab open on Sundays?", answer: "Yes, every day from 7 am to 9 pm. Fasting tests are best before 10 am." },
                  { question: "Do you accept insurance?", answer: "We are cashless with most major insurers; bring your card and ID." },
                  { question: "What does a consultation cost?", answer: "₹500 for general medicine, ₹700 for specialists. Follow-ups within 7 days are free." },
                ],
              },
              undefined,
              "faq",
            ),
            sec(
              "form",
              {
                heading: "Request an appointment",
                subheading: "We'll call to confirm a time.",
                layout: "split",
                aside: "For a medical emergency, call 108 or go to the nearest hospital. This form is checked from 8 am to 8 pm.",
                fields: [
                  { name: "name", label: "Patient name", type: "text", required: true, width: "half" },
                  { name: "phone", label: "Phone", type: "tel", required: true, width: "half" },
                  { name: "department", label: "Department", type: "select", options: ["General medicine", "Paediatrics", "Gynaecology", "Lab tests"], required: true, width: "half" },
                  { name: "date", label: "Preferred date", type: "date", width: "half" },
                  { name: "concern", label: "What it's about (optional)", type: "textarea", width: "full" },
                ],
                submitLabel: "Request appointment",
                successMessage: "Thank you. We'll call you within the hour to confirm.",
                destination: { kind: "table", table: "appointments" },
              },
              { background: "surface" },
              "book",
            ),
            sec("contact", { heading: "Visit us", phone: "+91 98765 43210", whatsapp: "919876543210", address: "Opposite City Park, Kankarbagh, Patna" }),
          ],
        },
      ],
    }),
};

// ---------------------------------------------------------------------------
// 4. Salon & spa
// ---------------------------------------------------------------------------

const salon: ShowcaseDesign = {
  slug: "salon",
  name: "Glow Salon",
  category: "Salon & spa",
  kind: "landing",
  description: "Soft blush and gold: a price list, stylist work in pictures, and bookings with a preferred time.",
  sampleBusiness: "Glow Studio",
  cover: "hero",
  photos: {
    hero: "luxury hair salon interior soft light",
    bridal: "indian bridal makeup",
    g1: "hair colour balayage",
    g2: "manicure nails pastel",
    g3: "facial spa treatment",
    g4: "hair styling blow dry",
  },
  tables: [
    {
      key: "bookings",
      name: "Bookings",
      columns: [
        { key: "name", label: "Name", type: "text" },
        { key: "phone", label: "Phone", type: "tel" },
        { key: "service", label: "Service", type: "select" },
        { key: "date", label: "Date", type: "date" },
        { key: "time", label: "Time", type: "select" },
      ],
    },
  ],
  build: (photo) =>
    site({
      title: "Glow Studio — hair, skin and bridal",
      description: "Colour, cuts, facials and bridal looks by certified stylists, in a calm studio.",
      theme: {
        colors: { primary: "#be185d", background: "#fff8f9", surface: "#fdebef", text: "#2a1520", muted: "#86606f", accent: "#b7791f" },
        fonts: { heading: "Lora", body: "Outfit" },
        radius: "full",
        motion: "subtle",
      },
      brand: "Glow Studio",
      links: [
        { label: "Services", href: "/#prices" },
        { label: "Bridal", href: "/#bridal" },
        { label: "Work", href: "/#work" },
      ],
      cta: { label: "Book now", href: "/#book" },
      footer: "Glow Studio. Tuesday to Sunday, 10 am – 8 pm.",
      pages: [
        {
          path: "/",
          title: "Home",
          sections: [
            sec("hero", {
              eyebrow: "Hair · Skin · Bridal",
              heading: "Leave feeling like",
              rotating: ["yourself", "a bride", "brand new"],
              subheading: "Certified stylists, premium products and an hour that is entirely about you.",
              primaryCta: { label: "Book an appointment", href: "/#book" },
              secondaryCta: { label: "See prices", href: "/#prices" },
              layout: "split",
              align: "left",
              badges: ["L'Oréal Professionnel partner", "4.9★ · 1,100 reviews"],
              ...img(photo, "hero"),
            }),
            sec("marquee", { items: ["Balayage", "Keratin", "Bridal HD makeup", "Hydra facials", "Nail art", "Men's grooming"], tone: "outline", speed: "slow", icon: "sparkles" }),
            sec(
              "table",
              {
                heading: "Services & prices",
                subheading: "Final price depends on hair length; we'll always tell you before we start.",
                columns: ["Service", "Time", "From"],
                rows: [
                  ["Haircut & style", "45 min", "₹800"],
                  ["Global colour", "2 hrs", "₹3,500"],
                  ["Balayage", "3 hrs", "₹6,000"],
                  ["Keratin smoothing", "3 hrs", "₹5,500"],
                  ["Hydra facial", "60 min", "₹2,800"],
                  ["Gel manicure", "45 min", "₹1,200"],
                ],
                style: "striped",
              },
              { background: "surface", divider: "curve" },
              "prices",
            ),
            sec(
              "imageText",
              {
                eyebrow: "Bridal",
                heading: "Your wedding look, trialled and perfected",
                body: "A trial session two weeks before, a timeline for the day, and our team with you from haldi to reception.",
                bullets: [
                  { text: "Free trial with every bridal package", icon: "heart" },
                  { text: "HD and airbrush makeup", icon: "sparkles" },
                  { text: "We travel to your venue", icon: "car" },
                ],
                badge: "300+ brides",
                imageSide: "right",
                cta: { label: "Ask about bridal", href: "/#book" },
                ...img(photo, "bridal"),
              },
              undefined,
              "bridal",
            ),
            sec(
              "gallery",
              {
                heading: "Recent work",
                layout: "grid",
                columns: 4,
                items: ["g1", "g2", "g3", "g4"].map((g, i) => ({ title: ["Balayage", "Nail art", "Facials", "Styling"][i]!, ...img(photo, g) })),
              },
              { background: "surface" },
              "work",
            ),
            sec("testimonials", {
              heading: "Clients say",
              layout: "cards",
              items: [
                { quote: "Finally a colourist who listened. My balayage looks natural and grew out beautifully.", author: "Ananya", rating: 5 },
                { quote: "They did my wedding and my sister's. Calm, on time, and the makeup lasted all night.", author: "Pooja", rating: 5 },
                { quote: "The hydra facial is my monthly reset.", author: "Sneha", rating: 5 },
              ],
            }),
            sec(
              "form",
              {
                heading: "Book an appointment",
                layout: "card",
                fields: [
                  { name: "name", label: "Name", type: "text", required: true, width: "half" },
                  { name: "phone", label: "Phone", type: "tel", required: true, width: "half" },
                  { name: "service", label: "Service", type: "select", options: ["Haircut", "Colour", "Keratin", "Facial", "Nails", "Bridal"], required: true, width: "full" },
                  { name: "date", label: "Date", type: "date", required: true, width: "half" },
                  { name: "time", label: "Time", type: "select", options: ["Morning", "Afternoon", "Evening"], required: true, width: "half" },
                ],
                submitLabel: "Request booking",
                successMessage: "Thank you! We'll message you on WhatsApp to confirm your slot.",
                destination: { kind: "table", table: "bookings" },
              },
              { background: "surface" },
              "book",
            ),
            sec("contact", { heading: "Find the studio", phone: "+91 98765 43210", whatsapp: "919876543210", address: "1st floor, Fraser Road, Patna" }),
          ],
        },
      ],
    }),
};

// ---------------------------------------------------------------------------
// 5. Gym & fitness
// ---------------------------------------------------------------------------

const gym: ShowcaseDesign = {
  slug: "gym",
  name: "Iron Pulse",
  category: "Gym & fitness",
  kind: "landing",
  description: "Bold, dark and energetic: memberships, classes, trainers and a free trial pass sign-up.",
  sampleBusiness: "Iron Pulse Fitness",
  cover: "hero",
  photos: {
    hero: "gym workout dark dramatic lighting weights",
    coach: "personal trainer coaching client gym",
    bg: "gym interior equipment",
  },
  tables: [
    {
      key: "trial_passes",
      name: "Trial passes",
      columns: [
        { key: "name", label: "Name", type: "text" },
        { key: "phone", label: "Phone", type: "tel" },
        { key: "goal", label: "Goal", type: "select" },
        { key: "time", label: "Preferred time", type: "select" },
      ],
    },
  ],
  build: (photo) =>
    site({
      title: "Iron Pulse Fitness — train with purpose",
      description: "Strength floor, group classes and coaches who track your progress. Try a week free.",
      theme: {
        colors: { primary: "#facc15", background: "#0b0b0c", surface: "#161618", text: "#f5f5f4", muted: "#a8a29e", accent: "#ef4444" },
        fonts: { heading: "Space Grotesk", body: "Inter" },
        radius: "sm",
        motion: "lively",
      },
      brand: "IRON PULSE",
      links: [
        { label: "Programs", href: "/#programs" },
        { label: "Plans", href: "/#plans" },
        { label: "Coaches", href: "/#coaches" },
      ],
      cta: { label: "Free trial week", href: "/#trial" },
      footer: "Iron Pulse Fitness. Open 5 am – 11 pm.",
      pages: [
        {
          path: "/",
          title: "Home",
          sections: [
            sec(
              "hero",
              {
                eyebrow: "5 am – 11 pm · 7 days",
                heading: "Stronger every week. Measured, not guessed.",
                highlight: "Measured",
                subheading: "A 6,000 sq ft strength floor, 30 classes a week and coaches who track every lift with you.",
                primaryCta: { label: "Claim a free week", href: "/#trial" },
                secondaryCta: { label: "See plans", href: "/#plans" },
                layout: "fullbleed",
                align: "left",
                badges: ["No joining fee this month", "Certified coaches"],
                ...img(photo, "hero"),
              },
            ),
            sec("marquee", { items: ["Strength", "HIIT", "Mobility", "Boxing", "Yoga", "Nutrition coaching"], tone: "primary", speed: "fast", icon: "zap" }),
            sec(
              "stats",
              {
                heading: "Results members post",
                items: [
                  { value: "1,800+", label: "Active members", icon: "users" },
                  { value: "30", label: "Classes a week", icon: "calendar" },
                  { value: "12 kg", label: "Average first-year loss", icon: "trending-down" },
                  { value: "4.9★", label: "Google rating", icon: "star" },
                ],
              },
              { background: "surface", pattern: "grid" },
            ),
            sec(
              "features",
              {
                heading: "Programs",
                layout: "bento",
                items: [
                  { title: "Strength floor", body: "Olympic platforms, 8 racks, dumbbells to 50 kg — never a wait.", icon: "dumbbell" },
                  { title: "HIIT & conditioning", body: "45 minutes, heart-rate tracked, every morning and evening.", icon: "flame" },
                  { title: "Boxing", body: "Technique first, then pads and bags.", icon: "swords" },
                  { title: "Mobility & yoga", body: "Recover properly so you can train hard again tomorrow.", icon: "leaf" },
                  { title: "Nutrition", body: "Indian-kitchen meal plans that fit real life.", icon: "apple" },
                ],
              },
              undefined,
              "programs",
            ),
            sec(
              "table",
              {
                heading: "Membership plans",
                columns: ["Plan", "What's in it", "Price"],
                rows: [
                  ["Monthly", "Floor + all classes", "₹2,499 / month"],
                  ["Quarterly", "Floor + classes + 1 body scan", "₹6,499"],
                  ["Annual", "Everything + 4 PT sessions", "₹19,999"],
                  ["Personal training", "12 one-to-one sessions", "₹9,999"],
                ],
                style: "cards",
                caption: "Students get 15% off with college ID.",
              },
              { background: "surface" },
              "plans",
            ),
            sec(
              "imageText",
              {
                eyebrow: "Coaches",
                heading: "Someone in your corner, every session",
                body: "Every member gets a coach, a starting assessment and a plan reviewed every four weeks. No guesswork, no ego.",
                bullets: [
                  { text: "Free body-composition scan", icon: "activity" },
                  { text: "Plan reviewed monthly", icon: "clipboard-check" },
                ],
                imageSide: "left",
                ...img(photo, "coach"),
              },
              undefined,
              "coaches",
            ),
            sec("testimonials", {
              heading: "Members",
              layout: "marquee",
              items: [
                { quote: "Deadlift went from 60 to 140 kg in a year. The coaches actually watch your form.", author: "Rohit", rating: 5 },
                { quote: "Lost 15 kg without a crash diet. The meal plan uses food my mother cooks.", author: "Priya", rating: 5 },
                { quote: "Clean, never crowded at 6 am, and the boxing class is brutal in the best way.", author: "Imran", rating: 5 },
                { quote: "Best money I spend every month.", author: "Kavya", rating: 5 },
              ],
            }),
            sec(
              "form",
              {
                heading: "Try a week, free",
                subheading: "No card, no pressure. Just show up.",
                layout: "split",
                aside: "We'll message your pass on WhatsApp. Bring shoes and a water bottle — we have the rest.",
                fields: [
                  { name: "name", label: "Name", type: "text", required: true, width: "half" },
                  { name: "phone", label: "Phone", type: "tel", required: true, width: "half" },
                  { name: "goal", label: "Main goal", type: "select", options: ["Lose weight", "Build muscle", "Get fitter", "Learn boxing"], required: true, width: "half" },
                  { name: "time", label: "Preferred time", type: "select", options: ["Early morning", "Morning", "Evening", "Late evening"], width: "half" },
                ],
                submitLabel: "Get my free week",
                successMessage: "You're in! Your pass is on its way to WhatsApp.",
                destination: { kind: "table", table: "trial_passes" },
              },
              { background: "image", ...(photo("bg") ? { image: photo("bg") } : {}) },
              "trial",
            ),
            sec("contact", { heading: "Find the gym", phone: "+91 98765 43210", whatsapp: "919876543210", address: "Bailey Road, above Big Bazaar, Patna" }),
          ],
        },
      ],
    }),
};

// ---------------------------------------------------------------------------
// 6. Fashion boutique (store)
// ---------------------------------------------------------------------------

const fashion: ShowcaseDesign = {
  slug: "fashion",
  name: "Boutique",
  category: "Clothing store",
  kind: "store",
  description: "An editorial storefront for clothing: lookbook hero, new arrivals, sizes and free exchanges.",
  sampleBusiness: "Thread & Loom",
  cover: "hero",
  photos: {
    hero: "indian woman ethnic wear fashion editorial",
    story: "handloom weaving loom threads",
    p1: "linen kurta on hanger",
    p2: "silk saree folded",
    p3: "cotton dupatta block print",
    p4: "men linen shirt",
    p5: "block print dress",
    p6: "handwoven stole scarf",
  },
  products: [
    { name: "Indigo linen kurta", category: "Kurtas", price: 1890, mrp: 2490, description: "Hand-block printed on breathable linen. Straight fit, side slits.", photo: "p1" },
    { name: "Tussar silk saree", category: "Sarees", price: 7450, description: "Handwoven in Bhagalpur, with a zari border. Blouse piece included.", photo: "p2" },
    { name: "Dabu print dupatta", category: "Dupattas", price: 990, description: "Mud-resist printed cotton mulmul, soft enough to sleep in.", photo: "p3" },
    { name: "Men's linen shirt", category: "Shirts", price: 1690, description: "Relaxed fit, mother-of-pearl buttons, washed for softness.", photo: "p4" },
    { name: "Ajrakh midi dress", category: "Dresses", price: 2690, mrp: 3290, description: "Natural-dyed ajrakh with pockets, because dresses need pockets.", photo: "p5" },
    { name: "Handwoven wool stole", category: "Stoles", price: 1490, description: "Kullu weave in warm earth tones.", photo: "p6" },
  ],
  build: (photo) =>
    site({
      title: "Thread & Loom — handwoven, hand-printed clothing",
      description: "Clothes made by Indian weavers and printers, sold directly. Free exchanges within 15 days.",
      theme: {
        colors: { primary: "#1f2937", background: "#faf7f2", surface: "#f1ebe1", text: "#1c1917", muted: "#78716c", accent: "#9a3412" },
        fonts: { heading: "Playfair Display", body: "DM Sans" },
        radius: "none",
        motion: "subtle",
      },
      brand: "Thread & Loom",
      links: [
        { label: "New in", href: "/#new" },
        { label: "Our weavers", href: "/#story" },
        { label: "Help", href: "/#help" },
      ],
      footer: "Thread & Loom. Handmade in India.",
      commerce: {
        cart: { style: "drawer", icon: "bag", placement: "nav", display: "icon_label", label: "Bag" },
        buy: "add_to_cart",
        account: { show: true, placement: "nav", label: "Account", display: "icon" },
        pages: {
          frame: "plain",
          auth: { layout: "split", heading: "Welcome to Thread & Loom", intro: "Save your size, follow your orders and hear about new weaves first.", perks: ["Early access to new weaves", "Your orders in one place", "Faster checkout"] },
          account: { heading: "Namaste, {name}" },
          cart: { heading: "Your bag", empty: "Your bag is empty — the new indigo weaves are worth a look.", continueLabel: "Keep browsing" },
          thanks: { heading: "Thank you, {name}", message: "Your order is being packed by hand. We'll WhatsApp you when it ships." },
        } as Commerce["pages"],
      } as Partial<Commerce>,
      pages: [
        {
          path: "/",
          title: "Home",
          sections: [
            sec("hero", {
              eyebrow: "The monsoon edit",
              heading: "Slow clothes, made by hand",
              subheading: "Handwoven and hand-printed by artisans across India, and sold to you directly — so they earn more and you pay less.",
              primaryCta: { label: "Shop new arrivals", href: "/#new" },
              secondaryCta: { label: "Meet the weavers", href: "/#story" },
              layout: "split",
              align: "left",
              ...img(photo, "hero"),
            }),
            sec("marquee", { items: ["Free shipping over ₹1,499", "15-day free exchange", "Cash on delivery", "Natural dyes", "Made in India"], tone: "dark", speed: "slow" }),
            sec("productGrid", { heading: "New arrivals", subheading: "Small batches — when they're gone, the loom starts again.", limit: 8, columns: 4, sort: "newest" }, undefined, "new"),
            sec(
              "imageText",
              {
                eyebrow: "Our weavers",
                heading: "Forty families, six states, one loom at a time",
                body: "We work directly with weaving and printing families in Bhagalpur, Bagru, Kutch and Kullu, paying on time and above market. Every piece carries the name of the cluster that made it.",
                bullets: [
                  { text: "Fair, on-time pay", icon: "hand-heart" },
                  { text: "Natural, azo-free dyes", icon: "leaf" },
                  { text: "Small batches, zero dead stock", icon: "recycle" },
                ],
                badge: "Handwoven in Bhagalpur",
                imageSide: "left",
                ...img(photo, "story"),
              },
              { background: "surface" },
              "story",
            ),
            sec("testimonials", {
              heading: "Worn and loved",
              layout: "cards",
              items: [
                { quote: "The linen gets softer every wash. I've bought the kurta in three colours now.", author: "Aditi, Bengaluru", rating: 5 },
                { quote: "My mother cried when she saw the Tussar saree. Beautifully packed, too.", author: "Sourav, Kolkata", rating: 5 },
                { quote: "Exchange for a size was painless — picked up in two days.", author: "Neha, Pune", rating: 5 },
              ],
            }),
            sec(
              "faq",
              {
                heading: "Good to know",
                items: [
                  { question: "How do sizes run?", answer: "True to size with a relaxed fit. Every product lists garment measurements; if in doubt, size down for a closer fit." },
                  { question: "Can I exchange?", answer: "Yes — free exchange within 15 days. We pick it up from your door." },
                  { question: "How do I wash handloom?", answer: "Cold hand-wash the first time with mild detergent, dry in shade. Natural dyes may release a little colour at first." },
                  { question: "Do you ship outside India?", answer: "Not yet — write to us and we'll let you know when we do." },
                ],
              },
              { background: "surface" },
              "help",
            ),
            sec("contact", { heading: "Talk to us", body: "Monday to Saturday, 10 am – 7 pm.", email: "hello@example.com", whatsapp: "919876543210" }),
          ],
        },
      ],
    }),
};

// ---------------------------------------------------------------------------
// 7. Electronics store
// ---------------------------------------------------------------------------

const electronics: ShowcaseDesign = {
  slug: "electronics",
  name: "Tech Store",
  category: "Electronics & mobiles",
  kind: "store",
  description: "Crisp and trustworthy: deals, categories, warranty promises and a fast checkout for gadgets.",
  sampleBusiness: "Volt Mobiles",
  cover: "hero",
  photos: {
    hero: "smartphone accessories flat lay minimal",
    p1: "wireless earbuds case",
    p2: "power bank",
    p3: "usb c fast charger",
    p4: "bluetooth speaker",
    p5: "smartwatch",
    p6: "phone case",
    p7: "usb c cable braided",
    p8: "tempered glass screen protector",
  },
  products: [
    { name: "TWS earbuds with ANC", category: "Audio", price: 2499, mrp: 3999, description: "Active noise cancelling, 30-hour battery, IPX5.", photo: "p1" },
    { name: "20,000 mAh power bank", category: "Power", price: 1799, mrp: 2499, description: "22.5 W fast charge, charges two phones at once.", photo: "p2" },
    { name: "65 W GaN charger", category: "Chargers", price: 1999, mrp: 2999, description: "Charges a laptop and phone together. Pocket-sized.", photo: "p3" },
    { name: "Bluetooth speaker Mini", category: "Audio", price: 1299, mrp: 1799, description: "Punchy bass, 12 hours, waterproof.", photo: "p4" },
    { name: "Smartwatch Active", category: "Wearables", price: 3499, mrp: 4999, description: "AMOLED, SpO2, calling, 7-day battery.", photo: "p5" },
    { name: "Shockproof phone case", category: "Cases", price: 499, description: "Military-grade drop protection, clear back.", photo: "p6" },
    { name: "Braided USB-C cable 1.5 m", category: "Cables", price: 349, mrp: 499, description: "60 W, survives 20,000 bends.", photo: "p7" },
    { name: "Tempered glass (2-pack)", category: "Protection", price: 299, description: "9H, edge-to-edge, bubble-free fit kit.", photo: "p8" },
  ],
  build: (photo) =>
    site({
      title: "Volt Mobiles — genuine accessories, delivered fast",
      description: "Chargers, audio and wearables with real warranties. Same-day delivery in the city.",
      theme: {
        colors: { primary: "#2563eb", background: "#ffffff", surface: "#f3f6fb", text: "#0b1220", muted: "#5b6577", accent: "#16a34a" },
        fonts: { heading: "Outfit", body: "Inter" },
        radius: "md",
        motion: "subtle",
      },
      brand: "Volt Mobiles",
      links: [
        { label: "Deals", href: "/#deals" },
        { label: "Audio", href: "/#audio" },
        { label: "Why us", href: "/#why" },
      ],
      footer: "Volt Mobiles. GST invoice with every order.",
      commerce: {
        cart: { style: "drawer", icon: "cart", placement: "nav", display: "pill", label: "Cart" },
        buy: "both",
        checkout: { layout: "single", summary: "side", askNote: true, reassurance: "1-year warranty · 7-day replacement · GST invoice" },
        account: { show: true, placement: "nav", label: "Sign in", display: "label" },
        pages: {
          frame: "tinted",
          auth: { layout: "centered", heading: "Sign in to Volt", perks: ["Track deliveries live", "Warranty in one place", "Reorder in one tap"] },
          account: {},
          cart: { heading: "Your cart", empty: "Your cart is empty. Today's deals end at midnight." },
          thanks: { heading: "Order placed, {name}!", message: "In the city? It usually reaches you the same day." },
        } as Commerce["pages"],
      } as Partial<Commerce>,
      pages: [
        {
          path: "/",
          title: "Home",
          sections: [
            sec("hero", {
              eyebrow: "Same-day delivery in the city",
              heading: "Genuine gear. Real warranty. At your door today.",
              highlight: "Real warranty",
              subheading: "Chargers, audio and wearables from brands we'd use ourselves — with a GST invoice and a 7-day no-questions replacement.",
              primaryCta: { label: "Shop today's deals", href: "/#deals" },
              secondaryCta: { label: "Why buy here", href: "/#why" },
              layout: "classic",
              align: "left",
              backdrop: "mesh",
              badges: ["4.8★ from 6,000 buyers", "COD available"],
              ...img(photo, "hero"),
            }),
            sec("logos", { heading: "Brands we stock", items: ["boAt", "Anker", "Mi", "Samsung", "Portronics", "Ambrane", "JBL"].map((name) => ({ name })), marquee: true }, { spacing: "compact" }),
            sec("productGrid", { heading: "Today's deals", limit: 8, columns: 4, sort: "price_asc" }, undefined, "deals"),
            sec(
              "features",
              {
                heading: "Why buy from us",
                layout: "icons",
                columns: 4,
                items: [
                  { title: "100% genuine", body: "Bought from brand distributors, never grey market.", icon: "shield-check" },
                  { title: "Same-day delivery", body: "Order by 4 pm, get it tonight in the city.", icon: "truck" },
                  { title: "7-day replacement", body: "Not right? We swap it, no questions.", icon: "refresh-ccw" },
                  { title: "GST invoice", body: "Claim your warranty anywhere in India.", icon: "receipt" },
                ],
              },
              { background: "surface" },
              "why",
            ),
            sec("productGrid", { heading: "Audio", category: "Audio", limit: 4, columns: 4 }, undefined, "audio"),
            sec(
              "stats",
              {
                items: [
                  { value: "6,000+", label: "Happy buyers", icon: "users" },
                  { value: "4 hrs", label: "Average city delivery", icon: "clock" },
                  { value: "0.4%", label: "Return rate", icon: "badge-check" },
                ],
              },
              { background: "dark", spacing: "compact" },
            ),
            sec("faq", {
              heading: "Questions",
              items: [
                { question: "Is cash on delivery available?", answer: "Yes, on every order. UPI on delivery works too." },
                { question: "How does warranty work?", answer: "Brand warranty applies with our GST invoice. For the first 7 days, we replace it ourselves." },
                { question: "Do you deliver outside the city?", answer: "Across India in 2–5 days via courier." },
              ],
            }),
            sec("cta", { heading: "Not sure what fits your phone?", body: "Send us your model on WhatsApp and we'll tell you in minutes.", button: { label: "Ask on WhatsApp", href: "https://wa.me/919876543210" }, style: "split" }),
          ],
        },
      ],
    }),
};

// ---------------------------------------------------------------------------
// 8. Photographer portfolio
// ---------------------------------------------------------------------------

const photographer: ShowcaseDesign = {
  slug: "photographer",
  name: "Lens Portfolio",
  category: "Photographer & creative",
  kind: "portfolio",
  description: "Image-first and minimal: full-bleed work, packages and an enquiry form for shoot dates.",
  sampleBusiness: "Aarav Lens",
  cover: "hero",
  photos: {
    hero: "indian wedding photography couple golden hour",
    about: "photographer holding camera portrait",
    g1: "indian wedding ceremony candid",
    g2: "portrait woman natural light",
    g3: "haldi ceremony colourful",
    g4: "couple portrait monsoon",
    g5: "wedding details jewellery",
    g6: "family portrait outdoors",
    g7: "baby portrait studio",
    g8: "pre wedding shoot mountains",
  },
  tables: [
    {
      key: "enquiries",
      name: "Shoot enquiries",
      columns: [
        { key: "name", label: "Name", type: "text" },
        { key: "email", label: "Email", type: "email" },
        { key: "phone", label: "Phone", type: "tel" },
        { key: "type", label: "Shoot", type: "select" },
        { key: "date", label: "Date", type: "date" },
        { key: "details", label: "Tell me about it", type: "textarea" },
      ],
    },
  ],
  build: (photo) =>
    site({
      title: "Aarav Lens — weddings and portraits",
      description: "Candid wedding and portrait photography that feels like the day felt.",
      theme: {
        colors: { primary: "#111111", background: "#ffffff", surface: "#f4f4f2", text: "#111111", muted: "#6b6b6b", accent: "#c08a3e" },
        fonts: { heading: "Space Grotesk", body: "Inter" },
        radius: "none",
        motion: "subtle",
      },
      brand: "AARAV LENS",
      links: [
        { label: "Work", href: "/#work" },
        { label: "Packages", href: "/#packages" },
        { label: "About", href: "/#about" },
      ],
      cta: { label: "Check a date", href: "/#enquire" },
      footer: "Aarav Lens. Based in Patna, shooting everywhere.",
      footerLinks: [{ label: "Instagram", href: "https://instagram.com" }],
      pages: [
        {
          path: "/",
          title: "Home",
          sections: [
            sec("hero", {
              heading: "Photographs that feel like the day felt",
              subheading: "Candid weddings and portraits — the glances, the laughter, the grandmother dancing.",
              primaryCta: { label: "See the work", href: "/#work" },
              secondaryCta: { label: "Check my date", href: "/#enquire" },
              layout: "stacked",
              align: "center",
              backdrop: "none",
              ...img(photo, "hero"),
            }),
            sec(
              "gallery",
              {
                heading: "Selected work",
                layout: "masonry",
                columns: 3,
                items: ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8"].map((g, i) => ({
                  title: ["The pheras", "Soft light", "Haldi", "Monsoon", "Details", "Family", "New arrivals", "Up north"][i]!,
                  ...img(photo, g),
                })),
              },
              { spacing: "roomy" },
              "work",
            ),
            sec("logos", { heading: "Featured in", marquee: false, items: ["WedMeGood", "ShaadiSaga", "The Wedding Brigade", "Vogue India"].map((name) => ({ name })) }, { spacing: "compact" }),
            sec(
              "table",
              {
                heading: "Packages",
                subheading: "Every package includes a private online gallery and all edited photos in full resolution.",
                columns: ["Package", "Coverage", "Includes", "From"],
                rows: [
                  ["Portraits", "2 hours", "40 edited photos", "₹15,000"],
                  ["Pre-wedding", "1 day, 2 locations", "80 photos + 1-min film", "₹45,000"],
                  ["Wedding day", "1 day, 2 photographers", "400+ photos + album", "₹1,25,000"],
                  ["Full wedding", "3 days, team of 4", "Everything + film", "₹2,75,000"],
                ],
                style: "lined",
              },
              { background: "surface" },
              "packages",
            ),
            sec(
              "imageText",
              {
                heading: "Hi, I'm Aarav",
                body: "I've photographed 180 weddings in eleven years, and I still get nervous before each one. I work quietly, mostly unnoticed, and deliver your gallery within four weeks.",
                bullets: [
                  { text: "180+ weddings since 2014", icon: "camera" },
                  { text: "Gallery in 4 weeks, guaranteed", icon: "clock" },
                ],
                imageSide: "right",
                ...img(photo, "about"),
              },
              undefined,
              "about",
            ),
            sec("testimonials", {
              heading: "Kind words",
              layout: "spotlight",
              items: [
                { quote: "We didn't even notice him most of the day — and then the photos made us cry all over again.", author: "Shreya & Karan" },
                { quote: "He caught my father's face during the vidaai. I'll keep that picture forever.", author: "Ishita" },
              ],
            }),
            sec(
              "form",
              {
                heading: "Check a date",
                subheading: "I take about 25 weddings a year. Tell me about yours.",
                layout: "split",
                aside: "I reply personally within a day, with availability and a detailed quote.",
                fields: [
                  { name: "name", label: "Your names", type: "text", required: true, width: "full" },
                  { name: "email", label: "Email", type: "email", required: true, width: "half" },
                  { name: "phone", label: "Phone", type: "tel", width: "half" },
                  { name: "type", label: "Shoot", type: "select", options: ["Wedding", "Pre-wedding", "Portraits", "Family", "Other"], required: true, width: "half" },
                  { name: "date", label: "Date", type: "date", width: "half" },
                  { name: "details", label: "Tell me about it", type: "textarea", width: "full" },
                ],
                submitLabel: "Send enquiry",
                successMessage: "Thank you — I'll write back within a day.",
                destination: { kind: "table", table: "enquiries" },
              },
              { background: "surface" },
              "enquire",
            ),
          ],
        },
      ],
    }),
};

// ---------------------------------------------------------------------------
// 9. Coaching institute
// ---------------------------------------------------------------------------

const coaching: ShowcaseDesign = {
  slug: "coaching",
  name: "Bright Academy",
  category: "Coaching & education",
  kind: "landing",
  description: "Friendly and credible: courses and fees, results, faculty, and a demo-class sign-up.",
  sampleBusiness: "BrightPath Academy",
  cover: "hero",
  photos: {
    hero: "indian students classroom studying bright",
    faculty: "teacher explaining whiteboard classroom",
  },
  tables: [
    {
      key: "demo_classes",
      name: "Demo class requests",
      columns: [
        { key: "student", label: "Student name", type: "text" },
        { key: "phone", label: "Parent's phone", type: "tel" },
        { key: "class", label: "Class", type: "select" },
        { key: "course", label: "Course", type: "select" },
      ],
    },
  ],
  build: (photo) =>
    site({
      title: "BrightPath Academy — JEE, NEET and foundation coaching",
      description: "Small batches, weekly tests and teachers who know every student's name.",
      theme: {
        colors: { primary: "#4f46e5", background: "#ffffff", surface: "#f5f5ff", text: "#111133", muted: "#5c5f7a", accent: "#f59e0b" },
        fonts: { heading: "Poppins", body: "Inter" },
        radius: "lg",
        motion: "lively",
      },
      brand: "BrightPath",
      links: [
        { label: "Courses", href: "/#courses" },
        { label: "Results", href: "/#results" },
        { label: "Faculty", href: "/#faculty" },
      ],
      cta: { label: "Free demo class", href: "/#demo" },
      footer: "BrightPath Academy. Admissions open for the new session.",
      pages: [
        {
          path: "/",
          title: "Home",
          sections: [
            sec("hero", {
              eyebrow: "Admissions open · Batches of 25",
              heading: "Crack",
              rotating: ["JEE", "NEET", "the boards"],
              subheading: "Small batches, weekly tests and doubt sessions every evening — with teachers who know every student by name.",
              primaryCta: { label: "Book a free demo class", href: "/#demo" },
              secondaryCta: { label: "See courses", href: "/#courses" },
              layout: "classic",
              align: "left",
              backdrop: "mesh",
              badges: ["312 selections in 2025", "Scholarships up to 50%"],
              ...img(photo, "hero"),
            }),
            sec(
              "stats",
              {
                items: [
                  { value: "312", label: "IIT & medical selections", icon: "trophy" },
                  { value: "25", label: "Students per batch", icon: "users" },
                  { value: "52", label: "Tests a year", icon: "file-check" },
                  { value: "11 yrs", label: "Teaching in Patna", icon: "calendar" },
                ],
              },
              { background: "surface", spacing: "compact" },
              "results",
            ),
            sec(
              "table",
              {
                heading: "Courses & fees",
                columns: ["Course", "For", "Duration", "Fee"],
                rows: [
                  ["JEE Main + Advanced", "Class 11 & 12", "2 years", "₹1,40,000"],
                  ["NEET", "Class 11 & 12", "2 years", "₹1,30,000"],
                  ["Droppers' batch", "After Class 12", "1 year", "₹90,000"],
                  ["Foundation", "Class 8–10", "1 year", "₹45,000"],
                ],
                style: "cards",
                caption: "Fees payable in instalments. Scholarship test every Sunday.",
              },
              undefined,
              "courses",
            ),
            sec(
              "steps",
              {
                heading: "How a week works",
                layout: "cards",
                items: [
                  { title: "Learn", body: "Five concept classes, three hours each, from the same teacher all year.", icon: "book-open" },
                  { title: "Practise", body: "Daily practice sheets, checked and returned the next day.", icon: "pencil" },
                  { title: "Test", body: "A full test every Sunday with an all-India style rank.", icon: "clipboard-check" },
                  { title: "Fix", body: "One-to-one doubt sessions every evening, 5–8 pm.", icon: "message-circle" },
                ],
              },
              { background: "surface" },
            ),
            sec(
              "imageText",
              {
                eyebrow: "Faculty",
                heading: "Taught by IIT and AIIMS alumni",
                body: "Our eight teachers average twelve years in the classroom. Parents get a monthly progress call — not just marks, but what to work on next.",
                bullets: [
                  { text: "Monthly parent–teacher call", icon: "phone" },
                  { text: "Progress report after every test", icon: "bar-chart-3" },
                ],
                imageSide: "right",
                ...img(photo, "faculty"),
              },
              undefined,
              "faculty",
            ),
            sec("testimonials", {
              heading: "From our students",
              layout: "cards",
              items: [
                { quote: "The Sunday tests made the real exam feel like just another Sunday. AIR 1,284.", author: "Ankit, JEE 2025", rating: 5 },
                { quote: "Evening doubt sessions saved my biology. Now at AIIMS Patna.", author: "Riya, NEET 2025", rating: 5 },
                { quote: "As a parent, the monthly calls told me exactly how my son was doing.", author: "Mr. Prasad", rating: 5 },
              ],
            }),
            sec(
              "form",
              {
                heading: "Book a free demo class",
                subheading: "Sit in a real class this week, with no obligation.",
                layout: "split",
                aside: "We'll call to fix a time. Demo classes run Monday to Saturday at 4 pm.",
                fields: [
                  { name: "student", label: "Student name", type: "text", required: true, width: "half" },
                  { name: "phone", label: "Parent's phone", type: "tel", required: true, width: "half" },
                  { name: "class", label: "Class", type: "select", options: ["8", "9", "10", "11", "12", "Dropper"], required: true, width: "half" },
                  { name: "course", label: "Course", type: "select", options: ["JEE", "NEET", "Foundation"], required: true, width: "half" },
                ],
                submitLabel: "Book my demo",
                successMessage: "Done! We'll call you today to fix a time.",
                destination: { kind: "table", table: "demo_classes" },
              },
              { background: "gradient" },
              "demo",
            ),
            sec("contact", { heading: "Visit the campus", phone: "+91 98765 43210", whatsapp: "919876543210", address: "Near Patna Junction, Station Road, Patna" }),
          ],
        },
      ],
    }),
};

// ---------------------------------------------------------------------------
// 10. Interior design studio
// ---------------------------------------------------------------------------

const interiors: ShowcaseDesign = {
  slug: "interiors",
  name: "Nest Interiors",
  category: "Interiors & real estate",
  kind: "landing",
  description: "Calm, premium and airy: projects, the process, transparent packages and a consultation request.",
  sampleBusiness: "Nest Interiors",
  cover: "hero",
  photos: {
    hero: "modern indian living room interior design warm",
    process: "interior designer material samples moodboard",
    g1: "modern kitchen interior wood",
    g2: "bedroom interior minimal warm",
    g3: "living room indian contemporary",
    g4: "home office interior",
    g5: "dining room pendant lights",
    g6: "bathroom interior stone",
  },
  tables: [
    {
      key: "consultations",
      name: "Consultation requests",
      columns: [
        { key: "name", label: "Name", type: "text" },
        { key: "phone", label: "Phone", type: "tel" },
        { key: "home", label: "Home", type: "select" },
        { key: "budget", label: "Budget", type: "select" },
        { key: "notes", label: "About the project", type: "textarea" },
      ],
    },
  ],
  build: (photo) =>
    site({
      title: "Nest Interiors — homes designed around you",
      description: "Complete home interiors with a fixed price, a fixed date and one team from design to handover.",
      theme: {
        colors: { primary: "#3f6212", background: "#fbfaf7", surface: "#f0eee7", text: "#1f2419", muted: "#6b705f", accent: "#a16207" },
        fonts: { heading: "Lora", body: "Manrope" },
        radius: "md",
        motion: "subtle",
      },
      brand: "Nest Interiors",
      links: [
        { label: "Projects", href: "/#projects" },
        { label: "Process", href: "/#process" },
        { label: "Packages", href: "/#packages" },
      ],
      cta: { label: "Free consultation", href: "/#consult" },
      footer: "Nest Interiors. Design studio and workshop in Patna.",
      pages: [
        {
          path: "/",
          title: "Home",
          sections: [
            sec("hero", {
              eyebrow: "Complete home interiors",
              heading: "A home that fits the way you live",
              subheading: "Design, carpentry and handover by one team — at a price and date fixed before we start.",
              primaryCta: { label: "Book a free consultation", href: "/#consult" },
              secondaryCta: { label: "See projects", href: "/#projects" },
              layout: "fullbleed",
              align: "left",
              badges: ["10-year warranty", "45-day handover"],
              ...img(photo, "hero"),
            }),
            sec(
              "stats",
              {
                items: [
                  { value: "240+", label: "Homes delivered", icon: "home" },
                  { value: "45 days", label: "Average handover", icon: "calendar-check" },
                  { value: "10 yrs", label: "Warranty on woodwork", icon: "shield-check" },
                ],
              },
              { spacing: "compact", background: "surface" },
            ),
            sec(
              "gallery",
              {
                heading: "Recent homes",
                layout: "grid",
                columns: 3,
                items: ["g1", "g2", "g3", "g4", "g5", "g6"].map((g, i) => ({
                  title: ["Walnut kitchen, Boring Road", "Quiet bedroom, Kankarbagh", "Family living, Rajendra Nagar", "Home office, Patliputra", "Dining nook, Bailey Road", "Stone bath, Danapur"][i]!,
                  ...img(photo, g),
                })),
              },
              undefined,
              "projects",
            ),
            sec(
              "steps",
              {
                heading: "From first visit to moving in",
                layout: "timeline",
                items: [
                  { title: "Visit & brief", body: "We measure your home and listen to how you live.", icon: "ruler" },
                  { title: "3D design", body: "Photo-real 3D views and a fixed, itemised quote.", icon: "box" },
                  { title: "Workshop build", body: "Made in our own workshop, quality-checked twice.", icon: "hammer" },
                  { title: "Handover", body: "Installed, cleaned and ready in about 45 days.", icon: "key-round" },
                ],
              },
              { background: "surface" },
              "process",
            ),
            sec("imageText", {
              eyebrow: "Materials",
              heading: "Chosen for Indian homes — and Indian monsoons",
              body: "BWP plywood, soft-close hardware and finishes that survive humidity, spice and children. You see and touch every sample before we cut a single sheet.",
              bullets: [
                { text: "Boiling-water-proof plywood", icon: "droplets" },
                { text: "Hettich and Hafele hardware", icon: "wrench" },
              ],
              imageSide: "left",
              badge: "Samples at your door",
              ...img(photo, "process"),
            }),
            sec(
              "table",
              {
                heading: "Packages",
                subheading: "Fixed prices for complete interiors. Custom quotes for villas.",
                columns: ["Home", "Includes", "From"],
                rows: [
                  ["1 BHK", "Kitchen, wardrobes, TV unit, lighting", "₹4.5 lakh"],
                  ["2 BHK", "Everything in 1 BHK + second bedroom, study", "₹6.9 lakh"],
                  ["3 BHK", "Everything + pooja unit, crockery, false ceiling", "₹9.5 lakh"],
                ],
                style: "cards",
                caption: "Prices include design, materials, installation and GST.",
              },
              undefined,
              "packages",
            ),
            sec("testimonials", {
              heading: "Homeowners",
              layout: "cards",
              items: [
                { quote: "The quote didn't change by a rupee and they handed over two days early.", author: "The Sharmas", rating: 5 },
                { quote: "They designed around my mother's pooja routine. That's when I knew.", author: "Vikas J.", rating: 5 },
                { quote: "Our kitchen survived a full monsoon and a toddler. Still perfect.", author: "Nidhi & Aman", rating: 5 },
              ],
            }),
            sec(
              "form",
              {
                heading: "Book a free consultation",
                subheading: "A designer visits your home, measures up and shares ideas — free.",
                layout: "split",
                aside: "We'll call within a day to fix a visit. No obligation and no pushy sales.",
                fields: [
                  { name: "name", label: "Name", type: "text", required: true, width: "half" },
                  { name: "phone", label: "Phone", type: "tel", required: true, width: "half" },
                  { name: "home", label: "Home", type: "select", options: ["1 BHK", "2 BHK", "3 BHK", "Villa", "Office"], required: true, width: "half" },
                  { name: "budget", label: "Budget", type: "select", options: ["Under ₹5 lakh", "₹5–10 lakh", "₹10–20 lakh", "Above ₹20 lakh"], width: "half" },
                  { name: "notes", label: "About the project", type: "textarea", width: "full" },
                ],
                submitLabel: "Request a visit",
                successMessage: "Thank you! A designer will call you within a day.",
                destination: { kind: "table", table: "consultations" },
              },
              { background: "surface" },
              "consult",
            ),
            sec("contact", { heading: "Visit the studio", body: "See samples and finished pieces in our experience centre.", phone: "+91 98765 43210", whatsapp: "919876543210", address: "Exhibition Road, Patna" }),
          ],
        },
      ],
    }),
};

export const SHOWCASE: ShowcaseDesign[] = [bakery, restaurant, clinic, salon, gym, fashion, electronics, photographer, coaching, interiors];

export function showcaseDesign(slug: string): ShowcaseDesign | undefined {
  return SHOWCASE.find((d) => d.slug === slug);
}
