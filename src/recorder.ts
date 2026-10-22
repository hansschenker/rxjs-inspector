import { Observable, Subscriber, from, switchMap as rxSwitchMap } from 'rxjs';
import type { MonoTypeOperatorFunction, ObservableInput, OperatorFunction } from 'rxjs';
import { captureSnapshot, freezeJson } from './capture.js';
import type { ExecutionRole, Trace, TraceEdge, TraceEvent, TraceEventKind, TraceNode } from './types.js';

export interface InspectorOptions {
  readonly name?: string;
  readonly nodes: readonly TraceNode[];
  readonly edges?: readonly TraceEdge[];
  readonly maxEvents?: number;
  readonly clock?: { readonly name: string; readonly kind: 'monotonic' | 'virtual' | 'custom'; readonly now: () => number };
  /** Optional capture-time projection. Must be observational: do not emit, mutate, or subscribe here. */
  readonly captureValue?: (value: unknown) => unknown;
}

export interface Inspector {
  readonly inspect: <T>(nodeId: string) => MonoTypeOperatorFunction<T>;
  readonly switchMap: <T, R>(nodeId: string, project: (value: T, index: number) => ObservableInput<R>) => OperatorFunction<T, R>;
  readonly getTrace: () => Trace;
}

interface Execution {
  readonly id: string;
  readonly nodeId: string;
  readonly role: ExecutionRole;
  readonly parentExecutionId?: string;
  readonly innerIndex?: number;
}

