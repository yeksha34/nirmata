/**
 * Nirmata is for adults (ADR-0010). Joining can ask people to confirm that they are adults, but
 * only in production: development and tests never ask (ADR-0014). The check is a plain attestation.
 */
export function isProduction(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.NODE_ENV === "production";
}

export const ADULT_CONFIRMATION_MESSAGE =
  "Please confirm that you are an adult to join this story.";
