export const IMAGE_ENGINES: readonly ["openai", "none"]
export const VIDEO_ENGINES: readonly ["higgsfield", "none"]
export const DEFAULT_IMAGE_MODEL: string
export const DEFAULT_IMAGE_BASE_URL: string
export function onPath(bin: string, env?: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean
export function imageEngine(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): { engine: "openai" | "none"; why: string }
export function videoEngine(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): { engine: "higgsfield" | "none"; why: string }
