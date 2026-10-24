import { normalize } from "./normalize";

export interface KeywordEntry {
  cardId: string;
  keywords: readonly string[];
}

export interface KeywordHit {
  cardId: string;
  /** The keyword as the author wrote it. */
  keyword: string;
  /** Start offset (in code points) within the *normalized* scanned text. */
  index: number;
}

export interface Matcher {
  scan(text: string): KeywordHit[];
}

interface Node {
  next: Map<string, number>;
  fail: number;
  /** Indices into `patterns` that end at this node, including via failure links. */
  out: number[];
}

interface Pattern {
  cardId: string;
  keyword: string;
  chars: string[];
}

const WORD = /[\p{L}\p{N}]/u;
const isWord = (ch: string | undefined): boolean => ch !== undefined && WORD.test(ch);

/**
 * Aho-Corasick automaton: one linear pass finds every keyword of every card.
 * Matches must sit on word boundaries ("fog" does not fire inside "fogbound"), and the result is
 * sorted so identical input always yields identical output.
 */
export function buildMatcher(entries: readonly KeywordEntry[]): Matcher {
  const patterns: Pattern[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const keyword of entry.keywords) {
      const norm = normalize(keyword);
      if (!norm) continue;
      const key = `${entry.cardId}\u0000${norm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      patterns.push({ cardId: entry.cardId, keyword, chars: Array.from(norm) });
    }
  }

  const nodes: Node[] = [{ next: new Map(), fail: 0, out: [] }];
  const at = (i: number): Node => nodes[i] as Node;

  patterns.forEach((pattern, patternIndex) => {
    let cur = 0;
    for (const ch of pattern.chars) {
      let nxt = at(cur).next.get(ch);
      if (nxt === undefined) {
        nxt = nodes.length;
        nodes.push({ next: new Map(), fail: 0, out: [] });
        at(cur).next.set(ch, nxt);
      }
      cur = nxt;
    }
    at(cur).out.push(patternIndex);
  });

  // Breadth-first so a node's failure target (always shallower) is finished before it is used.
  const queue: number[] = [];
  for (const child of at(0).next.values()) queue.push(child);
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head] as number;
    for (const [ch, v] of at(u).next) {
      let f = at(u).fail;
      while (f !== 0 && !at(f).next.has(ch)) f = at(f).fail;
      const target = at(f).next.get(ch);
      at(v).fail = target !== undefined && target !== v ? target : 0;
      at(v).out.push(...at(at(v).fail).out);
      queue.push(v);
    }
  }

  return {
    scan(text) {
      const chars = Array.from(normalize(text));
      const hits: KeywordHit[] = [];
      let state = 0;
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i] as string;
        while (state !== 0 && !at(state).next.has(ch)) state = at(state).fail;
        state = at(state).next.get(ch) ?? 0;
        for (const p of at(state).out) {
          const pattern = patterns[p] as Pattern;
          const start = i - pattern.chars.length + 1;
          if (isWord(pattern.chars[0]) && isWord(chars[start - 1])) continue;
          if (isWord(pattern.chars[pattern.chars.length - 1]) && isWord(chars[i + 1])) continue;
          hits.push({ cardId: pattern.cardId, keyword: pattern.keyword, index: start });
        }
      }
      return hits.sort(
        (a, b) =>
          a.index - b.index ||
          (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0) ||
          (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0),
      );
    },
  };
}
