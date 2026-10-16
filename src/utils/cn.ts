export type ClassValue = string | number | false | null | undefined;

/** Join truthy class names. Tiny stand-in for clsx. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
