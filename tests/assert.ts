/**
 * assert.ts — Zero-dependency assertions for unit and compliance tests.
 *
 * Runs offline with zero external packages or network requests.
 * Compatible with Node.js and Deno test runners.
 */

export function assert(condition: unknown, msg = "Assertion failed"): asserts condition {
  if (!condition) {
    throw new Error(msg);
  }
}

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(
      msg || `Expected ${expectedStr}, but received ${actualStr}`,
    );
  }
}

export function assertNotEquals<T>(actual: T, expected: T, msg?: string): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr === expectedStr) {
    throw new Error(msg || `Expected values to differ, but both were ${actualStr}`);
  }
}

export function assertMatch(actual: string, pattern: RegExp, msg?: string): void {
  if (!pattern.test(actual)) {
    throw new Error(
      msg || `Expected "${actual}" to match regular expression ${pattern}`,
    );
  }
}

export function assertThrows(fn: () => void, errorClassOrMsg?: string | (new (...args: any[]) => Error)): void {
  let thrown = false;
  try {
    fn();
  } catch (err) {
    thrown = true;
    if (typeof errorClassOrMsg === "string") {
      assert(
        (err as Error).message.includes(errorClassOrMsg),
        `Expected error message to include "${errorClassOrMsg}", got "${(err as Error).message}"`,
      );
    } else if (typeof errorClassOrMsg === "function") {
      assert(
        err instanceof errorClassOrMsg,
        `Expected error to be instance of ${errorClassOrMsg.name}`,
      );
    }
  }
  if (!thrown) {
    throw new Error("Expected function to throw, but it returned normally.");
  }
}

export async function assertRejects(
  fn: () => Promise<unknown>,
  errorMsgSubstr?: string,
): Promise<void> {
  let thrown = false;
  try {
    await fn();
  } catch (err) {
    thrown = true;
    if (errorMsgSubstr) {
      assert(
        (err as Error).message.includes(errorMsgSubstr),
        `Expected error message to include "${errorMsgSubstr}", got "${(err as Error).message}"`,
      );
    }
  }
  if (!thrown) {
    throw new Error("Expected promise to reject, but it resolved.");
  }
}
