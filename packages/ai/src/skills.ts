/**
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
Every feature, step and bullet gets an icon that means something (truck for delivery, shield-check for warranty). Use design__search_icons to find exact Lucide names; never guess a name. One icon style per site.

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
