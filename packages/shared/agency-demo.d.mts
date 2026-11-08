export declare const EXAMPLE_FILES: string[]
export declare function readExamples(root?: string): any[]
export declare function demoLeftovers(cfg: any, examples?: any[]): { key: string; label: string; why: "demo" | "placeholder" }[]
export declare function demoCopyByCountry(examples?: any[]): Record<string, { name: string; firstName: string; brand: string; offer: string; guarantee: string; phone: string; contactEmail: string; website: string; language: string; currency: string; timezone: string }>
