#!/usr/bin/env node
// MCP server exposing rule-group selection (lib.mjs's selectRuleGroups) as
// a tool: "select_rule_groups". Zero-dependency, per this project's
// convention -- implements the MCP stdio JSON-RPC transport by hand
// instead of pulling in @modelcontextprotocol/sdk.
//
// This server does NOT judge content itself -- it only returns which rule
// groups apply to a piece of text, plus each group's full rule text. The
// judging is still meant to be done by the calling agent (Claude), per
// SKILL.md -- this just gives that agent a tool-call path to the same
// selection logic select.mjs exposes as a CLI, for hosts that call MCP
// tools rather than shelling out to scripts.
//
// Register with Claude Code (project- or user-level .mcp.json):
//   {
//     "mcpServers": {
//       "rules-check-manual": {
//         "command": "node",
//         "args": ["<absolute-path>/.agents/skills/rules-check-manual/mcp-server.mjs"]
//       }
//     }
//   }

import { selectRuleGroups } from './lib.mjs';

const TOOLS = [
  {
    name: 'select_rule_groups',
    description:
      'Select which of this story project\'s agent rule groups (.agents/rules/*.md) apply to a given ' +
      'piece of card or chapter text, and return each applicable group\'s full rule text. Mirrors the ' +
      '/api/rules-check dry-run selection gates (censorship-workaround exclusion, scope match, ' +
      'universal-rule-always-checked, keyword relevance) with no model call at all -- judging the text ' +
      'against the returned rules is left to the calling agent, per the rules-check-manual skill.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The card or chapter text to select applicable rule groups for.' },
        target: { type: 'string', enum: ['cards', 'prose'], description: 'Restrict to groups scoped to cards, prose, or omit for both.' },
        excludeUniversal: { type: 'boolean', description: 'Skip the always-checked canon/safety/tone universal groups; return only keyword-matched ones.' },
        only: { type: 'array', items: { type: 'string' }, description: 'Force-check only these group slugs (bypasses the relevance gate, still respects censorship-workaround exclusion).' },
      },
      required: ['text'],
    },
  },
];

function send(obj) {
  const json = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function handleRequest(msg) {
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      reply(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'rules-check-manual', version: '1.0.0' },
      });
      return;
    }
    if (method === 'notifications/initialized') {
      return; // notification, no response
    }
    if (method === 'tools/list') {
      reply(id, { tools: TOOLS });
      return;
    }
    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      if (name !== 'select_rule_groups') {
        replyError(id, -32602, `unknown tool: ${name}`);
        return;
      }
      const { text, target, excludeUniversal, only } = args || {};
      if (!text || !String(text).trim()) {
        replyError(id, -32602, 'text is required and must be non-empty');
        return;
      }
      try {
        const result = selectRuleGroups(text, { target, excludeUniversal, only });
        reply(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
      } catch (e) {
        reply(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
      return;
    }
    if (id !== undefined) replyError(id, -32601, `method not found: ${method}`);
  } catch (e) {
    if (id !== undefined) replyError(id, -32603, e.message);
  }
}

// --- stdio transport: Content-Length-framed JSON-RPC messages, same
// framing LSP/MCP both use ---
let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString('utf8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) { buffer = buffer.subarray(headerEnd + 4); continue; }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return;
    const body = buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
    buffer = buffer.subarray(bodyStart + length);
    let msg;
    try { msg = JSON.parse(body); } catch { continue; }
    handleRequest(msg);
  }
});

process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
