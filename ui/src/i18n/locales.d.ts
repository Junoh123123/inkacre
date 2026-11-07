declare module 'virtual:locales' {
  export const languages: Array<{ code: string; name: string; english: string; intl: string }>;
  export const keys: string[];
  export const values: Record<string, Array<string | null>>;
}
