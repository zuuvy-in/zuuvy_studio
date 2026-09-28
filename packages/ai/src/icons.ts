/**
 * The icon names a site can use (Lucide, drawn by the runtime) and a search
 * over them that works with no network: name words plus a few hundred
 * everyday synonyms, since "delivery" should find "truck".
 */
import lucide from "@iconify-json/lucide/icons.json";

const SET = lucide as unknown as { icons: Record<string, unknown>; aliases?: Record<string, unknown> };
export const ICON_NAMES: string[] = Object.keys(SET.icons);
const ALL = new Set([...ICON_NAMES, ...Object.keys(SET.aliases ?? {})]);

export const isIconName = (name: string) => ALL.has(name);

/** Everyday words → Lucide words, for a business describing what it does. */
const SYNONYMS: Record<string, string[]> = {
  delivery: ["truck", "package", "bike", "map-pin"],
  shipping: ["truck", "package", "plane"],
  fast: ["zap", "timer", "rocket", "gauge"],
  quick: ["zap", "timer", "rocket"],
  quality: ["badge-check", "award", "gem", "shield-check"],
  trust: ["shield-check", "handshake", "badge-check", "lock"],
  secure: ["lock", "shield-check", "key"],
  safe: ["shield-check", "lock", "heart-handshake"],
  price: ["indian-rupee", "tag", "wallet", "badge-percent"],
  money: ["indian-rupee", "wallet", "banknote", "piggy-bank"],
  payment: ["credit-card", "wallet", "indian-rupee", "qr-code"],
  discount: ["badge-percent", "tag", "percent", "gift"],
  offer: ["gift", "badge-percent", "sparkles"],
  support: ["headset", "life-buoy", "message-circle", "phone"],
  help: ["life-buoy", "circle-help", "headset"],
  call: ["phone", "phone-call", "smartphone"],
  chat: ["message-circle", "messages-square", "send"],
  whatsapp: ["message-circle", "phone"],
  email: ["mail", "send", "inbox"],
  location: ["map-pin", "map", "navigation", "store"],
  shop: ["store", "shopping-bag", "shopping-cart"],
  store: ["store", "shopping-bag"],
  food: ["utensils", "chef-hat", "soup", "cake"],
  bakery: ["cake", "croissant", "cookie", "wheat"],
  cafe: ["coffee", "cup-soda", "croissant"],
  restaurant: ["utensils", "chef-hat", "wine"],
  fresh: ["leaf", "sprout", "sun", "droplet"],
  organic: ["leaf", "sprout", "trees"],
  eco: ["leaf", "recycle", "sprout"],
  handmade: ["hand", "scissors", "palette", "heart"],
  craft: ["palette", "scissors", "brush", "hammer"],
  fashion: ["shirt", "scissors", "sparkles", "gem"],
  clothes: ["shirt", "scissors"],
  jewellery: ["gem", "diamond", "sparkles"],
  beauty: ["sparkles", "flower", "heart", "scissors"],
  salon: ["scissors", "sparkles", "brush"],
  health: ["heart-pulse", "stethoscope", "activity", "pill"],
  doctor: ["stethoscope", "hospital", "heart-pulse"],
  fitness: ["dumbbell", "activity", "heart-pulse", "timer"],
  education: ["graduation-cap", "book-open", "school", "lightbulb"],
  learn: ["book-open", "graduation-cap", "lightbulb"],
  tech: ["cpu", "laptop", "code", "wifi"],
  mobile: ["smartphone", "tablet-smartphone", "battery-charging"],
  electronics: ["cpu", "smartphone", "headphones", "plug"],
  charger: ["battery-charging", "plug", "zap"],
  home: ["house", "sofa", "lamp"],
  repair: ["wrench", "hammer", "settings"],
  service: ["wrench", "handshake", "headset"],
  travel: ["plane", "map", "luggage", "compass"],
  event: ["calendar", "party-popper", "ticket"],
  wedding: ["heart", "gem", "party-popper"],
  calendar: ["calendar", "calendar-check", "clock"],
  time: ["clock", "timer", "hourglass"],
  hours: ["clock", "calendar-clock"],
  star: ["star", "sparkles", "award"],
  review: ["star", "message-square-quote", "thumbs-up"],
  love: ["heart", "heart-handshake", "smile"],
  family: ["users", "heart", "house"],
  team: ["users", "handshake", "user-check"],
  customer: ["users", "smile", "user-check"],
  experience: ["award", "trophy", "calendar"],
  award: ["award", "trophy", "medal"],
  growth: ["trending-up", "chart-line", "rocket"],
  guarantee: ["shield-check", "badge-check", "rotate-ccw"],
  returns: ["rotate-ccw", "undo-2", "package"],
  warranty: ["shield-check", "badge-check"],
  gift: ["gift", "party-popper"],
  india: ["indian-rupee", "flag", "map"],
  camera: ["camera", "image", "aperture"],
  music: ["music", "headphones", "mic"],
  design: ["palette", "pen-tool", "layers"],
  build: ["hammer", "hard-hat", "building"],
  car: ["car", "fuel", "gauge"],
  pet: ["paw-print", "dog", "cat"],
  plant: ["sprout", "flower", "leaf"],
  water: ["droplet", "waves", "glass-water"],
  energy: ["zap", "sun", "battery-charging"],
  check: ["circle-check", "check", "badge-check"],
  idea: ["lightbulb", "sparkles", "brain"],
  process: ["list-ordered", "workflow", "route"],
  contact: ["phone", "mail", "map-pin", "message-circle"],
};

/** Best matches first: exact name, synonyms, name starting with the word, name containing it. */
export function searchIcons(query: string, limit = 12): string[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const scores = new Map<string, number>();
  const add = (name: string, score: number) => {
    if (!ALL.has(name)) return;
    scores.set(name, Math.max(scores.get(name) ?? 0, score));
  };
  for (const w of words) {
    add(w, 100);
    for (const s of SYNONYMS[w] ?? SYNONYMS[w.replace(/s$/, "")] ?? []) add(s, 80);
    for (const name of ICON_NAMES) {
      const parts = name.split("-");
      if (parts[0] === w) add(name, 60 - parts.length);
      else if (parts.includes(w)) add(name, 45 - parts.length);
      else if (w.length > 3 && name.includes(w)) add(name, 25 - parts.length);
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, limit)
    .map(([n]) => n);
}

/** Icon names in some props that the runtime cannot draw. URLs are fine. */
export function unknownIcons(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) unknownIcons(v, found);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "icon" && typeof v === "string" && !/^https:\/\//i.test(v) && !ALL.has(v)) found.push(v);
      else unknownIcons(v, found);
    }
  }
  return found;
}
