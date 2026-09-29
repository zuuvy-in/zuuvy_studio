/**
 * The Icons8 guidance (ICONS8_GUIDE) is adapted from Icons8's agent skills
 * `icons8` and `ouch` (https://github.com/icons8/agent-skills), Copyright (c)
 * 2026 Icons8 LLC, Apache License 2.0 — see packages/ai/THIRD_PARTY_NOTICES.md.
 *
 * Skills: what a good web designer, copywriter and motion designer know,
 * written for this builder's blocks and settings. They go into the editor's
 * system prompt (static text, so it stays cacheable) and the design kit serves
 * them as MCP prompts and a tool, for any other client.
 */

export const SKILLS = {
  "web-design": {
    title: "Web design",
    summary: "Structure, rhythm and visual hierarchy for a page that looks designed, not assembled.",
    body: `# Web design skill

A site should look like a studio made it for this one business. That comes from a few decisions made firmly.

## Build a page, not a list of blocks
- Open strong: a hero with a promise in under 10 words, one primary button, and proof (badges: "4.9★ on Google", "Since 1998", "Delivered in 2 hours").
- Right after the hero, earn trust fast: a logos band (clients, brands stocked, press) or stats that count up.
- Then the offer (features with icons, or a product grid), how it works (steps), proof (testimonials with ratings), questions (faq), and one closing call to action. Contact last for local businesses.
- A full landing page is 7–10 sections. Never two of the same block type in a row.

## Rhythm: alternate the look down the page
Use style_section so backgrounds alternate — default → surface → default → dark or gradient → default. One or two bold sections (dark, gradient, image) per page are the "wow"; more is noise.
- A marquee band between the hero and the next section adds instant energy.
- Dividers (wave, curve, slant) on one or two sections soften transitions; don't put one on every section.
- Patterns: dots or grid on a surface or dark section add texture; noise suits premium, dark palettes.
- Spacing: roomy for the hero-like statement sections, compact for logos, marquee and stats.

## Hero choices
- A striking photo: layout fullbleed (text over the picture) or split.
- No great photo: layout stacked or classic with backdrop mesh, grid or spotlight, a highlight on the key words and rotating words ("Cakes for [birthdays|weddings|Tuesdays]").
- Keep the eyebrow short, the heading big, the subheading one or two sentences.

## Blocks at their best
- features: layout bento for a showcase (first item is the hero item — make it the strongest benefit, 4–5 items); icons for 3–4 quick benefits; list for many small points (6–8); cards otherwise. Give every item an icon.
- imageText: add an eyebrow, 3–4 bullets with icons and a floating badge on the photo ("Handmade in Patna").
- testimonials: layout marquee for 5+ short quotes, spotlight when one quote is outstanding; add ratings when real.
- stats: 3–4 numbers with icons; numbers that start with digits count up.
- steps: 3–4 steps, layout cards for services, timeline for a journey.
- cta: glow for a dramatic close, split for a practical one, banner otherwise.
- gallery: masonry for portfolios and food, carousel for many images.

## Icons
Every feature, step and bullet gets an icon that means something (truck for delivery, shield-check for warranty). One icon family per site, recorded in the theme's iconPack: Lucide names from design__search_icons by default, or one Icons8 pack when Icons8 is connected and suits the site better. Never guess a name, never mix families.

## Colour and type
Brand colour for buttons, highlights and one bold section — not everywhere. Headings in the heading font, big and tight. Keep text readable on every background (the dark, primary and gradient backgrounds invert text automatically).`,
  },
  content: {
    title: "Content",
    summary: "Copy that sounds like this business and sells: specific, short, proven.",
    body: `# Content skill

Words do more for a small business site than any effect. Write like the owner talking to a good customer.

## Headlines
- Say the outcome, not the category: "Birthday cakes delivered warm, same day in Patna" beats "Welcome to Asha Bakes".
- Under 10 words. Concrete nouns, active verbs. No "Welcome to", "We are passionate about", "Your one-stop shop", "Elevate", "Unlock", "Seamless".
- Section headings are claims too: "Why Patna orders from us", not "Features".

## Body copy
- One idea per sentence; two or three sentences per block. Short words.
- Specific beats superlative: "Baked at 5 am, at your door by 11" beats "Freshly baked". Use numbers the owner gave you.
- Write to "you"; the business is "we".
- Indian English spelling and context: rupees (₹), local areas, WhatsApp, cash on delivery, festivals when relevant.

## Proof
- Put the strongest proof high: years, customers served, ratings, brands stocked, certifications — only real facts. When you don't have them, write proof that needs no numbers ("Family-run since my grandfather's time" only if true; otherwise "Every order packed by hand").
- Testimonials: never invent names or quotes presented as real. If the owner gave none, leave testimonials out or write the section as a "What you get" promise instead.

## Calls to action
- Verb + outcome: "Order on WhatsApp", "Book a free trial class", "See this week's menu". Never "Submit", "Click here", "Learn more" alone.
- One primary action per section; the secondary one is softer ("See prices").

## FAQ
Answer the real objections: delivery area and time, payment (COD/UPI), returns, custom orders, prices. One or two sentences each.

## Short inputs
From a one-line request, infer the audience and their worries, and write for them. Choose rotating words, badges and marquee phrases that capture the business in a glance ("Free delivery · Eggless options · Custom designs").`,
  },
  imagery: {
    title: "Imagery",
    summary: "Which picture where: real photos, illustrations or icons, used as one consistent set.",
    body: `# Imagery skill

Pictures decide whether a site looks real. No picture is generated: use the owner's own pictures first, then real photography (design__search_photos, from Unsplash), then drawn illustrations and icons (Icons8, when its tools are listed).

## Choose the kind for the job
- **The owner's photos** (media library): always first for their products, shop, food, team and work — nothing sells like the real thing.
- **Photography**: real places, people, food, products, materials. Heroes of food, fashion, travel, hospitality, beauty, fitness, real estate. Search concrete, local words ("indian thali on a steel plate", "tailor measuring fabric") and pick photos that could plausibly be this business; avoid obvious stock (handshakes, headsets, suits pointing at screens).
- **Illustration**: ideas a photo cannot show — how a service works, software and tech, finance, education, onboarding, empty states, 404, "coming soon". Good for startups, SaaS, agencies, apps and kids' brands.
- **Icons**: small symbols beside words — features, steps, bullets, stats, contact details. Never as a hero picture.

## One set, never a pile
- A page uses one photographic mood (warm daylight, or moody low-key, not both) and at most one illustration style. Record the illustration style and icon family in the theme (set_theme illustrationStyle / iconPack) the first time you choose them, and keep to them afterwards.
- Photos and illustrations can share a page (a photo hero, illustrated steps) but never the same row: a row of cards is all photos or all illustrations.
- Same crop per row: gallery and card images at one aspect.

## Placement
- Hero: the strongest single picture; landscape for classic and split, a wide calm photo for fullbleed (text sits on it).
- imageText: one picture that shows exactly what the text says.
- Gallery: 6–9 photos with variety of distance (wide, medium, close-up).
- Don't fill every section with a picture; stats, FAQ, testimonials and CTAs read better without.

## Honesty and credit
- Alt text says what the picture shows, in plain words.
- Unsplash photos: keep the URL as given; credit the photographer in a caption or the footer.
- Icons8 free assets require a credit: add "Icons by Icons8" / "Illustrations by Icons8" linking to https://icons8.com in the footer links.`,
  },
  animation: {
    title: "Animation",
    summary: "Motion that guides the eye and makes the site feel alive, never busy.",
    body: `# Animation skill

Motion should feel like the site is breathing, and always point at what matters. Everything here is CSS: fast on any phone, and turned off automatically for people who ask their device for reduced motion.

## The theme's motion (set_theme motion)
- subtle (default): content rises in as it scrolls into view, cards lift on hover, the hero arrives in sequence. Right for most businesses: clinics, services, B2B, premium.
- lively: bigger entrances, a drifting hero picture, moving gradients. Right for food, fashion, kids, events, launches, creative work.
- none: only when the owner asks for a still site.

## Per section (style_section animation)
Leave most sections on auto. Give one or two a different entrance for emphasis:
- zoom for a gallery or product grid, blur for a dramatic statement, slide for imageText, fade for testimonials, none for dense text.

## Moving pieces that make a "wow" — use two or three per page, not all
- hero rotating words: 2–4 short words that cycle after the heading.
- hero highlight: the key words painted in a moving brand gradient.
- marquee band: an endlessly moving strip of short phrases right under the hero.
- logos with marquee: brands or clients scrolling past.
- testimonials layout marquee: a moving wall of short quotes.
- stats: numbers count up as they appear (values starting with a digit, no commas).
- background gradient or mesh on one section, and a glow call to action at the end: slow, drifting colour.
- imageText badge: a floating label that gently bobs.

## Restraint
Motion supports reading; it never delays it. One moving band per page. Don't combine lively motion with a busy pattern and a gradient on the same section.`,
  },
} as const;

