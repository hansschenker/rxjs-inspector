# Stable operator labels and the subscription graph

This increment adds an opt-in labelled-operator wrapper, observed subscription relationships, a dedicated sharing adapter, and a historical subscription graph. It targets **RxJS 7.8.2** and follows the construction/execution distinctions developed in [rxjs-lift-debug](https://github.com/hansschenker/rxjs-lift-debug).

## 1. Give the application a stable definition

Each `TraceNode` already has an explicit `id` and human-readable `label`. Operator nodes can also identify the RxJS policy and the named domain function:

```ts
{
  id: 'double',
  label: 'Double each value',
  kind: 'operator',
  operator: 'map',
  domain: 'doubleValue',
}
```

The definition ID is supplied by the application. It is not derived from `Function.name`, constructors, stack traces, values, or minified JavaScript. Definitions are copied and frozen when the inspector is created. Two definitions can have the same display label, but must have different IDs. Repeated subscriptions retain the same definition IDs and receive new execution IDs.

Use a distinct definition ID for each application stage that should be separately identifiable. Reusing an operator function across subscriptions does not require changing that definition.

## 2. Apply the real operator once

`inspector.operator(nodeId, operator)` takes an existing RxJS `OperatorFunction` and binds its output boundary to a declared operator definition:

```ts
import { of, map, filter, scan } from 'rxjs';
import { createInspector } from '@hansschenker/rxjs-inspector';

function doubleValue(value: number): number { return value * 2; }
function aboveTwo(value: number): boolean { return value > 2; }
function addValue(total: number, value: number): number { return total + value; }

const inspector = createInspector({
  name: 'Labelled arithmetic',
  nodes: [
    { id: 'source', label: 'numbers$', kind: 'source' },
    { id: 'double', label: 'Double each value', kind: 'operator', operator: 'map', domain: 'doubleValue' },
    { id: 'select', label: 'Keep values above two', kind: 'operator', operator: 'filter', domain: 'aboveTwo' },
    { id: 'total', label: 'Accumulate accepted values', kind: 'operator', operator: 'scan', domain: 'addValue' },
  ],
  edges: [
    { from: 'source', to: 'double' },
    { from: 'double', to: 'select' },
    { from: 'select', to: 'total' },
  ],
});

const totals$ = of(1, 2, 3).pipe(
  inspector.inspect<number>('source'),
  inspector.operator('double', map(doubleValue)),
  inspector.operator('select', filter(aboveTwo)),
  inspector.operator('total', scan(addValue, 0)),
);

totals$.subscribe(console.log); // 4, 10
totals$.subscribe(console.log); // A separate cold execution: 4, 10
```

The supplied operator is applied to its source **once at pipeline construction**. The returned Observable is then observed for each subscription. This is necessary for operators such as `share()` that intentionally hold state across subscribers. No predicate, projection, or reducer is evaluated an extra time for explanation.

The generic wrapper records `role: 'boundary'`. An operator label is metadata, not proof that a semantic adapter observed the operator's internals. In particular, wrapping an ordinary `switchMap` with `operator(...)` does not enable the specialized switchMap state model. Use `inspector.switchMap` to observe outer and inner execution evidence.

## 3. Keep two graphs separate

| Graph | Nodes | Edges | Meaning |
| --- | --- | --- | --- |
| Dataflow definitions | Explicit application IDs and labels | Declared `Trace.edges` | What the application describes |
| Subscription graph | Actual execution IDs, resolved labels, and lifetimes | Recorded `link` events | Which observed subscriptions were connected during this run |

One definition can have several simultaneous or successive executions. Two cold subscribers therefore produce separate runtime chains even when all labels and values match.

The recorder links its forwarding Subscribers to destinations before subscribing upstream. It keeps a weak map from its own Subscriber objects to execution identities. At a new observed boundary, it follows the actual RxJS 7.8.2 Subscriber destination chain using guarded data-property inspection to find the nearest observed downstream execution.

It does not infer relationships from declared edges, adjacent event ordinals, equal values, or a global currently-subscribing stack. An independent subscription started reentrantly by application code is therefore not assigned to the currently delivering execution. Persistent Subscriber references also allow supported delayed subscription setup to retain its relationship.

This destination-chain inspection is a version-specific implementation technique. Custom Subscriber behavior, uninstrumented sharing, and unsupported boundaries can leave gaps. There are no global RxJS patches or project-defined Observable/Subscriber subclasses.

## 4. Read observed connection kinds

| Kind | Direction | Evidence |
| --- | --- | --- |
| `upstream` | Observed upstream execution → nearest observed downstream execution | Actual Subscriber destination relationship |
| `inner` | Inner execution → its specialized operator execution | Explicit inner subscription created by the switchMap adapter |
| `shared` | Shared upstream connection execution → a sharing consumer execution | Membership observed by the dedicated sharing adapter |

Each relationship is a `kind: 'link'` event in the same bounded event ring as notifications and subscription events. It carries `link.sourceExecutionId`, `link.destinationExecutionId`, and `link.kind`. The event belongs to the source execution and is recorded after both endpoints exist.

An edge describes an observed connection. It does not mean that the destination exclusively owns the source's lifetime, or that each source value will reach the destination. A filter can reject values on a valid connection; a shared source can outlive one destination.

The existing `parentExecutionId` retains its meaning for inner executions. It is not reused to make the first consumer the parent of a shared upstream connection.

## 5. Make sharing and reset behavior explicit

The dedicated `inspector.share` adapter delegates to RxJS's actual `share`. It creates the shared result once, observes its normal Subject connector, and records the source connection independently of each consumer.

```ts
import { Subject } from 'rxjs';
import { createInspector, getSubscriptionGraph } from '@hansschenker/rxjs-inspector';

const inspector = createInspector({
  nodes: [
    { id: 'source', label: 'live values$', kind: 'source' },
    { id: 'shared', label: 'Shared values', kind: 'operator', operator: 'share' },
    { id: 'a', label: 'Consumer A', kind: 'sink' },
    { id: 'b', label: 'Consumer B', kind: 'sink' },
  ],
  edges: [
    { from: 'source', to: 'shared' },
    { from: 'shared', to: 'a' },
    { from: 'shared', to: 'b' },
  ],
});

const source$ = new Subject<number>(); // Explicit live producer.
const shared$ = source$.pipe(
  inspector.inspect<number>('source'),
  inspector.share<number>('shared', {
    resetOnError: true,
    resetOnComplete: true,
    resetOnRefCountZero: true,
  }),
);

const a = shared$.pipe(inspector.inspect<number>('a')).subscribe();
const b = shared$.pipe(inspector.inspect<number>('b')).subscribe();

// Membership is already recorded; no source value has been emitted.
console.table(getSubscriptionGraph(inspector.getTrace()).edges);

a.unsubscribe();
source$.next(42); // B remains connected; the shared source connection remains open.
b.unsubscribe(); // Default reference-count policy closes that source connection.

const later = shared$.subscribe(); // A new connection epoch with a new execution ID.
later.unsubscribe();
```

The source connection has `role: 'connection'`; each observed sharing consumer has its own boundary execution. Joining consumers are linked before the first source value, and closing the first consumer does not close the source while another remains.

All three boolean reset options default to `true`. With `resetOnRefCountZero: false`, the actual source connection can remain active while there are no consumers, until it terminates or another configured reset takes effect. The recording follows that behavior.

This adapter supports the normal Subject connector and boolean reset options. Custom connectors, replay, and notifier-based resets require additional adapters. An ordinary `share()` inside a generic `operator(...)` wrapper retains its sharing semantics, but does not gain these explicit shared-connection observations.

## 6. Query a historical graph

```ts
import { getSubscriptionGraph } from '@hansschenker/rxjs-inspector';

const trace = inspector.getTrace();
const graph = getSubscriptionGraph(trace);        // Latest captured event.
const earlier = getSubscriptionGraph(trace, 12);  // Only evidence at/before #12.
```

The result contains:

| Field | Meaning |
| --- | --- |
| `atSeq` | Requested history cursor, defaulting to the trace's total event count |
| `nodes` | Execution summaries with stable labels, optional operator/domain metadata, and history provenance |
| `edges` | Observed relationships established at or before the cursor |
| `evidence` | `observed`, `partial`, or `legacy` |

Graph nodes preserve execution identity even if several share the same label. `status` is derived from that execution's own recorded lifecycle. An edge is active when both endpoint lifetimes are known active, closed when either has ended, and unknown when the necessary lifetime evidence is absent.

`observed` means recorded evidence at instrumented boundaries. It is not a claim that the entire application was instrumented. `partial` identifies an evicted prefix or missing endpoint history. `legacy` means a v1 recording with no explicit runtime link events.

If a retained link refers to an endpoint whose history has been evicted, the graph includes an unknown placeholder identified by that execution ID. It does not invent a node definition, role, label, start time, or activity state. For a known definition whose start has been lost, the stable label remains available but start/lifetime provenance is marked as missing history.

Links can be evicted with the event prefix. The graph does not reconstruct a lost link from the declared graph or from retained matching values. This keeps relationship history bounded by the same retention policy as the other observations.

## 7. Explore it in the viewer

The viewer retains the Dataflow definitions graph and adds a separate Subscription graph. Runtime nodes display the stable label and distinct execution ID. Relationship kinds and lifetime status are visible at the selected event, alongside the existing timeline and event details.

Selecting an execution or relationship navigates recorded history. It does not reconnect to the application or rerun effects. HTML-like labels and captured values are rendered as text.

The demo includes labelled arithmetic, independent cold executions, and explicitly shared consumers. The shared fixture includes a point where the first consumer has ended while the other consumer and source connection remain active.

## 8. Portable evidence and supported scope

New recordings use schema v2. Import continues to accept and preserve v1 recordings. A v1 graph reports legacy evidence and does not manufacture links; existing event, timeline, and switchMap-model analysis remains available.

Validation checks relationship endpoints, direction, event ownership, duplicate relationships, role-specific relations, and retention-aware references. Link events obey the same sequence, clock, event-capacity, immutability, and JSON-only rules as notification events.

This increment supplies stable names and observable topology. Private operator state, general scheduler instrumentation, arbitrary reset-policy models, and deterministic application replay remain separate work. See [Architecture](ARCHITECTURE.md), [Trace format](TRACE_FORMAT.md), and [Roadmap](ROADMAP.md).
