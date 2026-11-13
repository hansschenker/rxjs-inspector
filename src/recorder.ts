import { Observable, Subject, Subscriber, from, share as rxShare, switchMap as rxSwitchMap } from 'rxjs';
import type { MonoTypeOperatorFunction, ObservableInput, OperatorFunction, SubjectLike } from 'rxjs';
import { captureSnapshot, freezeJson } from './capture.js';
import type { ExecutionRole, SubscriptionLink, Trace, TraceEdge, TraceEvent, TraceEventKind, TraceNode } from './types.js';

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
  /** Bind an explicit operator definition to its actual, once-constructed result. */
  readonly operator: <T, R>(nodeId: string, operator: OperatorFunction<T, R>) => OperatorFunction<T, R>;
  readonly share: <T>(nodeId: string, options?: InspectorShareOptions) => MonoTypeOperatorFunction<T>;
  readonly switchMap: <T, R>(nodeId: string, project: (value: T, index: number) => ObservableInput<R>) => OperatorFunction<T, R>;
  readonly getTrace: () => Trace;
}

/** The observed share adapter uses a normal Subject and boolean reset policies. */
export type InspectorShareOptions = {
  readonly resetOnError?: boolean;
  readonly resetOnComplete?: boolean;
  readonly resetOnRefCountZero?: boolean;
};

type Execution = {
  readonly id: string;
  readonly nodeId: string;
  readonly role: ExecutionRole;
  readonly parentExecutionId?: string;
  readonly innerIndex?: number;
  closed: boolean;
};

type ExecutionContext = {
  readonly destination?: unknown;
  readonly parent?: Execution;
  readonly innerIndex?: number;
};

