// src/lib/utils/wait.ts

export function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
