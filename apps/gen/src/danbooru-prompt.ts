import type { AssetKind } from "./asset-kind";
/**
 * Danbooru-tag prompt synthesis architecture (Content-Neutral / ADR-0005).
 *
 * Diffusion models (AOM3, Pony, SD1.5, SDXL anime checkpoints) and WD14 taggers do not know
 * proprietary character names. They require explicit Danbooru tag tokens describing subjects,
 * appearance, physical characteristics, distinctive identity features, expression, pose,
 * body description, anatomy description, and rating ('uncensored').
 *
 * This module is completely generic and world-agnostic. It dynamically reads and tokenizes
 * character cards, place cards, and asset names from whatever world is currently loaded,
 * without relying on hardcoded private story lore.
 */

export interface CardData {
  path: string;
  card?: {
    fm: {
      id: string;
      kind: string;
      name: string;
      role?: string;
      keywords?: string | readonly string[];
    };
    body: string;
  };
  text: string;
}

const EXPRESSION_TAGS: Record<string, string[]> = {
  neutral: ["parted lips", "looking at viewer", "calm expression"],
  flustered: ["blushing", "embarrassed", "shy", "open mouth", "looking at viewer"],
  submissive: ["blushing", "teary eyes", "looking down", "open mouth", "drooling", "submissive"],
  anxious: ["sweating", "nervous", "worried", "looking aside", "trembling"],
  smug: ["smug", "smirk", "looking down", "narrowed eyes"],
  commanding: ["stern", "sharp look", "looking at viewer", "serious", "intense gaze"],
  relieved: ["relieved smile", "closed eyes", "sigh"],
  panicked: ["wide eyes", "open mouth", "terrified", "sweating"],
  dazed: ["blank eyes", "dazed", "parted lips", "unfocused eyes"],
  angry: ["angry", "scowling", "furrowed brow", "clutched teeth"],
  happy: ["smile", "cheerful", "bright eyes", "open mouth"],
  cheerful: ["smile", "cheerful", "bright eyes", "open mouth"],
  sad: ["crying", "tears", "sad", "looking down"],
  seductive: ["seductive smile", "bedroom eyes", "heavy breathing", "flushed cheeks"],
  lustful: ["seductive smile", "bedroom eyes", "heavy breathing", "flushed cheeks"],
  demanding: ["stern", "authoritative", "intense gaze", "looking at viewer"],
  reluctant: ["hesitant", "looking away", "blushing", "biting lip"],
  embarrassed: ["blushing", "embarrassed", "hands in front", "looking down"],
  serious: ["serious expression", "intense gaze", "looking at viewer"],
};

const POSE_TAGS: Record<string, string[]> = {
  submissive: ["standing", "full body", "looking down", "hands clasped in front", "knees slightly bent"],
  flustered: ["standing", "full body", "fidgeting", "hands in front"],
  anxious: ["standing", "full body", "defensive posture", "hunched shoulders"],
  commanding: ["standing", "full body", "arms crossed", "upright posture"],
  smug: ["standing", "full body", "hand on hip", "looking down"],
  demanding: ["standing", "full body", "hands on hips"],
  default: ["standing", "full body", "arms at sides"],
};

/**
 * Searches cards dynamically for character matches.
 */
function findCharacterCard(charName: string, cardFiles: CardData[]): CardData | undefined {
  const norm = charName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!norm) return undefined;

  for (const f of cardFiles) {
    const fPath = f.path.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (fPath.includes(norm)) return f;

    const cName = (f.card?.fm.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cName.includes(norm)) return f;

    const rawKw = f.card?.fm.keywords;
    const kwArray = Array.isArray(rawKw) ? rawKw : typeof rawKw === "string" ? [rawKw] : [];
    if (kwArray.some((k) => typeof k === "string" && k.toLowerCase().replace(/[^a-z0-9]/g, "").includes(norm))) {
      return f;
    }
  }
  return undefined;
}

/**
 * Extracts Danbooru-tag compatible descriptors dynamically from card markdown & XML fields.
 */