/** Create an opt-in recorder. Constructing or viewing it never subscribes to application sources. */
export function createInspector(options: InspectorOptions): Inspector {
  const maxEvents = options.maxEvents ?? 50_000;
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 250_000) {
    throw new RangeError('maxEvents must be an integer from 1 through 250000.');
  }
  const nodes = options.nodes.map(({ id, label, kind, operator, domain }) => {
    if (operator !== undefined && typeof operator !== 'string') throw new TypeError('A node operator label must be a string when supplied.');
    if (domain !== undefined && typeof domain !== 'string') throw new TypeError('A node domain label must be a string when supplied.');
    return Object.freeze({
      id, label, kind,
      ...(operator === undefined ? {} : { operator }),
      ...(domain === undefined ? {} : { domain }),
    });
  });
  const edges = (options.edges ?? []).map(({ from, to }) => Object.freeze({ from, to }));
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
  const recordedSubscribers = new WeakMap<object, Execution>();

  function withCause<T>(seq: number, deliver: () => T): T {
    const previous = cause;
    cause = seq;
    try { return deliver(); } finally { cause = previous; }
  }
  function record(execution: Execution, kind: TraceEventKind, port: 'input' | 'output', value?: unknown, link?: SubscriptionLink): number {
    const captured = kind === 'next' || kind === 'error' ? captureSnapshot(value, captureValue) : undefined;
    const time = readTime();
    const seq = ++totalEvents;
    const event: TraceEvent = Object.freeze({
      seq, time, nodeId: execution.nodeId, executionId: execution.id, kind, port, role: execution.role,
      ...(execution.parentExecutionId === undefined ? {} : { parentExecutionId: execution.parentExecutionId }),
      ...(execution.innerIndex === undefined ? {} : { innerIndex: execution.innerIndex }),
      ...(cause === undefined ? {} : { causeEventSeq: cause }),
      ...(captured === undefined ? {} : { value: captured }),
      ...(link === undefined ? {} : { link: Object.freeze(link) }),
    });
    ring[(seq - 1) % maxEvents] = event;
    if (port === 'output' && (kind === 'complete' || kind === 'error' || kind === 'unsubscribe')) execution.closed = true;
    return seq;
  }

  /** Follow only real Subscriber data fields in the pinned RxJS version. */
  function findRecordedDestination(destination: unknown): Execution | undefined {
    const visited = new Set<object>();
    let current = destination;
    try {
      while (current instanceof Subscriber && !visited.has(current) && visited.size < 1_024) {
        const execution = recordedSubscribers.get(current);
        if (execution) return execution.closed ? undefined : execution;
        visited.add(current);
        const descriptor = Object.getOwnPropertyDescriptor(current, 'destination');
        if (!descriptor || !('value' in descriptor)) return undefined;
        current = descriptor.value;
      }
    } catch { /* Unsupported destination shapes remain unlinked; delivery is unchanged. */ }
    return undefined;
  }

  function recordLink(source: Execution, destination: Execution, kind: SubscriptionLink['kind']): void {
    if (source.id === destination.id || source.closed || destination.closed) return;
    record(source, 'link', 'output', undefined, {
      kind, sourceExecutionId: source.id, destinationExecutionId: destination.id,
    });
  }

  function begin(nodeId: string, role: ExecutionRole, context: ExecutionContext = {}): Execution {
    const execution: Execution = {
      id: `e${++nextExecution}`, nodeId, role, closed: false,
      ...(context.parent === undefined ? {} : { parentExecutionId: context.parent.id }),
      ...(context.innerIndex === undefined ? {} : { innerIndex: context.innerIndex }),
    };
    record(execution, 'subscribe', 'output');
    if (context.parent) {
      recordLink(execution, context.parent, 'inner');
    } else if (role !== 'connection') {
      const destination = findRecordedDestination(context.destination);
      if (destination) recordLink(execution, destination, 'upstream');
    }
    return execution;
  }
  function getNode(nodeId: string): TraceNode {
    const node = nodeById.get(nodeId);
    if (!node) throw new Error(`Unknown node: ${nodeId}. Declare it in createInspector({ nodes }).`);
    return node;
  }

  function getOperatorNode(nodeId: string, operator?: string): TraceNode {
    const node = getNode(nodeId);
    if (node.kind !== 'operator' || typeof node.operator !== 'string' || !node.operator.trim() || (operator !== undefined && node.operator !== operator)) {
      throw new TypeError(`An inspected ${operator ?? 'operator'} needs a node with kind "operator" and ${operator === undefined ? 'a nonempty operator label' : `operator "${operator}"`}.`);
    }
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
    recordedSubscribers.set(observer, execution);
    // Link before subscribing: take(1) and reentrant disposal must close a synchronous source immediately.
    destination.add(observer);
    if (lifecycle) observer.add(() => { if (!terminal) record(execution, 'unsubscribe', 'output'); });
    observer.add(() => recordedSubscribers.delete(observer));
    if (!observer.closed) source.subscribe(observer);
  }

  function inspect<T>(nodeId: string): MonoTypeOperatorFunction<T> {
    getNode(nodeId);
    return source => new Observable<T>(destination => {
      if (destination.closed) return;
      const execution = begin(nodeId, 'boundary', { destination });
      forward(source, destination, execution, 'output', true);
    });
  }

  function inspectOperator<T, R>(nodeId: string, operator: OperatorFunction<T, R>): OperatorFunction<T, R> {
    getOperatorNode(nodeId);
    if (typeof operator !== 'function') throw new TypeError('An inspected operator must be an OperatorFunction.');
    return source => {
      // Apply once at definition time: reapplying per subscription would recreate share state.
      const result = operator(source);
      return inspect<R>(nodeId)(result);
    };
  }

  function inspectShare<T>(nodeId: string, resetOptions: InspectorShareOptions = {}): MonoTypeOperatorFunction<T> {
    getOperatorNode(nodeId, 'share');
    const resetNames = ['resetOnError', 'resetOnComplete', 'resetOnRefCountZero'] as const;
    if (resetOptions === null || typeof resetOptions !== 'object' || Array.isArray(resetOptions)) throw new TypeError('Share reset options must be an object.');
    for (const key of Object.keys(resetOptions)) {
      if (!(resetNames as readonly string[]).includes(key)) throw new TypeError(`Unsupported inspected share option: ${key}. Only boolean reset policies are supported.`);
    }
    for (const key of resetNames) {
      if (resetOptions[key] !== undefined && typeof resetOptions[key] !== 'boolean') throw new TypeError(`Inspected share ${key} must be boolean.`);
    }
    const resets = {
      resetOnError: resetOptions.resetOnError ?? true,
      resetOnComplete: resetOptions.resetOnComplete ?? true,
      resetOnRefCountZero: resetOptions.resetOnRefCountZero ?? true,
    };

    return source => {
      type SharedHub = { readonly members: Map<string, Execution>; connection?: Execution };
      let currentHub: SharedHub | undefined;

      function createConnector(): SubjectLike<T> {
        const subject = new Subject<T>();
        const hub: SharedHub = { members: new Map() };
        currentHub = hub;
        return {
          next: value => subject.next(value),
          error: error => subject.error(error),
          complete: () => subject.complete(),
          subscribe(observer) {
            const consumer = findRecordedDestination(observer);
            if (consumer && observer instanceof Subscriber && !observer.closed) {
              hub.members.set(consumer.id, consumer);
              observer.add(() => hub.members.delete(consumer.id));
              if (hub.connection) recordLink(hub.connection, consumer, 'shared');
            }
            return subject.subscribe(observer);
          },
        };
      }

      const connectedSource = new Observable<T>(destination => {
        if (destination.closed) return;
        // Capture this connector epoch; a terminal callback may synchronously create another.
        const hub = currentHub;
        const connection = begin(nodeId, 'connection');
        if (hub) {
          hub.connection = connection;
          for (const consumer of hub.members.values()) recordLink(connection, consumer, 'shared');
        }
        forward(source, destination, connection, 'output', true);
      });

      // Real RxJS owns the Subject lifecycle and reset/ref-count behavior.
      const shared = connectedSource.pipe(rxShare({ ...resets, connector: createConnector }));
      return inspect<T>(nodeId)(shared);
    };
  }

  function inspectSwitchMap<T, R>(nodeId: string, project: (value: T, index: number) => ObservableInput<R>): OperatorFunction<T, R> {
    getOperatorNode(nodeId, 'switchMap');
    return source => new Observable<R>(destination => {
      if (destination.closed) return;
      const execution = begin(nodeId, 'operator', { destination });
      const input = new Observable<T>(inputDestination => forward(source, inputDestination, execution, 'input', false));
      function projectInner(value: T, index: number): Observable<R> {
        // Invoke the domain function at RxJS's own projection point, preserving reentrant behavior.
        const innerSource = project(value, index);
        return new Observable<R>(innerDestination => {
          if (innerDestination.closed) return;
          const innerExecution = begin(nodeId, 'inner', { parent: execution, innerIndex: index });
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
      schemaVersion: 2 as const,
      name: options.name ?? 'RxJS execution',
      rxjsBaseline: '7.8.2' as const,
      clock: clockMetadata,
      nodes, edges, events,
      capture: { maxEvents, totalEvents, droppedEvents: first, complete: first === 0, ...(clockErrors === 0 ? {} : { clockErrors }) },
    });
  }

  return Object.freeze({ inspect, operator: inspectOperator, share: inspectShare, switchMap: inspectSwitchMap, getTrace });
}
