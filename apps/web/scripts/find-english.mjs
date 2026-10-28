// Finds English in the screens' source that a person could see and that is not shown through the
// Hindi helpers (<T>, bilingual(), Tip, Field, Choice, ask.*). It reads the TypeScript syntax
// tree, so it sees text in JSX, in attributes and in ordinary string literals.
//
//   node apps/web/scripts/find-english.mjs      list what it finds
//   apps/web/test/english.test.ts               fails when something is found that has no Hindi
//
// A literal that has an entry in the Hindi dictionary is fine (it is on its way to <T>); the test
// supplies that check. Left out on purpose: `aria-label`s (the names a screen reader speaks stay
// English), class names, ids, event names and other code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const SKIP_FILES = new Set(["i18n.tsx", "i18n-text.ts", "i18n-server.ts", "i18n-templates.ts", "types.ts"]);
// attributes that are never shown, or are shown through a component that translates them
const QUIET_ATTRS = new Set([
  "className", "id", "htmlFor", "type", "name", "key", "role", "href", "src", "alt", "lang", "value",
  "viewBox", "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin", "d", "width", "height",
  "autoComplete", "pattern", "list", "aria-describedby", "aria-controls", "aria-current", "aria-pressed",
  "aria-labelledby", "aria-live", "aria-busy", "aria-hidden", "aria-selected", "aria-label", "data-editing",
  "titleId", "kind", "legend", "text", "action", "label", "below", "with", "values", "placeholder",
  "title", "options", "onClick",
]);
// calls that pass their text through the Hindi helpers
const HANDLED_CALLS = /^(bilingual|fill|hindi|ask\.(confirm|prompt))$/;
const PLAIN_KEYS = /^(do|say|story|live|lost|host|player|spectator|prompt|confirm|cards|stories|world|text|remove|worlds|waiting-world|waiting-story|objection|character|rule|ready|busy)$/;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(tsx|ts)$/.test(name) && !SKIP_FILES.has(name) ? [full] : [];
  });
}

const looksEnglish = (text) => /[A-Za-z]{3,}/.test(text) && /\s|^[A-Z]/.test(text.trim());
const codeish = (text) =>
  /^[a-z][a-zA-Z0-9_-]*$/.test(text) ||
  /^[./#\[\{<]/.test(text) ||
  /^[\w./-]+\.\w+$/.test(text) ||
  /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown|Home|Enter|Escape|POST|GET|PUT|DELETE|PATCH|NFKD|ApiError|Ctrl K)$/.test(text) ||
  /^[a-z][\w-]*( [a-z][\w-]*)*$/.test(text.replace(/\$\{[^}]*\}/g, "x"));

/** Every English literal that reaches a screen, as `{ file, line, kind, text }`. */
export function findEnglish() {
  const found = [];
  for (const file of files(root)) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const rel = relative(root, file).replace(/\\/g, "/");

    const inside = (node, test) => {
      for (let p = node.parent; p; p = p.parent) if (test(p)) return true;
      return false;
    };
    const tag = (p) => (ts.isJsxElement(p) ? p.openingElement.tagName.getText() : ts.isJsxSelfClosingElement(p) ? p.tagName.getText() : "");
    const inT = (node) => inside(node, (p) => tag(p) === "T");
    const handledCall = (node) => inside(node, (p) => ts.isCallExpression(p) && HANDLED_CALLS.test(p.expression.getText()));
    const inTypeOrImport = (node) => inside(node, (p) => ts.isImportDeclaration(p) || ts.isTypeNode(p) || ts.isExportDeclaration(p));
    const inAttr = (node) => inside(node, (p) => ts.isJsxAttribute(p));
    const attrName = (node) => {
      for (let p = node.parent; p; p = p.parent) if (ts.isJsxAttribute(p)) return p.name.getText();
      return undefined;
    };
    const inCodeTag = (node) => inside(node, (p) => ["code", "pre", "kbd"].includes(tag(p)));
    const inThrowOrConsole = (node) => inside(node, (p) => ts.isNewExpression(p) && /Error$/.test(p.expression.getText()) && false);

    const report = (node, text, kind) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      found.push({ file: rel, line: line + 1, kind, text: text.replace(/\s+/g, " ").trim() });
    };

    const visit = (node) => {
      if (ts.isJsxText(node)) {
        const text = node.getText();
        if (looksEnglish(text) && !inT(node) && !inCodeTag(node)) report(node, text, "text");
      } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const text = node.text;
        const handled = inT(node) || handledCall(node) || inTypeOrImport(node);
        // a string written inside {…} among a tag's children is shown, however short or plain
        const shownInChildren =
          /[A-Za-z]{2,}/.test(text) &&
          !handled &&
          !inAttr(node) &&
          node.parent &&
          (ts.isJsxExpression(node.parent) || ts.isConditionalExpression(node.parent)) &&
          inside(node, (p) => ts.isJsxExpression(p) && (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent)));
        if (handled) {
          // goes through the helpers
        } else if (shownInChildren && !PLAIN_KEYS.test(text)) {
          report(node, text, "shown");
        } else if (inAttr(node)) {
          const name = attrName(node);
          if (name && !QUIET_ATTRS.has(name) && looksEnglish(text) && !codeish(text)) report(node, text, `attr ${name}`);
          if (name === "options" || name === "onClick") {
            // strings given to Choice options or written in a click handler
            if (looksEnglish(text) && !codeish(text)) report(node, text, `attr ${name}`);
          }
        } else if (looksEnglish(text) && !codeish(text) && /^[A-Z“]/.test(text) && text.length > 3) {
          report(node, text, "string");
        }
      } else if (ts.isTemplateExpression(node)) {
        const head = node.head.text;
        const handled = inT(node) || handledCall(node) || inTypeOrImport(node) || inAttr(node);
        if (!handled && /^[A-Z“]/.test(head) && looksEnglish(head)) report(node, node.getText(), "template");
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const all = findEnglish();
  for (const f of all) console.log(`${f.file}:${f.line}  ${f.kind}  ${JSON.stringify(f.text.slice(0, 110))}`);
  console.log(`\n${all.length} found (the test lists only those with no Hindi)`);
}
