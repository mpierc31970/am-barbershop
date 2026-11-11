// Types for migrations-dir.mjs (plain ESM so it runs under node with no build step).
export function timestampOf(name: string): string | null;
export function checkUnique(names: readonly string[]): void;
export function migrationFiles(): string[];
export function assembleMigrationsDir(target: string): string[];
