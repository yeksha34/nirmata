import { HostError } from "./types";

/**
 * Pulls the first JSON object out of a model answer, tolerating code fences and chatter around
 * it. `who` names the caller in the error ("The rule checker", "The compactor").
 */
export function extractJson(raw: string, who: string, code: HostError["code"]): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new HostError(code, `${who} did not return JSON.`);
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new HostError(code, `${who} returned JSON that could not be read.`);
  }
}
