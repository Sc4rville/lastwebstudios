export function pgSsl(url?: string, env?: NodeJS.ProcessEnv): false | "require" | "prefer" | "verify-full"
export function onPgNotice(n: { code?: string; message?: string; severity?: string }): void
export function pgPoolMax(def: number, env?: NodeJS.ProcessEnv | Record<string, string | undefined>): number
