import type { VnDiagnostic, VnDialogue, VnMenuChoice, VnSlot, VnVarOp } from "./types";

export interface ParsedSceneHeader {
  sceneId: string;
  title: string;
  route: string;
  wordEstimate?: number;
}

export type ParsedStageDirective =
  | { type: "bg"; name: string }
  | { type: "music"; name?: string; stop?: boolean }
  | { type: "sfx"; name: string }
  | { type: "show"; character: string; expression: string; slot?: VnSlot }
  | { type: "hide"; character: string }
  | { type: "cg"; name: string }
  | { type: "hide_cg" }
  | { type: "transition"; name: string }
  | { type: "jump"; targetSceneId: string }
  | { type: "end"; endingName?: string };

export interface ParsedLine {
  lineIndex: number;
  directives: ParsedStageDirective[];
  dialogue?: VnDialogue;
  menu?: {
    prompt?: string;
    choices: VnMenuChoice[];
  };
  jump?: string;
  end?: { endingName?: string };
}

export interface ParsedScene {
  header: ParsedSceneHeader;
  lines: ParsedLine[];
}

/** Parses variable change expressions like `{trust_vasha +1}`, `{+suspects_vasha}`, `{route = true}`. */
export function parseVarChanges(raw: string): VnVarOp[] {
  const ops: VnVarOp[] = [];
  const matches = raw.match(/\{([^}]+)\}/g);
  if (!matches) return ops;

  for (const block of matches) {
    const inner = block.slice(1, -1).trim();
    const parts = inner.split(/[,;]/);

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Case 1: {+flag} or {-flag}
      const shorthandMatch = /^[+]([A-Za-z0-9_.-]+)$/.exec(trimmed);
      if (shorthandMatch?.[1]) {
        ops.push({ variable: shorthandMatch[1], op: "+", value: 1 });
        continue;
      }
      const negShorthandMatch = /^[-]([A-Za-z0-9_.-]+)$/.exec(trimmed);
      if (negShorthandMatch?.[1]) {
        ops.push({ variable: negShorthandMatch[1], op: "-", value: 1 });
        continue;
      }

      // Case 2: {var + 1} or {var - 2}
      const addSubMatch = /^([A-Za-z0-9_.-]+)\s*([+-])\s*(\d+)$/.exec(trimmed);
      if (addSubMatch?.[1] && addSubMatch[2] && addSubMatch[3]) {
        ops.push({
          variable: addSubMatch[1],
          op: addSubMatch[2] as "+" | "-",
          value: Number.parseInt(addSubMatch[3], 10),
        });
        continue;
      }

      // Case 3: {var = value}
      const assignMatch = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(trimmed);
      if (assignMatch?.[1] && assignMatch[2]) {
        const varName = assignMatch[1];
        let valStr = assignMatch[2].trim();
        if (
          (valStr.startsWith('"') && valStr.endsWith('"')) ||
          (valStr.startsWith("'") && valStr.endsWith("'"))
        ) {
          valStr = valStr.slice(1, -1);
          ops.push({ variable: varName, op: "=", value: valStr });
        } else if (valStr === "true") {
          ops.push({ variable: varName, op: "=", value: true });
        } else if (valStr === "false") {
          ops.push({ variable: varName, op: "=", value: false });
        } else if (!Number.isNaN(Number(valStr))) {
          ops.push({ variable: varName, op: "=", value: Number(valStr) });
        } else {
          ops.push({ variable: varName, op: "=", value: valStr });
        }
      }
    }
  }

  return ops;
}

