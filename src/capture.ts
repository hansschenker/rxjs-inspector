import type { CapturedValue, JsonValue } from './types.js';

const MAX_DEPTH = 8;
const MAX_ENTRIES = 64;
const MAX_NODES = 1_000;
const MAX_STRING = 4_096;

/** Freeze only our own JSON data, never an application object. */
export function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freezeJson(item);
    Object.freeze(value);
  }
  return value;
}

/** A bounded snapshot that avoids invoking application getters or toJSON methods. */
export function captureSnapshot(value: unknown, transform?: (value: unknown) => unknown): CapturedValue {
  try {
    const source = transform ? transform(value) : value;
    const ancestors = new WeakSet<object>();
    let remaining = MAX_NODES;
    let truncated = false;
    function omitted(reason: string): JsonValue {
      truncated = true;
      return { $type: 'omitted', reason };
    }
    function visit(input: unknown, depth: number): JsonValue {
      if (--remaining < 0) return omitted('snapshot node limit');
      if (input === null || typeof input === 'boolean') return input;
      if (typeof input === 'string') {
        if (input.length <= MAX_STRING) return input;
        truncated = true;
        return input.slice(0, MAX_STRING) + '…';
      }
      if (typeof input === 'number') return Number.isFinite(input) ? input : { $type: 'number', value: String(input) };
      if (typeof input === 'undefined') return { $type: 'undefined' };
      if (typeof input === 'bigint') return { $type: 'bigint', value: String(input) };
      if (typeof input === 'symbol') return { $type: 'symbol', value: String(input) };
      if (typeof input === 'function') return { $type: 'function' };
      if (depth >= MAX_DEPTH) return omitted('snapshot depth limit');
      if (ancestors.has(input)) return omitted('circular reference');
      ancestors.add(input);
      try {
        if (input instanceof Date) {
          const time = Date.prototype.getTime.call(input);
          return { $type: 'Date', value: Number.isFinite(time) ? new Date(time).toISOString() : 'Invalid Date' };
        }
        if (Array.isArray(input)) {
          const result: JsonValue[] = [];
          const count = Math.min(input.length, MAX_ENTRIES);
          for (let i = 0; i < count && remaining > 0; i++) {
            const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
            result.push(!descriptor ? { $type: 'empty' } : 'value' in descriptor ? visit(descriptor.value, depth + 1) : omitted('accessor property'));
          }
          if (result.length < input.length) result.push(omitted('array entries omitted'));
          return result;
        }
        const result: Record<string, JsonValue> = {};
        if (input instanceof Error) result.$type = 'Error';
        const keys = Object.getOwnPropertyNames(input);
        let count = 0;
        for (const key of keys) {
          if (count++ >= MAX_ENTRIES || remaining <= 0) {
            result.$omitted = omitted('object entries omitted');
            break;
          }
          const descriptor = Object.getOwnPropertyDescriptor(input, key);
          if (!descriptor) continue;
          const safeKey = key.length > MAX_STRING ? key.slice(0, MAX_STRING) + '…' : key;
          if (key.length > MAX_STRING) truncated = true;
          // Define a data property so a payload key such as __proto__ remains inert.
          Object.defineProperty(result, safeKey, {
            value: 'value' in descriptor ? visit(descriptor.value, depth + 1) : omitted('accessor property'),
            enumerable: true, configurable: true, writable: true,
          });
        }
        const prototype = Object.getPrototypeOf(input);
        if (!(input instanceof Error) && prototype !== null && prototype !== Object.prototype) {
          // Internal slots and custom prototype behavior cannot be reconstructed from own data.
          result.$preview = omitted('non-plain object; supply captureValue for a domain-specific preview');
        }
        if (Object.getOwnPropertySymbols(input).length > 0) result.$symbols = omitted('symbol-keyed properties omitted');
        return result;
      } finally {
        ancestors.delete(input);
      }
    }
    const data = visit(source, 0);
    return freezeJson({ status: truncated ? 'truncated' : 'captured', data });
  } catch {
    return Object.freeze({ status: 'unavailable', reason: 'Value capture failed; application delivery continued.' });
  }
}