/** Create an opt-in recorder. Constructing or viewing it never subscribes to application sources. */
export function createInspector(options: InspectorOptions): Inspector {
  const maxEvents = options.maxEvents ?? 50_000;
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 250_000) {
    throw new RangeError('maxEvents must be an integer from 1 through 250000.');
  }
  const nodes = options.nodes.map(node => Object.freeze({ ...node }));
  const edges = (options.edges ?? []).map(edge => Object.freeze({ ...edge }));
  const nodeById = new Map<string, TraceNode>();
  for (const node of nodes) {
    if (typeof node.id !== 'string' || !node.id.trim() || typeof node.label !== 'string' || !node.label.trim()) {
      throw new TypeError('Every node needs a nonempty id and label.');
    }
    if (nodeById.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
    if (!['source', 'operator', 'sink'].includes(node.kind)) throw new TypeError(`Invalid node kind: ${node.id}`);
    nodeById.set(node.id, node);
  }
  for (const edge of edges) if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) throw new Error('An edge refers to an unknown node.');
  const clock = options.clock ?? { name: 'performance', kind: 'monotonic' as const, now: () => performance.now() };
  const clockMetadata = Object.freeze({ name: clock.name, kind: clock.kind, unit: 'ms' as const });
  if (!['monotonic', 'virtual', 'custom'].includes(clock.kind) || typeof clock.now !== 'function') throw new TypeError('Invalid clock.');
  let clockErrors = 0;
  let origin: number | undefined;
  let lastTime = 0;
  try { const first = clock.now(); if (Number.isFinite(first)) origin = first; else clockErrors++; } catch { clockErrors++; }
  function readTime(): number {
    try {
      const now = clock.now();
      if (!Number.isFinite(now)) throw new Error('nonfinite clock');
      origin ??= now;
      const relative = now - origin;
      if (!Number.isFinite(relative) || relative < lastTime) throw new Error('invalid relative clock');
      lastTime = relative;
    } catch { clockErrors++; }
    return lastTime;
  }
  const ring: TraceEvent[] = [];
  let totalEvents = 0;
  let nextExecution = 0;
  let cause: number | undefined;
  const captureValue = options.captureValue;

  function withCause<T>(seq: number, deliver: () => T): T {
    const previous = cause;
    cause = seq;
    try { return deliver(); } finally { cause = previous; }
  }
  function record(execution: Execution, kind: TraceEventKind, port: 'input' | 'output', value?: unknown): number {
    const captured = kind === 'next' || kind === 'error' ? captureSnapshot(value, captureValue) : undefined;
    const time = readTime();
    const seq = ++totalEvents;
    const event: TraceEvent = Object.freeze({
      seq, time, nodeId: execution.nodeId, executionId: execution.id, kind, port, role: execution.role,
      ...(execution.parentExecutionId === undefined ? {} : { parentExecutionId: execution.parentExecutionId }),
      ...(execution.innerIndex === undefined ? {} : { innerIndex: execution.innerIndex }),
      ...(cause === undefined ? {} : { causeEventSeq: cause }),
      ...(captured === undefined ? {} : { value: captured }),
    });
    ring[(seq - 1) % maxEvents] = event;
    return seq;
  }
  function begin(nodeId: string, role: ExecutionRole, parentExecutionId?: string, innerIndex?: number): Execution {
    const execution: Execution = {
      id: `e${++nextExecution}`, nodeId, role,
      ...(parentExecutionId === undefined ? {} : { parentExecutionId }),
      ...(innerIndex === undefined ? {} : { innerIndex }),
    };
    record(execution, 'subscribe', 'output');
    return execution;
  }
  function getNode(nodeId: string): TraceNode {
    const node = nodeById.get(nodeId);
    if (!node) throw new Error(`Unknown node: ${nodeId}. Declare it in createInspector({ nodes }).`);
    return node;
  }

  function forward<T>(source: Observable<T>, destination: Subscriber<T>, execution: Execution, port: 'input' | 'output', lifecycle: boolean): void {
    let terminal = false;
    const observer = new Subscriber<T>({
      next(value) {
        const seq = record(execution, 'next', port, value);
        withCause(seq, () => destination.next(value));
      },
      error(error: unknown) {
        terminal = true;
        const seq = record(execution, 'error', port, error);
        withCause(seq, () => destination.error(error));
      },
      complete() {
        terminal = true;
        const seq = record(execution, 'complete', port);
        withCause(seq, () => destination.complete());
      },
    });
    // Link before subscribing: take(1) and reentrant disposal must close a synchronous source immediately.
    destination.add(observer);
    if (lifecycle) observer.add(() => { if (!terminal) record(execution, 'unsubscribe', 'output'); });
    if (!observer.closed) source.subscribe(observer);
  }

  function inspect<T>(nodeId: string): MonoTypeOperatorFunction<T> {
    getNode(nodeId);
    return source => new Observable<T>(destination => {
      if (destination.closed) return;
      const execution = begin(nodeId, 'boundary');
      forward(source, destination, execution, 'output', true);
    });
  }

  function inspectSwitchMap<T, R>(nodeId: string, project: (value: T, index: number) => ObservableInput<R>): OperatorFunction<T, R> {
    const node = getNode(nodeId);
    if (node.kind !== 'operator' || node.operator !== 'switchMap') throw new TypeError('An inspected switchMap needs a node with kind "operator" and operator "switchMap".');
    return source => new Observable<R>(destination => {
      if (destination.closed) return;
      const execution = begin(nodeId, 'operator');
      const input = new Observable<T>(inputDestination => forward(source, inputDestination, execution, 'input', false));
      function projectInner(value: T, index: number): Observable<R> {
        // Invoke the domain function at RxJS's own projection point, preserving reentrant behavior.
        const innerSource = project(value, index);
        return new Observable<R>(innerDestination => {
          if (innerDestination.closed) return;
          const innerExecution = begin(nodeId, 'inner', execution.id, index);
          // Conversion stays inside the Observable error boundary for invalid runtime inputs.
          let observable: Observable<R>;
          try { observable = from(innerSource); }
          catch (error) {
            const seq = record(innerExecution, 'error', 'output', error);
            withCause(seq, () => innerDestination.error(error));
            return;
          }
          forward(observable, innerDestination, innerExecution, 'output', true);
        });
      }
      forward(input.pipe(rxSwitchMap(projectInner)), destination, execution, 'output', true);
    });
  }

  function getTrace(): Trace {
    const count = Math.min(totalEvents, maxEvents);
    const first = totalEvents - count;
    const events = Array.from({ length: count }, (_, index) => ring[(first + index) % maxEvents]!);
    return freezeJson({
      schemaVersion: 1 as const,
      name: options.name ?? 'RxJS execution',
      rxjsBaseline: '7.8.2' as const,
      clock: clockMetadata,
      nodes, edges, events,
      capture: { maxEvents, totalEvents, droppedEvents: first, complete: first === 0, ...(clockErrors === 0 ? {} : { clockErrors }) },
    });
  }

  return Object.freeze({ inspect, switchMap: inspectSwitchMap, getTrace });
}