/** Parses one or more bracket directives on a line, e.g. `[bg riverbank_dusk] [music unease] [fade in]` */
export function parseStageDirectives(text: string): {
  directives: ParsedStageDirective[];
  remainingText: string;
} {
  const directives: ParsedStageDirective[] = [];
  const bracketRegex = /\[([^\]]+)\]/g;
  const remainingText = text.replace(bracketRegex, "").trim();

  for (const match of text.matchAll(bracketRegex)) {
    const raw = (match[1] ?? "").trim();
    const parts = raw.split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const part1 = parts[1];

    if (cmd === "bg" && part1) {
      directives.push({ type: "bg", name: parts.slice(1).join(" ") });
    } else if (cmd === "music" || (cmd === "play" && part1?.toLowerCase() === "music")) {
      const name = cmd === "music" ? parts.slice(1).join(" ") : parts.slice(2).join(" ");
      directives.push({ type: "music", name });
    } else if (cmd === "stop" && part1?.toLowerCase() === "music") {
      directives.push({ type: "music", stop: true });
    } else if (cmd === "sfx" || (cmd === "play" && part1?.toLowerCase() === "sfx")) {
      const name = cmd === "sfx" ? parts.slice(1).join(" ") : parts.slice(2).join(" ");
      directives.push({ type: "sfx", name });
    } else if (cmd === "show" && part1) {
      const character = part1;
      const expression = parts[2] || "neutral";
      let slot: VnSlot | undefined;
      const maybeSlot = parts[3]?.toLowerCase();
      if (maybeSlot === "left" || maybeSlot === "center" || maybeSlot === "right") {
        slot = maybeSlot;
      }
      directives.push({ type: "show", character, expression, slot });
    } else if (cmd === "hide" && part1) {
      if (part1.toLowerCase() === "cg") {
        directives.push({ type: "hide_cg" });
      } else {
        directives.push({ type: "hide", character: part1 });
      }
    } else if (cmd === "cg" && part1) {
      directives.push({ type: "cg", name: parts.slice(1).join(" ") });
    } else if (
      raw.toLowerCase() === "fade in" ||
      raw.toLowerCase() === "fade out" ||
      raw.toLowerCase() === "dissolve"
    ) {
      directives.push({ type: "transition", name: raw.toLowerCase() });
    } else if (cmd === "jump" && part1) {
      directives.push({ type: "jump", targetSceneId: part1 });
    } else if (cmd === "end") {
      directives.push({ type: "end" });
    } else if (cmd?.startsWith("ending")) {
      const endingName = parts.slice(1).join(" ").replace(/^:\s*/, "") || undefined;
      directives.push({ type: "end", endingName });
    }
  }

  return { directives, remainingText };
}

/** Parses a menu choice line like `* "I'll cross." → SC-04 {trust_vasha +1}` */
export function parseMenuChoice(line: string): VnMenuChoice | undefined {
  const match = /^\s*[*+-]\s*(.+?)\s*(?:→|->)\s*([A-Za-z0-9_.-]+)(.*)$/.exec(line);
  if (!match?.[1] || !match[2]) return undefined;

  let text = match[1].trim();
  const targetSceneId = match[2].trim();
  const rest = (match[3] ?? "").trim();

  const isCanon = /\(canon\)/i.test(rest) || /\(canon\)/i.test(text);
  if (isCanon) {
    text = text.replace(/\s*\(canon\)/i, "").trim();
  }

  // Strip wrapping quotes from choice text
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("“") && text.endsWith("”")) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }

  const varChanges = parseVarChanges(rest);

  return {
    text,
    targetSceneId,
    isCanon: isCanon ? true : undefined,
    varChanges: varChanges.length > 0 ? varChanges : undefined,
  };
}

/** Extracts the script section from full adaptation markdown or returns the whole content if standalone. */
export function extractScriptSection(markdown: string): string {
  const scriptHeading = /^##\s+(?:8\.\s*)?Script\b.*$/im;
  const match = scriptHeading.exec(markdown);
  if (match && match.index !== undefined) {
    return markdown.slice(match.index + match[0].length);
  }
  return markdown;
}

