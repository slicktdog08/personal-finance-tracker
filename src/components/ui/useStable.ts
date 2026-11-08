"use client";

import { memo, useState, type ComponentType } from "react";
import { isEqualDeep, replaceEqualDeep } from "@/lib/stable";

/**
 * A server-supplied prop with stable identity: returns the previous value (or its unchanged
 * parts — see replaceEqualDeep) when a re-render delivers equal data in new objects. Put it
 * where server data enters a client component so memoised rows below can skip a refresh that
 * didn't touch them.
 *
 * The cache is component state adjusted during render (the project's pattern for prop-derived
 * state; the lint bans refs in render and setState in effects).
 */
export function useStable<T>(value: T): T {
  const [cache, setCache] = useState({ input: value, output: value });
  if (cache.input === value) return cache.output;
  const output = replaceEqualDeep(cache.output, value);
  setCache({ input: value, output });
  return output;
}

/**
 * memo() for a client component whose props are plain data from a Server Component: skips the
 * re-render when a refresh delivers the same data in new objects. Function and element props
 * are still compared by reference.
 */
export function memoDeep<P extends object>(component: ComponentType<P>) {
  return memo(component, (a, b) => isEqualDeep(a, b));
}
