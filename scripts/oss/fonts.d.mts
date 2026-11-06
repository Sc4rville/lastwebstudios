export const ROOT: string
export const FONTS_DIR: string
export const LOCK: string
export const PAIRINGS: string
export const BLACKLIST: string
export const FAMILIES: { id: string; family: string; vf?: boolean; italic?: boolean; statics?: number[]; staticItalics?: number[] }[]
export function readLock(root?: string): any
export function readPairings(root?: string): any[]
export function readBlacklist(root?: string): Set<string>
export function lockedFiles(lock: any): any[]
export function ossIndex(lock: any): any
export function verify(root?: string): { ok: boolean; problems: string[]; families: number; pairings: number; files: number; bytes: number }