export type SkillName = keyof typeof SKILLS;
export const SKILL_NAMES = Object.keys(SKILLS) as SkillName[];

/** All three, for the system prompt. */
export function skillsForPrompt(): string {
  return SKILL_NAMES.map((n) => SKILLS[n].body).join("\n\n");
}

/**
 * How to use Icons8's MCP tools well, condensed for this builder. Shown only
 * when an Icons8 server is connected (its tools are named icons8__…).
 */
export const ICONS8_GUIDE = `## Icons8 (icons and illustrations)
The Icons8 tools search a huge catalogue but have no taste: unfiltered search returns one idea in ten styles, and ranking puts brand logos above plain UI icons. Work like this:

Icons
1. List every concept the page needs first (features, steps, bullets, contact), then pick ONE pack for the whole site that covers them, and record it with set_theme iconPack "icons8:<apiCode>". If the site already has an iconPack, use only that pack — even for one extra icon. Use exact apiCodes: mono packs for small UI-sized icons that take the brand colour — m_outlined, ios7, fluent-systems-regular; colour packs for big marketing icons — color, plumpy, fluency, 3d-fluency. Never mix packs.
2. Search once per concept, always with the platform set: search_icons(query, platform=<pack>, amount=10). Words that fail: search the object instead (warning → error, notification → bell, dark mode → moon, integration → plugin).
3. Reject: brand logos (category Logos, names ending -logo) for UI concepts; machine parts for UI actions (gear from Industry); compound icons when a plain one exists; --v2/--v3 variants when the plain name exists; any icon whose name does not mean the concept. Prefer the plain name, then category Popular or User Interface.
4. Use the free PNG URL directly in an icon field — never construct an id, it comes from search_icons:
   https://img.icons8.com/?id=<id>&format=png&size=96&color=000000
   For mono packs keep &color=000000: the site redraws such icons in its own colours. Colour packs: leave color out. Do not fetch SVG for icons.

Illustrations (Ouch!)
1. Pick the style by the surface and tone: warm and human → hand-drawn or sketch styles; neutral product → concept, tint, organic; corporate → 3d-business; premium → 3d-glassy, 3d-product; playful → kindy, 3d-kindy, mochi; developer → notion-line-art. Run one search on the business's own noun first ("bread loaf bakery") and read which styles actually draw it. Record the choice with set_theme illustrationStyle and keep to it.
2. Every query carries the business's noun ("empty" + "pot" for no plants; "delivery" + "cake"). For an absence (empty, 404, offline) show the empty container, never the thing that is missing.
3. Choose on previews, but a preview link is watermarked: never put it on the site. For each picture you keep, get the clean file (get_illustration_png_url size "standard" for cards, "hd" for a hero; or get_illustration_svg for flat and line styles), then save it with save_image — clean links expire within the hour — and use the URL save_image returns.
4. Public sites use free-tier illustrations only (free_only: true), one picture per slot, never the same picture twice, same shape per row.

Credit: free Icons8 assets need attribution — add "Icons by Icons8" (or "Illustrations by Icons8") linking to https://icons8.com to the footer links.`;