function extractTagsFromCard(text: string): {
  subject?: string;
  appearance: string[];
  body: string[];
  wardrobe: string[];
} {
  const appearance: string[] = [];
  const body: string[] = [];
  const wardrobe: string[] = [];

  const lower = text.toLowerCase();

  // Age extraction: "22-year-old", "age: 25", "22yo", etc.
  const ageMatch = lower.match(/\b(\d{1,2})[ -]year[ -]old\b/) || lower.match(/\bage:?\s*(\d{1,2})\b/);
  if (ageMatch?.[1]) {
    appearance.push(`${ageMatch[1]}yo`);
  }

  // Subject / Gender
  let subject: string | undefined;
  if (/futa|hermaphrodite/.test(lower)) {
    subject = "1girl, solo, futanari";
  } else if (/monster girl|chimera/.test(lower)) {
    subject = "1girl, monster girl, solo";
  } else if (/girl|woman|female|heroine|lady|mother|sister|maid|slut/.test(lower)) {
    subject = "1girl, solo";
  } else if (/man|male|gentleman|guy|boy|father|brother|butler|clerk|manager/.test(lower)) {
    subject = "1man, solo";
  }

  // Hair colors & styles
  if (/dark brown hair/.test(lower)) appearance.push("dark brown hair");
  else if (/light brown hair/.test(lower)) appearance.push("light brown hair");
  else if (/brown hair/.test(lower)) appearance.push("brown hair");
  else if (/black hair/.test(lower)) appearance.push("black hair");
  else if (/blonde hair|blond hair/.test(lower)) appearance.push("blonde hair");
  else if (/silver hair/.test(lower)) appearance.push("silver hair");
  else if (/white hair/.test(lower)) appearance.push("white hair");
  else if (/red hair/.test(lower)) appearance.push("red hair");
  else if (/pink hair/.test(lower)) appearance.push("pink hair");
  else if (/blue hair/.test(lower)) appearance.push("blue hair");
  else if (/green hair/.test(lower)) appearance.push("green hair");
  else if (/sandy hair/.test(lower)) appearance.push("sandy hair");

  if (/bob cut/.test(lower)) appearance.push("bob cut");
  if (/straight bangs/.test(lower)) appearance.push("straight bangs");
  else if (/bangs/.test(lower)) appearance.push("bangs");
  if (/french twist/.test(lower)) appearance.push("french twist");
  if (/updo/.test(lower)) appearance.push("updo");
  if (/ponytail/.test(lower)) appearance.push("ponytail");
  if (/twintails|twin tails/.test(lower)) appearance.push("twintails");
  if (/braid/.test(lower)) appearance.push("braid");
  if (/pixie cut|short hair/.test(lower)) appearance.push("short hair");
  if (/long hair/.test(lower)) appearance.push("long hair");

  // Face / Eyes / Features
  if (/brown eyes/.test(lower)) appearance.push("brown eyes");
  else if (/blue eyes/.test(lower)) appearance.push("blue eyes");
  else if (/green eyes/.test(lower)) appearance.push("green eyes");
  else if (/red eyes|crimson eyes/.test(lower)) appearance.push("red eyes");
  else if (/amber eyes/.test(lower)) appearance.push("amber eyes");
  else if (/dark eyes/.test(lower)) appearance.push("dark eyes");

  if (/glasses/.test(lower)) appearance.push("glasses");
  if (/red lipstick/.test(lower)) appearance.push("red lipstick");
  if (/blush/.test(lower)) appearance.push("blush");
  if (/fair skin/.test(lower)) appearance.push("fair skin");
  else if (/pale skin/.test(lower)) appearance.push("pale skin");
  else if (/tan skin|tanned skin/.test(lower)) appearance.push("tanned skin");
  else if (/dark skin/.test(lower)) appearance.push("dark skin");

  // Body & Anatomy
  if (/slender|petite/.test(lower)) body.push("slender", "petite");
  if (/curvy/.test(lower)) body.push("curvy");
  if (/broad shoulders/.test(lower)) body.push("broad shoulders");
  if (/heavy jowl/.test(lower)) body.push("heavy jowl");
  if (/small breasts|flat chest/.test(lower)) body.push("small breasts");
  else if (/large breasts|huge breasts/.test(lower)) body.push("large breasts");
  else if (/medium breasts/.test(lower)) body.push("medium breasts");
  if (/navel/.test(lower)) body.push("navel");
  if (/collarbone/.test(lower)) body.push("collarbone");

  // Non-human / Stylized features (if defined in the card)
  if (/animal ears|cat ears|fox ears|wolf ears|elf ears/.test(lower)) {
    const earMatch = lower.match(/\b(cat|fox|wolf|elf|rabbit|bunny|animal)\s*ears\b/);
    body.push(earMatch ? earMatch[0] : "animal ears");
  }
  if (/fangs/.test(lower)) body.push("sharp canine fangs");
  if (/wings|membrane|glider/.test(lower)) body.push("wings");
  if (/horns/.test(lower)) body.push("horns");
  if (/tail/.test(lower)) body.push("tail");
  if (/digitigrade/.test(lower)) body.push("digitigrade legs");

  // Wardrobe / Clothing (generic keywords)
  if (/crop top/.test(lower)) wardrobe.push("crop top");
  if (/shirt|blouse|collared shirt/.test(lower)) wardrobe.push("shirt");
  if (/micro miniskirt|miniskirt|skirt/.test(lower)) {
    const skirtMatch = lower.match(/\b(micro miniskirt|miniskirt|pencil skirt|pleated skirt|skirt)\b/);
    wardrobe.push(skirtMatch ? skirtMatch[0] : "skirt");
  }
  if (/thighhighs|stockings|tights|pantyhose/.test(lower)) {
    const legMatch = lower.match(/\b(thighhighs|stockings|pantyhose|tights)\b/);
    wardrobe.push(legMatch ? legMatch[0] : "thighhighs");
  }
  if (/high heels|heels|boots|shoes/.test(lower)) {
    const footMatch = lower.match(/\b(high heels|boots|shoes|sneakers)\b/);
    wardrobe.push(footMatch ? footMatch[0] : "high heels");
  }
  if (/suit|blazer|business suit/.test(lower)) wardrobe.push("business suit");
  if (/necktie|tie/.test(lower)) wardrobe.push("necktie");

  return { subject, appearance, body, wardrobe };
}

