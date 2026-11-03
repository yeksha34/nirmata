export interface LedgerEntry {
  file: string;
  from: number;
  to: number;
  card?: string;
  lane: string;
}
export function readLedgers(ledgerDir: string): { entries: LedgerEntry[]; problems: string[] };
export function remnants(
  sourceDir: string,
  ledgerDir: string,
): { left: Map<string, string>; problems: string[]; empty: string[] };
