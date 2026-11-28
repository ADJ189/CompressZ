/**
 * warnings.ts — Shared helpers for aggregating and deduplicating EngineWarning notices.
 */

import type { EngineWarning } from "./types";

export interface DeduplicatedWarning extends EngineWarning {
  count: number;
}

/**
 * Deduplicate warnings across files/batches by (code, engine, message, detail),
 * preserving first-seen order and counting occurrences.
 * Severity upgrades to "warn" if any matching entry is "warn".
 */
export function deduplicateWarnings(
  warnings: ReadonlyArray<EngineWarning>,
): DeduplicatedWarning[] {
  const map = new Map<string, DeduplicatedWarning>();
  for (const w of warnings) {
    const key = `${w.code}\0${w.engine}\0${w.message}\0${w.detail ?? ""}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      if (w.severity === "warn") existing.severity = "warn";
    } else {
      map.set(key, {
        code: w.code,
        engine: w.engine,
        message: w.message,
        severity: w.severity ?? "warn",
        ...(w.detail !== undefined ? { detail: w.detail } : {}),
        count: 1,
      });
    }
  }
  return [...map.values()];
}

export function mergeWarnings(
  ...groups: ReadonlyArray<ReadonlyArray<EngineWarning> | undefined>
): EngineWarning[] | undefined {
  const merged: EngineWarning[] = [];
  for (const g of groups) {
    if (g && g.length > 0) merged.push(...g);
  }
  return merged.length > 0 ? merged : undefined;
}
