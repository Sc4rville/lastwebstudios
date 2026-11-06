export function resolveInside(rootDir: string, urlPath: string | undefined): Promise<string | null>
export function serveDir(rootDir: string, opts?: { port?: number }): Promise<{ port: number; url: string; close: () => Promise<void> }>
