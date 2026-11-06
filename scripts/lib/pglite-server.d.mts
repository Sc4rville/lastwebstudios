export type PgliteServer = { port: number; host: string; url: string; connections: () => number; stop: () => Promise<void> }
export function startPgliteServer(o: { db: any; host?: string; port?: number; maxConnections?: number }): Promise<PgliteServer>