/**
 * Splits asset name into character and expression components.
 * e.g. "heroine_flustered" -> { charName: "heroine", expr: "flustered" }
 * e.g. "manager_commanding" -> { charName: "manager", expr: "commanding" }
 */
export function parseSpriteName(spriteName: string): { charName: string; expr: string } {
  const clean = spriteName.replace(/\.(png|jpg|jpeg|webp)$/i, "");
  const parts = clean.split("_");

  if (parts.length > 1) {
    const lastPart = (parts[parts.length - 1] ?? "").toLowerCase();
    if (EXPRESSION_TAGS[lastPart]) {
      return {
        charName: parts.slice(0, -1).join(" "),
        expr: lastPart,
      };
    }
  }

  return { charName: clean.replace(/_/g, " "), expr: "neutral" };
}

/**
 * Synthesizes Danbooru-tag positive prompt for a character sprite dynamically.
 */
export function synthesizeSpriteDanbooruPrompt(
  spriteName: string,
  cardFiles: CardData[] = [],
): string {
  const { charName, expr } = parseSpriteName(spriteName);
  const normChar = charName.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Match dynamic card if available
  const card = findCharacterCard(charName, cardFiles);
  const cardExtracted = card ? extractTagsFromCard(card.text) : undefined;

  // Build ordered Danbooru tokens
  const tokens: string[] = [
    "masterpiece",
    "best quality",
  ];

  // Subject / Count
  let subject = cardExtracted?.subject;
  if (!subject) {
    if (normChar.includes("man") || normChar.includes("male") || normChar.includes("boy") || normChar.includes("guy")) {
      subject = "1man, solo";
    } else {
      subject = "1girl, solo";
    }
  }
  tokens.push(subject);

  // Identity & Appearance
  const appearanceTokens = new Set<string>();
  if (cardExtracted) {
    cardExtracted.appearance.forEach((t) => appearanceTokens.add(t));
  }
  if (appearanceTokens.size === 0) {
    appearanceTokens.add("detailed hair");
    appearanceTokens.add("detailed eyes");
    appearanceTokens.add("fair skin");
  }
  appearanceTokens.forEach((t) => tokens.push(t));

  // Body & Physical Characteristics & Anatomy
  const bodyTokens = new Set<string>();
  if (cardExtracted) {
    cardExtracted.body.forEach((t) => bodyTokens.add(t));
  }
  if (bodyTokens.size === 0) {
    bodyTokens.add("slender");
    bodyTokens.add("collarbone");
  }
  bodyTokens.forEach((t) => tokens.push(t));

  // Expression tags
  const exprTokens = EXPRESSION_TAGS[expr.toLowerCase()] || EXPRESSION_TAGS.neutral || ["looking at viewer"];
  exprTokens.forEach((t) => tokens.push(t));

  // Pose tags
  const poseTokens = POSE_TAGS[expr.toLowerCase()] || POSE_TAGS.default || ["standing", "full body"];
  poseTokens.forEach((t) => tokens.push(t));

  // Wardrobe tags
  const wardrobeTokens = new Set<string>();
  if (cardExtracted) {
    cardExtracted.wardrobe.forEach((t) => wardrobeTokens.add(t));
  }
  if (wardrobeTokens.size === 0) {
    wardrobeTokens.add("casual clothes");
  }
  wardrobeTokens.forEach((t) => tokens.push(t));

  // Rating: Always 'uncensored'
  tokens.push("uncensored");

  // Composition / Sprite background
  tokens.push("simple background", "white background", "character cutout");

  // Deduplicate preserving order
  const uniqueTokens: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const trimmed = t.trim();
    if (trimmed && !seen.has(trimmed.toLowerCase())) {
      seen.add(trimmed.toLowerCase());
      uniqueTokens.push(trimmed);
    }
  }

  return uniqueTokens.join(", ");
}

