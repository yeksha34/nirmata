import { Fragment, type ReactNode, useEffect } from "react";
import { HI_SERVER } from "./i18n-server";
import { HI_TEMPLATES } from "./i18n-templates";
import { HI_TEXT } from "./i18n-text";

/**
 * Labels that show in Hindi and give their English when you hover them (or tap them, on a touch
 * screen, or focus the control they belong to), as in the Nirmata design canvas. This is not a
 * language setting: every label carries both words, nothing is stored, and what people write
 * (card names, story text, nicknames) is never translated. A label with no Hindi here shows in
 * English alone. The English text stays in the page for screen readers and for search.
 *
 * The Hindi was written for this app and has not been reviewed by a native reader; correct it
 * here, in one place.
 */
const WORDS: Record<string, string> = {
  // header and brand
  Nirmata: "निर्माता",
  Worlds: "संसार",
  Host: "यजमान",
  Playing: "खेल रहे हैं",
  Watching: "देख रहे हैं",
  "Leave the table": "पटल छोड़ें",
  "Jump to a world or card": "संसार या पत्रक पर जाएँ",

  // front page
  "For storytellers, alone or at a table": "कथाकारों के लिए, अकेले अथवा पटल पर",
  "Build worlds. Host stories in them.": "संसार रचें। उनमें कथाएँ सुनाएँ।",
  "A world is a folder of cards you write once: people, places, plots, rules. A story is one run inside it, with its own copy, so the world stays yours while the story goes wherever it goes.":
    "संसार पत्रकों का एक संग्रह है जिसे आप एक बार लिखते हैं: लोग, स्थान, कथानक, नियम। कथा उसके भीतर की एक यात्रा है, जिसकी अपनी प्रति होती है; इसलिए संसार आपका ही रहता है और कथा जहाँ चाहे जाती है।",
  "Pick up where you left off": "जहाँ छोड़ा था, वहीं से",
  "Your worlds": "आपके संसार",
  "New world": "नवीन संसार",
  "Looking for your stories…": "आपकी कथाएँ खोजी जा रही हैं…",
  "Looking for your worlds…": "आपके संसार खोजे जा रहे हैं…",
  Continue: "आगे बढ़ें",
  "A story is open": "एक कथा खुली है",
  "Put the story away": "कथा समेट दें",

  // a world
  Play: "खेलें",
  Cards: "पत्रक",
  Stories: "कथाएँ",
  World: "संसार",
  "← Front page": "← मुखपृष्ठ",
  "← All worlds": "← सभी संसार",
  "← All cards": "← सभी पत्रक",
  "Go to the cards": "पत्रकों पर जाएँ",
  "Opening the world…": "संसार खुल रहा है…",
  "Start a new story": "नई कथा आरंभ करें",
  "Begin with": "आरंभ करें",
  "Let the story begin its own way": "कथा को अपने ढंग से आरंभ होने दें",
  "Saved stories": "संचित कथाएँ",
  "Edit the world": "संसार संपादित करें",
  "Make the world": "संसार बनाएँ",
  "Put away": "समेट दें",
  "Put it away": "समेट दें",
  "Keep it": "रहने दें",
  Title: "शीर्षक",
  "A line about it": "एक पंक्ति परिचय",
  "A line about it (optional)": "एक पंक्ति परिचय (वैकल्पिक)",
  "What is it like? (optional)": "यह कैसा है? (वैकल्पिक)",
  Genre: "विधा",
  Tone: "स्वर",
  "Told in": "कथन-शैली",
  "First person (I)": "उत्तम पुरुष (मैं)",
  "Second person (you)": "मध्यम पुरुष (आप)",
  "Third person (they)": "अन्य पुरुष (वे)",
  "Separate words with commas.": "शब्दों को अल्पविराम से अलग करें।",
  "None yet.": "अभी कुछ नहीं।",
  "This world can't be read": "यह संसार पढ़ा नहीं जा सकता",

  // kinds of card
  Characters: "पात्र",
  Places: "स्थान",
  Lore: "विद्या",
  Rules: "नियम",
  "Story arcs": "कथानक-चाप",
  Scenes: "दृश्य",
  "New card": "नया पत्रक",
  "Character card": "पात्र-पत्रक",
  "Place card": "स्थान-पत्रक",
  "Lore entry card": "विद्या-पत्रक",
  "Rule card": "नियम-पत्रक",
  "Story arc card": "कथानक-पत्रक",
  "Scene card": "दृश्य-पत्रक",
  Character: "पात्र",
  Place: "स्थान",
  "Lore entry": "विद्या-प्रविष्टि",
  Rule: "नियम",
  "Story arc": "कथानक-चाप",
  Scene: "दृश्य",
  "New character": "नया पात्र",
  "New place": "नया स्थान",
  "New lore entry": "नई विद्या-प्रविष्टि",
  "New rule": "नया नियम",
  "New story arc": "नया कथानक-चाप",
  "New scene": "नया दृश्य",
  "One card can't be read": "एक पत्रक पढ़ा नहीं जा सका",
  "Fix as text": "पाठ में सुधारें",

  // the editor
  Name: "नाम",
  Keywords: "संकेत-शब्द",
  Summary: "सारांश",
  "Part in the story": "कथा में भूमिका",
  "How strict": "कितना कठोर",
  "Applies to": "किस पर लागू",
  "Should: dropped first if space runs short": "चाहिए: स्थान कम पड़े तो सबसे पहले हटे",
  "Must: never dropped": "अनिवार्य: कभी नहीं हटता",
  "Stories and chapters": "कथाएँ और अध्याय",
  "Stories only": "केवल कथाएँ",
  "Chapters only": "केवल अध्याय",
  "Always in the storyteller's view": "कथावाचक की दृष्टि में सदा",
  "The details": "विवरण",
  "More notes": "और टिप्पणियाँ",
  Body: "मुख्य भाग",
  "Parts from": "इन अंगों से",
  "Start from": "यहाँ से आरंभ करें",
  "View raw file": "मूल संचिका देखें",
  Saved: "संचित",
  "Unsaved changes": "असंचित परिवर्तन",
  "Not saved yet": "अभी संचित नहीं",
  "Saving…": "संचित हो रहा है…",
  Save: "संचित करें",
  Cancel: "रद्द करें",
  Remove: "हटाएँ",
  "Remove the card": "पत्रक हटाएँ",
  "The file": "संचिका",
  "How a card is written": "पत्रक कैसे लिखा जाता है",

  // card parts (the names of the templates' fields)
  Kind: "प्रकार",
  Age: "आयु",
  Position: "पद",
  Appearance: "रूप-रंग",
  Manner: "व्यवहार",
  Voice: "वाणी",
  Mannerisms: "हाव-भाव",
  Wants: "इच्छा",
  Secrets: "रहस्य",
  Relations: "संबंध",
  History: "इतिहास",
  "Life outside the story": "कथा से बाहर का जीवन",
  Behaviour: "आचरण",
  Temperament: "स्वभाव",
  "Sounds and signs": "ध्वनि और चिह्न",
  Abilities: "क्षमताएँ",
  Weaknesses: "दुर्बलताएँ",
  "Keeper or owner": "रक्षक अथवा स्वामी",
  Domain: "क्षेत्राधिकार",
  Standing: "प्रतिष्ठा",
  Followers: "अनुयायी",
  "Rites and offerings": "अनुष्ठान और अर्पण",
  Background: "पृष्ठभूमि",
  Skills: "कौशल",
  Gear: "साज-सामान",
  Goals: "लक्ष्य",
  "Look and feel": "रूप और अनुभूति",
  "Who is here": "यहाँ कौन है",
  "Exits and connections": "निकास और संपर्क",
  Customs: "रीतियाँ",
  Hooks: "सूत्र",
  "The ground": "परिसर",
  "When it is open": "कब खुला रहता है",
  "Who comes": "कौन आता है",
  Staff: "कर्मचारी",
  "The land": "भूमि",
  "Who lives here": "यहाँ कौन रहता है",
  "Who rules": "शासक कौन",
  "Places of note": "उल्लेखनीय स्थान",
  "What it is": "यह क्या है",
  "Where it came from": "यह कहाँ से आया",
  "How it works": "यह कैसे चलता है",
  "Who it touches": "यह किसे छूता है",
  Exceptions: "अपवाद",
  "How it shows in the story": "कथा में यह कैसे दिखता है",
  "What they want": "उनकी इच्छा",
  Members: "सदस्य",
  "How they act": "वे कैसे कार्य करते हैं",
  "Allies and rivals": "मित्र और प्रतिद्वंद्वी",
  Traits: "गुण",
  "How they live": "वे कैसे रहते हैं",
  "How others see them": "दूसरे उन्हें कैसे देखते हैं",
  When: "कब",
  "What happened": "क्या हुआ",
  Causes: "कारण",
  Consequences: "परिणाम",
  "How it is remembered": "इसे कैसे याद किया जाता है",
  Check: "जाँच",
  Why: "क्यों",
  Premise: "आधार",
  "Opening situation": "आरंभिक स्थिति",
  "Who is involved": "कौन-कौन सम्मिलित",
  Beats: "मोड़",
  Stakes: "दाँव",
  "Possible endings": "संभावित अंत",
  "What has happened so far": "अब तक क्या हुआ",
  Setting: "परिवेश",
  "Who is there": "वहाँ कौन है",
  "What happens": "क्या होता है",
  Outcome: "परिणति",

  // the names of the templates
  Person: "व्यक्ति",
  Creature: "जीव",
  "Deity or being of power": "देवता अथवा शक्तिशाली सत्ता",
  "Player character": "खिलाड़ी का पात्र",
  Location: "स्थान",
  "Venue or establishment": "प्रतिष्ठान",
  "Region or realm": "क्षेत्र अथवा राज्य",
  "Concept or custom": "अवधारणा अथवा रीति",
  "Group or faction": "समूह अथवा गुट",
  "Species or kind": "जाति अथवा प्रकार",
  "Event or era": "घटना अथवा युग",
  "Plain notes": "सादी टिप्पणियाँ",

  // the story and the table
  "Try again": "पुनः प्रयास",
  "Keep going": "आगे बढ़ें",
  Undo: "पूर्ववत",
  Stop: "रोकें",
  More: "और",
  "Join in": "सम्मिलित हों",
  "Save as a new world": "नए संसार के रूप में संचित करें",
  "Keep playing here": "यहीं खेलते रहें",
  "Open it now": "अभी खोलें",
  "Folder name": "फ़ोल्डर का नाम",
  "Update plot points": "कथानक-बिंदु अद्यतन करें",
  "What kind of turn": "कैसी बारी",
  Do: "करें",
  Say: "कहें",
  Story: "कथा",
  Ready: "तैयार",
  "Send it now": "अभी भेजें",
  "At the table": "पटल पर",
  "The table's turn": "पटल की बारी",
  "No cards yet. Make the first one below.": "अभी कोई पत्रक नहीं। पहला नीचे बनाएँ।",
  "Nothing matches.": "कुछ मेल नहीं खाता।",
  Object: "आपत्ति",
  Rename: "नाम बदलें",
  "Send away": "विदा करें",
  "The story is writing…": "कथा लिखी जा रही है…",
  "The story is about to begin…": "कथा आरंभ होने को है…",
  "The story is open in the window.": "कथा खिड़की में खुली है।",
  "Opening the table…": "पटल खुल रहा है…",

  // joining
  "Your name": "आपका नाम",
};

