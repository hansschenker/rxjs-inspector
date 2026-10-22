import type { CapturedValue, JsonValue, Trace, TraceEdge, TraceEvent, TraceNode } from './types.js';

const MAX_TRACE_CHARACTERS = 32 * 1024 * 1024;
const MAX_RETAINED_EVENTS = 250_000;
const MAX_VALUE_DEPTH = 128;

function fail(path: string, message: string): never {
  throw new TypeError(`Invalid trace at ${path}: ${message}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(path, 'expected an object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(path, 'expected a plain object');
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, 'unknown field');
  }
}

function string(value: unknown, path: string, nonempty = false): string {
  if (typeof value !== 'string' || (nonempty && value.length === 0)) return fail(path, 'expected a string');
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    return fail(path, `expected a safe integer >= ${minimum}`);
  }
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(path, 'expected a finite number');
  return value;
}

function choice<const T extends string>(value: unknown, options: readonly T[], path: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) return fail(path, `expected ${options.join(' | ')}`);
  return value as T;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) return fail(path, 'expected an array');
  return value;
}

function has(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

/** Null-prototype objects keep arbitrary payload keys inert, including __proto__. */
function jsonValue(value: unknown, path: string, depth = 0, ancestors = new Set<object>()): JsonValue {
  if (depth > MAX_VALUE_DEPTH) return fail(path, `payload nesting exceeds ${MAX_VALUE_DEPTH}`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return finite(value, path);
  if (typeof value !== 'object') return fail(path, 'expected JSON-only data');
  if (ancestors.has(value)) return fail(path, 'cyclic payload');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result = value.map((item, index) => jsonValue(item, `${path}[${index}]`, depth + 1, ancestors));
      return Object.freeze(result) as unknown as JsonValue[];
    }
    const input = object(value, path);
    const result = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(input)) {
      result[key] = jsonValue(input[key], `${path}.${key}`, depth + 1, ancestors);
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

function capturedValue(value: unknown, path: string): CapturedValue {
  const input = object(value, path);
  keys(input, ['status', 'data', 'reason'], path);
  const status = choice(input.status, ['captured', 'truncated', 'unavailable'], `${path}.status`);
  if (status === 'captured' && !has(input, 'data')) fail(path, 'captured values require data');
  return Object.freeze({
    status,
    ...(has(input, 'data') ? { data: jsonValue(input.data, `${path}.data`) } : {}),
    ...(has(input, 'reason') ? { reason: string(input.reason, `${path}.reason`) } : {}),
  });
}

function validateTrace(value: unknown): Trace {
  const input = object(value, '$');
  keys(input, ['schemaVersion', 'name', 'rxjsBaseline', 'clock', 'nodes', 'edges', 'events', 'capture'], '$');
  if (input.schemaVersion !== 1) fail('$.schemaVersion', 'only schema version 1 is supported');
  if (input.rxjsBaseline !== '7.8.2') fail('$.rxjsBaseline', 'only the RxJS 7.8.2 baseline is supported');
  const name = string(input.name, '$.name');
  const clockInput = object(input.clock, '$.clock');
  keys(clockInput, ['name', 'kind', 'unit'], '$.clock');
  if (clockInput.unit !== 'ms') fail('$.clock.unit', 'expected ms');
  const clock = Object.freeze({
    name: string(clockInput.name, '$.clock.name'),
    kind: choice(clockInput.kind, ['monotonic', 'virtual', 'custom'], '$.clock.kind'),
    unit: 'ms' as const,
  });

  const nodeIds = new Set<string>();
  const nodes = array(input.nodes, '$.nodes').map((entry, index): TraceNode => {
    const path = `$.nodes[${index}]`;
    const node = object(entry, path);
    keys(node, ['id', 'label', 'kind', 'operator', 'domain'], path);
    const id = string(node.id, `${path}.id`, true);
    if (nodeIds.has(id)) fail(`${path}.id`, 'duplicate node ID');
    nodeIds.add(id);
    return Object.freeze({
      id,
      label: string(node.label, `${path}.label`),
      kind: choice(node.kind, ['source', 'operator', 'sink'], `${path}.kind`),
      ...(has(node, 'operator') ? { operator: string(node.operator, `${path}.operator`) } : {}),
      ...(has(node, 'domain') ? { domain: string(node.domain, `${path}.domain`) } : {}),
    });
  });

  const edges = array(input.edges, '$.edges').map((entry, index): TraceEdge => {
    const path = `$.edges[${index}]`;
    const edge = object(entry, path);
    keys(edge, ['from', 'to'], path);
    const from = string(edge.from, `${path}.from`, true);
    const to = string(edge.to, `${path}.to`, true);
    if (!nodeIds.has(from) || !nodeIds.has(to)) fail(path, 'edge refers to an unknown node');
    return Object.freeze({ from, to });
  });

  const captureInput = object(input.capture, '$.capture');
  keys(captureInput, ['maxEvents', 'droppedEvents', 'totalEvents', 'complete', 'clockErrors'], '$.capture');
  const maxEvents = integer(captureInput.maxEvents, '$.capture.maxEvents', 1);
  const droppedEvents = integer(captureInput.droppedEvents, '$.capture.droppedEvents');
  const totalEvents = integer(captureInput.totalEvents, '$.capture.totalEvents');
  const clockErrors = has(captureInput, 'clockErrors') ? integer(captureInput.clockErrors, '$.capture.clockErrors') : undefined;
  if (captureInput.complete !== (droppedEvents === 0)) fail('$.capture.complete', 'must indicate whether any prefix events were dropped');
  const entries = array(input.events, '$.events');
  if (entries.length > MAX_RETAINED_EVENTS) fail('$.events', `at most ${MAX_RETAINED_EVENTS} retained events can be imported`);
  if (entries.length > maxEvents) fail('$.events', 'retained events exceed maxEvents');
  if (totalEvents !== droppedEvents + entries.length) fail('$.capture.totalEvents', 'must equal droppedEvents + retained events');

  const executionFirst = new Map<string, TraceEvent>();
  const terminated = new Set<string>();
  const events = entries.map((entry, index): TraceEvent => {
    const path = `$.events[${index}]`;
    const event = object(entry, path);
    keys(event, ['seq', 'time', 'nodeId', 'executionId', 'kind', 'port', 'role', 'parentExecutionId', 'causeEventSeq', 'innerIndex', 'value'], path);
    const seq = integer(event.seq, `${path}.seq`, 1);
    if (seq !== droppedEvents + index + 1) fail(`${path}.seq`, 'events must be a contiguous ordered suffix of the recording');
    const nodeId = string(event.nodeId, `${path}.nodeId`, true);
    if (!nodeIds.has(nodeId)) fail(`${path}.nodeId`, 'unknown node');
    const executionId = string(event.executionId, `${path}.executionId`, true);
    const kind = choice(event.kind, ['subscribe', 'next', 'error', 'complete', 'unsubscribe'], `${path}.kind`);
    const port = choice(event.port, ['input', 'output'], `${path}.port`);
    const role = choice(event.role, ['boundary', 'operator', 'inner'], `${path}.role`);
    if ((kind === 'subscribe' || kind === 'unsubscribe') && port !== 'output') fail(path, 'subscription lifecycle events require the output port');
    if (port === 'input' && role !== 'operator') fail(path, 'only operator executions have an input port');
    const parentExecutionId = has(event, 'parentExecutionId') ? string(event.parentExecutionId, `${path}.parentExecutionId`, true) : undefined;
    if (role === 'inner' && parentExecutionId === undefined) fail(path, 'inner executions require parentExecutionId');
    if (parentExecutionId === executionId) fail(path, 'an execution cannot parent itself');
    const causeEventSeq = has(event, 'causeEventSeq') ? integer(event.causeEventSeq, `${path}.causeEventSeq`, 1) : undefined;
    if (causeEventSeq !== undefined && causeEventSeq >= seq) fail(`${path}.causeEventSeq`, 'cause must precede this event');
    const result: TraceEvent = Object.freeze({
      seq,
      time: finite(event.time, `${path}.time`),
      nodeId,
      executionId,
      kind,
      port,
      role,
      ...(parentExecutionId !== undefined ? { parentExecutionId } : {}),
      ...(causeEventSeq !== undefined ? { causeEventSeq } : {}),
      ...(has(event, 'innerIndex') ? { innerIndex: integer(event.innerIndex, `${path}.innerIndex`) } : {}),
      ...(has(event, 'value') ? { value: capturedValue(event.value, `${path}.value`) } : {}),
    });
    if ((kind === 'next' || kind === 'error') && result.value === undefined) fail(path, 'next and error events require a captured-value result');
    const first = executionFirst.get(executionId);
    if (first) {
      if (kind === 'subscribe') fail(path, 'duplicate execution subscription');
      if (first.nodeId !== nodeId || first.role !== role || first.parentExecutionId !== parentExecutionId || first.innerIndex !== result.innerIndex) {
        fail(path, 'execution metadata changed');
      }
      if (terminated.has(executionId)) fail(path, 'event after execution termination');
    } else {
      if (kind !== 'subscribe' && droppedEvents === 0) fail(path, 'execution must begin with subscribe');
      if (parentExecutionId !== undefined && !executionFirst.has(parentExecutionId) && droppedEvents === 0) fail(path, 'parent execution must already exist');
      executionFirst.set(executionId, result);
    }
    if (port === 'output' && (kind === 'complete' || kind === 'error' || kind === 'unsubscribe')) terminated.add(executionId);
    return result;
  });

  return Object.freeze({
    schemaVersion: 1,
    name,
    rxjsBaseline: '7.8.2',
    clock,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    events: Object.freeze(events),
    capture: Object.freeze({ maxEvents, droppedEvents, totalEvents, complete: droppedEvents === 0, ...(clockErrors !== undefined ? { clockErrors } : {}) }),
  });
}

/** Validate and export a portable recording. This never re-executes its sources. */
export function serializeTrace(trace: Trace): string {
  const json = JSON.stringify(validateTrace(trace), null, 2);
  if (json.length > MAX_TRACE_CHARACTERS) throw new RangeError('Trace exceeds the 32 Mi-character export limit');
  return json;
}

/** Import an immutable trace, validating structure, references, ordering, and retention. */
export function parseTrace(json: string): Trace {
  if (typeof json !== 'string') throw new TypeError('Trace JSON must be a string');
  if (json.length > MAX_TRACE_CHARACTERS) throw new RangeError('Trace exceeds the 32 Mi-character import limit');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new TypeError('Invalid trace JSON');
  }
  return validateTrace(parsed);
}