/**
 * Synthesizes Danbooru-tag positive prompt for a cinematic narrative CG scene dynamically.
 */
export function synthesizeCgDanbooruPrompt(
  cgName: string,
  _cardFiles: CardData[] = [],
): string {
  const clean = cgName.replace(/\.(png|jpg|jpeg|webp)$/i, "").toLowerCase();

  const tokens: string[] = [
    "masterpiece",
    "best quality",
    "ultra-detailed",
    "cinematic event CG",
    "16:9 widescreen",
    "dramatic atmospheric lighting",
    "detailed background",
    "depth of field",
  ];

  // Dynamic context clues from CG name tokens
  if (clean.includes("office") || clean.includes("alcove") || clean.includes("desk")) {
    tokens.push("office interior", "indoor lighting");
  } else if (clean.includes("window") || clean.includes("balcony")) {
    tokens.push("large window", "city view");
  } else if (clean.includes("night") || clean.includes("dark")) {
    tokens.push("night", "atmospheric shadows");
  } else if (clean.includes("climax") || clean.includes("drama")) {
    tokens.push("emotional climax", "dynamic narrative focus");
  }

  tokens.push(
    clean.replace(/^cg_/, "").replace(/_/g, " "),
    "narrative focal point",
    "uncensored",
  );

  return tokens.join(", ");
}

/**
 * Synthesizes Danbooru-tag positive prompt for a visual novel background dynamically.
 */
export function synthesizeBackgroundDanbooruPrompt(
  bgName: string,
  _cardFiles: CardData[] = [],
): string {
  const clean = bgName.replace(/\.(png|jpg|jpeg|webp)$/i, "").toLowerCase();

  const tokens: string[] = [
    "no humans",
    "masterpiece",
    "best quality",
    "ultra-detailed",
    "16:9 widescreen",
    "visual novel background",
    "scenery",
    "background art",
    "detailed interior",
    "atmospheric lighting",
  ];

  if (clean.includes("office") || clean.includes("aisle") || clean.includes("cubicle")) {
    tokens.push("office interior", "desks", "computers", "modern corporate architecture");
  } else if (clean.includes("meeting") || clean.includes("conference") || clean.includes("boardroom")) {
    tokens.push("meeting room", "conference table", "ergonomic chairs", "presentation screen");
  } else if (clean.includes("desk") || clean.includes("executive")) {
    tokens.push("executive office", "mahogany desk", "panoramic city view");
  } else {
    tokens.push(clean.replace(/^bg_/, "").replace(/_/g, " "), "anime scenery", "environmental landscape");
  }

  return tokens.join(", ");
}

/**
 * Default negative prompts per asset type.
 */
export function getDefaultNegativePrompt(type: AssetKind): string {
  if (type === "clothes" || type === "adornment" || type === "object") {
    return "1girl, 1boy, solo, person, model, mannequin, wearing, worn, body, torso, legs, feet, skin, nude, breasts, face, hands, holding, multiple items, text, watermark, signature, blurry, lowres, worst quality, low quality";
  }
  if (type === "sprite") {
    return "2girls, multiple girls, 2bodies, bad anatomy, bad hands, missing fingers, extra digits, blurry, worst quality, low quality, normal quality, signature, watermark, cropped, censored, bar censor, mosaic censor";
  }
  if (type === "cg") {
    return "worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, blurry, deformed, cropped, signature, watermark, censored, bar censor, mosaic censor";
  }
  return "1girl, 1boy, human, person, character, people, crowd, text, watermark, signature, blurry, lowres, worst quality, low quality";
}
