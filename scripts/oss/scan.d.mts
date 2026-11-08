export type Finding = { file: string; line: number; rule: string; value: string }
export type ScanReport = {
  dir: string; files: number; textFiles: number; findings: Finding[]; ok: boolean
  fonts: { count: number; families: string[]; outsideLock: { file: string; family: string; license: string | null; inLock: boolean }[] }
  real: null | { names: number; slugs: number; domains: number; phones: number; emails: number; privateTokens: number }
}
export function privateIdentity(root: string): { tokens: string[]; phones: Set<string> }
export function loadRealEntities(root: string): { names: Set<string>; slugs: Set<string>; domains: Set<string>; phones: Set<string>; emails: Set<string>; privateTokens: string[] }
export function scan(dir: string, opts?: { real?: string; lock?: string }): ScanReport
