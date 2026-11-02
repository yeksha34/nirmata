#!/usr/bin/env node
/**
 * Workflow preparation and validation driver for ComfyUI Visual Novel Assets.
 *
 * Usage:
 *   node .agents/skills/gen-assets-workflow-comfyui/driver.mjs check <world-slug>
 *   node .agents/skills/gen-assets-workflow-comfyui/driver.mjs scaffold <world-slug> [vn-slug]
 *   node .agents/skills/gen-assets-workflow-comfyui/driver.mjs list
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..", "..");
const TEMPLATES_DIR = join(REPO_ROOT, "tools", "comfyui", "templates");
const WORLDS_DIR = process.env.WORLDS_DIR
  ? resolve(process.env.WORLDS_DIR)
  : join(REPO_ROOT, "worlds");

function validateWorkflowGraph(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    const json = JSON.parse(raw);
    if (!json || typeof json !== "object") return { ok: false, error: "Not a JSON object" };

    const nodes = Object.values(json);
    const classTypes = new Set(nodes.map((n) => n?.class_type).filter(Boolean));

    const required = ["CLIPTextEncode", "KSampler", "SaveImage"];
    const missing = required.filter((r) => !classTypes.has(r));
    if (missing.length > 0) {
      return { ok: false, error: `Missing required nodes: ${missing.join(", ")}` };
    }
    return { ok: true, nodeCount: nodes.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function checkWorldWorkflows(worldSlug) {
  const worldRoot = join(WORLDS_DIR, worldSlug);
  if (!existsSync(worldRoot)) {
    return { ok: false, issues: [`World directory does not exist: ${worldRoot}`] };
  }

  const workflowDir = join(worldRoot, "assets", "workflow");
  if (!existsSync(workflowDir)) {
    return { ok: false, issues: [`Workflow directory missing: ${workflowDir}`] };
  }

  const issues = [];
  const validFiles = [];

  // Required asset categories and acceptable file targets
  const checks = [
    {
      category: "sprite",
      targets: ["sprite.api.json", "sprite.json"],
    },
    {
      category: "cg",
      targets: ["cg.api.json", "cg.json"],
    },
    {
      category: "bg",
      targets: ["bg.api.json", "bg.json", "background.api.json", "background.json"],
    },
  ];

  for (const check of checks) {
    const found = check.targets.find((name) => existsSync(join(workflowDir, name)));
    if (!found) {
      issues.push(`Missing workflow template for ${check.category} (expected one of: ${check.targets.join(", ")})`);
    } else {
      const fullPath = join(workflowDir, found);
      const validation = validateWorkflowGraph(fullPath);
      if (!validation.ok) {
        issues.push(`Invalid node graph in ${found}: ${validation.error}`);
      } else {
        validFiles.push(found);
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    validFiles,
    workflowDir,
  };
}

export function scaffoldWorldWorkflows(worldSlug, vnSlug) {
  const worldRoot = join(WORLDS_DIR, worldSlug);
  if (!existsSync(worldRoot)) {
    throw new Error(`World directory does not exist: ${worldRoot}`);
  }

  const workflowDir = join(worldRoot, "assets", "workflow");
  mkdirSync(workflowDir, { recursive: true });

  const createdFiles = [];

  // Source templates from tools/comfyui/templates
  const spriteTpl = join(TEMPLATES_DIR, "sprite.template.api.json");
  const cgTpl = join(TEMPLATES_DIR, "cg.template.api.json");
  const bgTpl = join(TEMPLATES_DIR, "background.template.api.json");

  if (!existsSync(spriteTpl) || !existsSync(cgTpl) || !existsSync(bgTpl)) {
    throw new Error(`Base templates missing from ${TEMPLATES_DIR}`);
  }

  // Helper to copy if missing or create both .api.json and .json
  const prepare = (src, baseName, extraNames = []) => {
    const apiDest = join(workflowDir, `${baseName}.api.json`);
    const jsonDest = join(workflowDir, `${baseName}.json`);

    if (!existsSync(apiDest)) {
      copyFileSync(src, apiDest);
      createdFiles.push(`${baseName}.api.json`);
    }
    if (!existsSync(jsonDest)) {
      copyFileSync(src, jsonDest);
      createdFiles.push(`${baseName}.json`);
    }

    for (const extra of extraNames) {
      const extraApi = join(workflowDir, `${extra}.api.json`);
      const extraJson = join(workflowDir, `${extra}.json`);
      if (!existsSync(extraApi)) {
        copyFileSync(src, extraApi);
        createdFiles.push(`${extra}.api.json`);
      }
      if (!existsSync(extraJson)) {
        copyFileSync(src, extraJson);
        createdFiles.push(`${extra}.json`);
      }
    }
  };

  // 1. Sprite
  prepare(spriteTpl, "sprite");

  // 2. CG
  prepare(cgTpl, "cg");

  // 3. Background (both bg and background names)
  prepare(bgTpl, "bg", ["background"]);

  // 4. Prompts catalog scaffolding
  const promptsPath = join(workflowDir, "prompts.json");
  if (!existsSync(promptsPath)) {
    const promptsCatalog = {};

    // Scan VN adaptation if specified or found
    let targetVn = vnSlug;
    const vnsDir = join(worldRoot, "vns");
    if (!targetVn && existsSync(vnsDir)) {
      const vns = readdirSync(vnsDir).filter(
        (e) => !e.startsWith(".") && !e.startsWith("_") && statSync(join(vnsDir, e)).isDirectory(),
      );
      if (vns.length > 0) targetVn = vns[0];
    }

    if (targetVn) {
      const manifestPath = join(vnsDir, targetVn, "manifest.json");
      if (existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
          const assets = manifest.assets || {};

          // Sprites from manifest characters (guaranteeing naked sprite for all characters)
          if (assets.characters) {
            for (const [char, rawExpressions] of Object.entries(assets.characters)) {
              const expressions = Array.isArray(rawExpressions) ? [...rawExpressions] : [];
              if (!expressions.includes("naked")) {
                expressions.push("naked");
              }
              for (const expr of expressions) {
                const name = `${char}_${expr}`;
                const isNaked = expr === "naked";
                promptsCatalog[name] = {
                  name,
                  type: "sprite",
                  positivePrompt: isNaked
                    ? `masterpiece, best quality, 1girl, solo, ${char}, completely nude, uncensored, nipples, breasts, navel, pussy, full body portrait, standing forward, arms at sides, simple background, white background, character cutout`
                    : `masterpiece, best quality, 1girl, solo, ${char}, ${expr} expression, full body portrait, crisp line art, simple background, white background`,
                  negativePrompt: isNaked
                    ? `clothes, dress, underwear, shirt, skirt, 2girls, bad anatomy, bad hands, blurry, worst quality, cropped, censored, bar censor, mosaic censor`
                    : `lowres, bad anatomy, bad hands, blurry, worst quality, cropped, censored`,
                  steps: isNaked ? 25 : 22,
                  cfg: 7.5,
                  sampler: "dpmpp_2m",
                  scheduler: "karras",
                };
              }
            }
          }

          // CGs from manifest
          if (Array.isArray(assets.cgs)) {
            for (const cgName of assets.cgs) {
              promptsCatalog[cgName] = {
                name: cgName,
                type: "cg",
                positivePrompt: `masterpiece, best quality, cinematic narrative event CG, 16:9 widescreen, dramatic lighting, detailed background, ${cgName.replace(/_/g, " ")}`,
                negativePrompt: `lowres, bad anatomy, bad hands, blurry, worst quality, cropped, mosaic censor`,
                steps: 28,
                cfg: 7.0,
                sampler: "dpmpp_2m",
                scheduler: "karras",
              };
            }
          }

          // Backgrounds from manifest
          if (Array.isArray(assets.backgrounds)) {
            for (const bgName of assets.backgrounds) {
              promptsCatalog[bgName] = {
                name: bgName,
                type: "bg",
                positivePrompt: `masterpiece, best quality, 16:9 widescreen environment scenery, no humans, ${bgName.replace(/_/g, " ")}, atmospheric lighting`,
                negativePrompt: `1girl, 1boy, human, person, character, people, crowd, text, blurry, low quality`,
                steps: 22,
                cfg: 7.0,
                sampler: "dpmpp_2m",
                scheduler: "karras",
              };
            }
          }
        } catch {}
      }
    }

    writeFileSync(promptsPath, JSON.stringify(promptsCatalog, null, 2), "utf8");
    createdFiles.push("prompts.json");
  }

  return {
    ok: true,
    workflowDir,
    createdFiles,
  };
}

export function listWorlds() {
  if (!existsSync(WORLDS_DIR)) return [];
  const entries = readdirSync(WORLDS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();

  return entries.map((slug) => ({
    slug,
    status: checkWorldWorkflows(slug),
  }));
}

// ---------------------------------------------------------------------------
// CLI Execution
// ---------------------------------------------------------------------------
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const [cmd, arg1, arg2] = process.argv.slice(2);

  if (cmd === "check") {
    if (!arg1) {
      console.error("Usage: node driver.mjs check <world-slug>");
      process.exit(1);
    }
    const res = checkWorldWorkflows(arg1);
    if (res.ok) {
      console.log(`PASS: All visual novel workflow templates verified for '${arg1}'.`);
      console.log(`Directory: ${res.workflowDir}`);
      console.log(`Valid workflows: ${res.validFiles.join(", ")}`);
      process.exit(0);
    } else {
      console.error(`FAIL: Workflow issues in '${arg1}':`);
      for (const iss of res.issues) {
        console.error(` - ${iss}`);
      }
      process.exit(1);
    }
  } else if (cmd === "scaffold") {
    if (!arg1) {
      console.error("Usage: node driver.mjs scaffold <world-slug> [vn-slug]");
      process.exit(1);
    }
    try {
      const res = scaffoldWorldWorkflows(arg1, arg2);
      console.log(`Scaffolded workflow templates for '${arg1}' into:`);
      console.log(`  ${res.workflowDir}`);
      if (res.createdFiles.length > 0) {
        console.log(`Created files: ${res.createdFiles.join(", ")}`);
      } else {
        console.log("All workflow templates were already present.");
      }
      process.exit(0);
    } catch (err) {
      console.error(`Error scaffolding workflows: ${err.message}`);
      process.exit(1);
    }
  } else if (cmd === "list") {
    const worlds = listWorlds();
    console.log(`Worlds (${worlds.length}):`);
    for (const w of worlds) {
      const tag = w.status.ok ? "[READY]" : "[MISSING]";
      console.log(`  ${tag} ${w.slug}`);
      if (!w.status.ok) {
        for (const iss of w.status.issues) {
          console.log(`     - ${iss}`);
        }
      }
    }
    process.exit(0);
  } else {
    console.log("ComfyUI VN Asset Workflow Driver");
    console.log("Usage:");
    console.log("  node driver.mjs check <world-slug>");
    console.log("  node driver.mjs scaffold <world-slug> [vn-slug]");
    console.log("  node driver.mjs list");
    process.exit(0);
  }
}