/** Every label, sentence and hint that has Hindi: the short words above, then the longer text. */
const HI: Record<string, string> = { ...WORDS, ...HI_TEMPLATES, ...HI_TEXT, ...HI_SERVER };

/**
 * The texts that have marks in them as patterns, so a finished sentence from the server ("There is
 * no world "ashfall".") is found by the sentence it came from ("There is no world "{name}".").
 */
const PATTERNS = Object.entries(HI)
  .filter(([english]) => /\{\w+\}/.test(english))
  .map(([english, hi]) => {
    const names: string[] = [];
    const source = english
      .split(/(\{\w+\})/)
      .map((part) => {
        const mark = /^\{(\w+)\}$/.exec(part)?.[1];
        if (mark === undefined) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        names.push(mark);
        return "(.+?)";
      })
      .join("");
    return { pattern: new RegExp(`^${source}$`, "s"), names, hi };
  });

/**
 * The Hindi for an English text. An exact text comes back with its marks still in it (the screen
 * fills them); a finished sentence that matches a pattern comes back filled in, with the parts that
 * changed translated too when they are known texts themselves.
 */
function lookup(english: string, depth = 0): { hi: string; filled: boolean } | undefined {
  const exact = HI[english];
  if (exact !== undefined) return { hi: exact, filled: false };
  if (depth > 1) return undefined;
  for (const { pattern, names, hi } of PATTERNS) {
    const m = pattern.exec(english);
    if (!m) continue;
    const values: Record<string, string> = {};
    names.forEach((name, i) => {
      const value = m[i + 1] ?? "";
      const inner = lookup(value, depth + 1);
      values[name] = inner ? fill(inner.hi, {}) : value;
    });
    return { hi: fill(hi, values), filled: true };
  }
  return undefined;
}

