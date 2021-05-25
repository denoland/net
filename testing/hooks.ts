// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.
type THookFn = () => void | Promise<void>;
type HookType = "beforeEach" | "afterEach";

const hooks: Partial<Record<HookType, THookFn>> = {};

/**
 * Register new testing hooks.
 *
 * @param {THookFn} fn
 * @param {HookType} hookType
 */
function _addHook(fn: THookFn, hookType: HookType): void {
  if (typeof fn !== "function") {
    throw new TypeError(
      "Invalid first argument. It must be a callback function.",
    );
  }
  if (typeof hookType !== "string") {
    throw new TypeError(
      `Invalid second argument, ${hookType}. It must be a string`,
    );
  }
  hooks[hookType] = fn;
}

/**
 * Helper function to execute registred hooks.
 */
export function withHooks(fn: THookFn): THookFn {
  return async function () {
    if (typeof fn !== "function") {
      throw new TypeError(
        "Invalid first argument. It must be a callback function.",
      );
    }
    if (hooks.beforeEach) {
      await hooks.beforeEach();
    }
    // execute the callback function
    await fn();
    if (hooks.afterEach) {
      await hooks.afterEach();
    }
  };
}

/**
 * INFO:
 * Runs a function before each of the tests.
 * If the function returns a promise or is a generator,
 * Deno aits for that promise to resolve before running the test.
 * `fn` can be async if required.
 */
export function beforeEach(fn: THookFn): void {
  _addHook(fn, "beforeEach");
}

/**
 * INFO:
 * Runs a function after each of the tests.
 * `fn` can be async if required.
 */
export function afterEach(fn: THookFn) {
  _addHook(fn, "afterEach");
}
