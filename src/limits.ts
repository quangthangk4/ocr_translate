export const PROCESSING_TIMEOUT_MS = 300_000;
// Allow delivery/cleanup after the processor's timeout before considering a job stale.
export const STALE_JOB_MS = PROCESSING_TIMEOUT_MS + 15_000;
