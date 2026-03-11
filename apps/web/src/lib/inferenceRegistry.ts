// Shared registry of in-flight inference AbortControllers.
// Keeping this in a dedicated module avoids exporting non-handler values from
// Next.js route files (which causes type errors with the route module constraint).
export const inFlightControllers = new Map<string, AbortController>()
