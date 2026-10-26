// Finds the sentences the server, the host engine and the model layer can say to a person: error
// messages, refusals, warnings and the announcements in the story's voice. The screens show them
// in Hindi when they have an entry in `i18n-server.ts`; apps/web/test/server-messages.test.ts fails
// when one has none.
//
//   node apps/web/scripts/find-server-messages.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ROOTS = ["packages/core/src", "packages/host/src", "packages/llm/src", "apps/server/src"];
// not shown to people in the screens: console output at startup, the prompts the model reads
const SKIP = [/server\/src\/config\.ts$/, /server\/src\/main\.ts$/, /host\/src\/(plot|rules|prompt|flavor)\.ts$/, /core\/src\/context\.ts$/, /llm\/src\/(presets|fake)\.ts$/];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.ts$/.test(name) ? [full] : [];
  });
}

/** The message position of each way of raising a message to a person. */
const CALLS = {
  "new HostError": 1,
  "new HttpError": 2,
  "new LlmError": 1,
  fail: 1, // the board's helper: fail(code, message)
  "new Error": 0,
};

export function serverMessages() {
  const found = [];
  for (const root of ROOTS) {
    for (const file of files(join(repo, root))) {
      const rel = relative(repo, file).replace(/\\/g, "/");
      if (SKIP.some((re) => re.test(rel))) continue;
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const add = (node, kind) => {
        let text;
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
        else if (ts.isTemplateExpression(node)) {
          // `${x}` becomes a stand-in for whatever fills it
          text = node.head.text + node.templateSpans.map((s) => "x" + s.literal.text).join("");
        } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
          return add(node.left, kind), add(node.right, kind);
        } else if (ts.isConditionalExpression(node)) {
          return add(node.whenTrue, kind), add(node.whenFalse, kind);
        } else return;
        if (!/[A-Za-z]{3,}/.test(text) || !/^[A-Za-z“'"<{]/.test(text)) return;
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        found.push({ file: rel, line: line + 1, kind, text });
      };
      const visit = (node) => {
        if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
          const name = (ts.isNewExpression(node) ? "new " : "") + node.expression.getText();
          const at = CALLS[name];
          if (at !== undefined && node.arguments?.[at]) add(node.arguments[at], name);
        }
        // the refusals table, and any `message:` given to a person
        if (ts.isPropertyAssignment(node) && node.name.getText() === "message") add(node.initializer, "message");
        if (ts.isVariableDeclaration(node) && node.name.getText() === "REFUSAL" && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
          for (const p of node.initializer.properties) if (ts.isPropertyAssignment(p)) add(p.initializer, "refusal");
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  // the announcements in the story's voice: every sentence in moderation.ts that has a {mark}
  const mod = join(repo, "packages/host/src/moderation.ts");
  const modSource = ts.createSourceFile(mod, readFileSync(mod, "utf8"), ts.ScriptTarget.Latest, true);
  const walk = (node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && /\{\w+\}/.test(node.text)) {
      const { line } = modSource.getLineAndCharacterOfPosition(node.getStart());
      found.push({ file: "packages/host/src/moderation.ts", line: line + 1, kind: "announcement", text: node.text });
    }
    ts.forEachChild(node, walk);
  };
  walk(modSource);
  return found;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const m of serverMessages()) console.log(`${m.file}:${m.line}  ${m.kind}  ${JSON.stringify(m.text.slice(0, 120))}`);
}
