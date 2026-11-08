export type LineSplitter = { push(chunk: Buffer | string): void; end(): void }
export function lineSplitter(onLine: (line: string) => void): LineSplitter
export type TextCollector = { push(chunk: Buffer | string): void; readonly bytes: number; text(): string }
export function textCollector(max?: number): TextCollector
