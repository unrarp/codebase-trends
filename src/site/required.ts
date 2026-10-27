/** `value`, or a thrown error naming `what` when it is null or undefined: for lookups the page cannot run without. */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`missing ${what}`);
  return value;
}
