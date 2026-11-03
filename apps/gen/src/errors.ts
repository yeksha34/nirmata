export type GenStatus = 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503 | 504;

/** A generation failure the caller can be told about (ComfyUI offline, cancelled, no such image…). */
export class GenError extends Error {
  constructor(
    readonly status: GenStatus,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GenError";
  }
}