/** Puts values where a text has `{name}` marks. */
export function fill(text: string, values: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (mark, key: string) =>
    key in values ? String(values[key]) : mark,
  );
}

/** "हिंदी · English" for places that cannot hold markup, such as the choices in a menu. */
export const bilingual = (english: string, values?: Record<string, string | number>): string => {
  const found = lookup(english);
  if (!found) return fill(english, values);
  return `${found.filled ? found.hi : fill(found.hi, values)} · ${fill(english, values)}`;
};

/** Two versions of anything (not only text): Hindi shows, and the English comes on hover. */
export function Both({ hi, en }: { hi: ReactNode; en: ReactNode }) {
  return (
    <span className="tr">
      <span className="hi" lang="hi" aria-hidden="true">
        {hi}
      </span>
      <span className="en" lang="en">
        {en}
      </span>
    </span>
  );
}

/** Every English text with its Hindi (for the tests that check them). */
export const entries = (): Array<[string, string]> => Object.entries(HI);

/** Whether a text, or a finished sentence like it, has Hindi. */
export const hasHindi = (english: string): boolean => lookup(english) !== undefined;

/** The Hindi for a label, if there is any. */
export const hindi = (english: string): string | undefined => HI[english];

/** Text with `{name}` marks as nodes: the marks become the given values, in order. */
function slotted(text: string, slots: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    // biome-ignore lint/suspicious/noArrayIndexKey: the pieces never reorder
    return <Fragment key={i}>{key !== undefined && key in slots ? slots[key] : part}</Fragment>;
  });
}

/**
 * A label in Hindi that gives its English on hover, tap or focus. With no Hindi for it, plain
 * English. Give it one string; `with` fills the `{name}` marks in both languages (strings,
 * numbers or elements such as a file name in <code>). Text that people wrote does not go through
 * here.
 */
export function T({
  children,
  with: slots = {},
}: {
  children: string;
  with?: Record<string, ReactNode>;
}) {
  const found = lookup(children);
  if (!found) return <>{slotted(children, slots)}</>;
  return (
    <span className="tr">
      <span className="hi" lang="hi" aria-hidden="true">
        {found.filled ? found.hi : slotted(found.hi, slots)}
      </span>
      <span className="en" lang="en">
        {slotted(children, slots)}
      </span>
    </span>
  );
}

/**
 * On a screen that cannot hover, a tap on a label that is not a control swaps it between the
 * Hindi and the English.
 */
export function useTapToTranslate() {
  useEffect(() => {
    if (!window.matchMedia("(hover: none)").matches) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const label = target?.closest(".tr");
      if (!label || label.closest("button, a, summary, label, input, select, textarea")) return;
      label.classList.toggle("is-en");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}
