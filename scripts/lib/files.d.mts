export const EXCLUDED_TOP: Set<string>
export const INCLUDED_UNDER_EXCLUDED: string[]
export function isCodePath(rel: string): boolean
export function listRepoFiles(root: string): string[]
export function codeFiles(root: string): string[]
export function copyFiles(root: string, dest: string, files: string[]): number
export function linkNodeModules(root: string, dest: string): void