/** Parses raw script markdown into structured scenes and lines. */
export function parseScript(markdown: string): {
  scenes: ParsedScene[];
  diagnostics: VnDiagnostic[];
} {
  const text = extractScriptSection(markdown);
  const lines = text.split(/\r?\n/);
  const scenes: ParsedScene[] = [];
  const diagnostics: VnDiagnostic[] = [];

  let currentScene: ParsedScene | null = null;
  let inMenu = false;
  let currentMenuChoices: VnMenuChoice[] = [];
  let menuPrompt: string | undefined;

  const flushMenu = (lineIdx: number) => {
    if (!inMenu || !currentScene) return;
    if (currentMenuChoices.length === 0) {
      diagnostics.push({
        severity: "warning",
        code: "empty_menu",
        message: "Menu defined with no choice options",
        sceneId: currentScene.header.sceneId,
        line: lineIdx,
      });
    } else {
      const lastLine = currentScene.lines[currentScene.lines.length - 1];
      if (lastLine && !lastLine.jump && !lastLine.end && !lastLine.menu) {
        lastLine.menu = {
          prompt: menuPrompt,
          choices: currentMenuChoices,
        };
      } else {
        currentScene.lines.push({
          lineIndex: lineIdx,
          directives: [],
          menu: {
            prompt: menuPrompt,
            choices: currentMenuChoices,
          },
        });
      }
    }
    inMenu = false;
    currentMenuChoices = [];
    menuPrompt = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine === undefined) continue;
    const trimmed = rawLine.trim();

    if (!trimmed) continue;

    // Check for Scene Header: ## SC-01 ...
    const sceneMatch =
      /^##\s+([A-Za-z0-9_.-]+)\s*(.*?)(?:\[route:\s*([A-Za-z0-9_.-]+)\])?(?:\s*\[~?(\d+)\s*words\])?\s*$/i.exec(
        trimmed,
      );
    if (sceneMatch?.[1]) {
      flushMenu(i + 1);
      const sceneId = sceneMatch[1];
      let title = (sceneMatch[2] || "").trim();
      title = title
        .replace(/\[route:[^\]]+\]/gi, "")
        .replace(/\[~?\d+\s*words\]/gi, "")
        .trim();
      const route = sceneMatch[3] || "common";
      const wordEstimate = sceneMatch[4] ? Number.parseInt(sceneMatch[4], 10) : undefined;

      currentScene = {
        header: {
          sceneId,
          title: title || sceneId,
          route,
          wordEstimate,
        },
        lines: [],
      };
      scenes.push(currentScene);
      continue;
    }

    if (!currentScene) {
      continue;
    }

    // Check for MENU header
    if (/^MENU:?$/i.test(trimmed)) {
      flushMenu(i + 1);
      inMenu = true;
      continue;
    }

    // Handle inside MENU
    if (inMenu) {
      const choice = parseMenuChoice(trimmed);
      if (choice) {
        currentMenuChoices.push(choice);
        continue;
      }
      flushMenu(i + 1);
    }

    // Parse stage directives
    const { directives, remainingText } = parseStageDirectives(trimmed);

    const jumpDir = directives.find((d) => d.type === "jump");
    const endDir = directives.find((d) => d.type === "end");

    if (!remainingText) {
      currentScene.lines.push({
        lineIndex: i + 1,
        directives,
        jump: jumpDir ? (jumpDir as { targetSceneId: string }).targetSceneId : undefined,
        end: endDir ? { endingName: (endDir as { endingName?: string }).endingName } : undefined,
      });
      continue;
    }

    // Check for Inner Monologue: ( MC ) ... or ( VASHA ) ...
    const monologueMatch = /^\(\s*([A-Za-z0-9_ -]+)\s*\)\s*(.+)$/.exec(remainingText);
    if (monologueMatch?.[1] && monologueMatch[2]) {
      currentScene.lines.push({
        lineIndex: i + 1,
        directives,
        dialogue: {
          speaker: monologueMatch[1].trim(),
          isMonologue: true,
          text: monologueMatch[2].trim(),
        },
        jump: jumpDir ? (jumpDir as { targetSceneId: string }).targetSceneId : undefined,
        end: endDir ? { endingName: (endDir as { endingName?: string }).endingName } : undefined,
      });
      continue;
    }

    // Check for Dialog: SPEAKER: ...
    const dialogMatch = /^([A-Z0-9_ -]{2,}):\s*(.+)$/.exec(remainingText);
    if (dialogMatch?.[1] && dialogMatch[2]) {
      currentScene.lines.push({
        lineIndex: i + 1,
        directives,
        dialogue: {
          speaker: dialogMatch[1].trim(),
          isMonologue: false,
          text: dialogMatch[2].trim(),
        },
        jump: jumpDir ? (jumpDir as { targetSceneId: string }).targetSceneId : undefined,
        end: endDir ? { endingName: (endDir as { endingName?: string }).endingName } : undefined,
      });
      continue;
    }

    // Otherwise, Narration
    currentScene.lines.push({
      lineIndex: i + 1,
      directives,
      dialogue: {
        speaker: undefined,
        isMonologue: false,
        text: remainingText,
      },
      jump: jumpDir ? (jumpDir as { targetSceneId: string }).targetSceneId : undefined,
      end: endDir ? { endingName: (endDir as { endingName?: string }).endingName } : undefined,
    });
  }

  flushMenu(lines.length);

  return { scenes, diagnostics };
}
