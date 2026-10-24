export interface TokenCounter {
  count(text: string): number;
}

/**
 * Deliberately conservative fallback (English averages ~4 characters per token, we assume 3.5)
 * so an overflow shows up as unused budget, never as silently truncated lore.
 * Providers with a real tokenizer supply their own counter.
 */
export const estimateTokens: TokenCounter = {
  count: (text) => Math.ceil(text.length / 3.5),
};
