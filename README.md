# rxjs-inspector

**See what flowed, which subscription execution it belonged to, and why the dataflow advanced, waited, cancelled, or terminated.**

A TypeScript library and framework-independent browser viewer for **RxJS 7.8.2**. It records real subscription executions at explicitly named boundaries, binds stable labels to real operators, and provides instrumented `switchMap` and `share` adapters built on RxJS's own implementations.

The current version includes an explicit subscription graph alongside the declared dataflow graph, portable JSON traces, subscription timelines, historical value snapshots, causal navigation, a deliberately bounded `switchMap` explanation model, and runnable examples. New recordings use trace format v2; existing v1 recordings remain readable.

**GPT-6 Astra is the main contributor to this project.** Created in collaboration with [hansschenker](https://github.com/hansschenker).

## Try it

Use Node.js 22.8 or later; the runtime library targets browsers and Node.js with ES2022 support.

```sh
git clone https://github.com/hansschenker/rxjs-inspector.git
cd rxjs-inspector
npm install
npm run demo
```

Open the local URL printed by the command (normally `http://127.0.0.1:4173`). The demo records real RxJS fixtures. Moving the history cursor reads the saved trace; it does not subscribe to the application or run effects.

```sh
npm run example        # Write search-trace.json using a virtual scheduler
npm run check          # Type checking, behavior tests, and library build
npm pack              # Build an installable local package
```

The project is stored on GitHub. An npm registry release has not been published. To install directly from this repository into an application:

```sh
npm install github:hansschenker/rxjs-inspector rxjs@7.8.2
```

The package name is `@hansschenker/rxjs-inspector`. The Git installation runs the preparation build. For a reproducible installation, pin a Git commit or install a tarball produced by `npm pack`.

## What flows over time

An Observable describes a dataflow. A subscription starts an observed execution. Each subscription receives its own identity and recorded lifecycle; creating an inspector or opening its viewer does not create application subscriptions.

The recorder preserves three notification kinds (`next`, `error`, `complete`) and separate subscription start and early-unsubscription events. Operators provide dataflow policies; named domain functions provide application meaning.

The inspected `switchMap` records:

- Outer input notifications and output notifications as distinct ports.
- Each inner subscription and its parent operator execution.
- Replacement of an earlier inner subscription when a new input arrives.
- The period after outer completion while an active inner is still running.
- Causal event links observed during synchronous delivery.

`unsubscribe` means an observed subscription was disposed before a terminal notification. It does not by itself establish that an HTTP transport or remote server stopped working.

## Record a pipeline

```ts
import { Subject, type Observable } from 'rxjs';
import { createInspector } from '@hansschenker/rxjs-inspector';

interface SearchResult {
  readonly query: string;
  readonly title: string;
}

// Your named domain function supplies the source and its cancellation behavior.
declare function loadResult$(query: string): Observable<SearchResult>;
declare function renderResult(result: SearchResult): void;

const inspector = createInspector({
  name: 'Search',
  nodes: [
    { id: 'queries', label: 'queries$', kind: 'source' },
    {
      id: 'latest', label: 'latest result', kind: 'operator',
      operator: 'switchMap', domain: 'loadResult$',
    },
    { id: 'results', label: 'results$', kind: 'sink' },
  ],
  edges: [
    { from: 'queries', to: 'latest' },
    { from: 'latest', to: 'results' },
  ],
});

const queries$ = new Subject<string>(); // Explicit live source.
const results$ = queries$.pipe(
  inspector.inspect<string>('queries'),
  inspector.switchMap('latest', loadResult$),
  inspector.inspect<SearchResult>('results'),
);

const subscription = results$.subscribe({ next: renderResult });
queries$.next('rxjs');
queries$.next('rxjs cancellation');

// At the application's normal disposal boundary:
subscription.unsubscribe();
const trace = inspector.getTrace();
```

The nodes and edges describe the dataflow definitions explicitly. The recorder also records relationships between the actual observed subscriptions. It does not attempt to recover an arbitrary pipeline from compiled JavaScript. Use `inspect` around any stage to observe its boundary; only `inspector.switchMap` supplies the inner-execution observations required by the current switchMap explanation model.

Calling `getTrace()` returns a detached, frozen snapshot of the recording at that point. Subsequent recording does not change it.

## Stable operator labels

Bind an explicit definition to an existing RxJS operator with `inspector.operator(nodeId, operator)`. The ID and label come from the declared metadata and survive repeated subscriptions and trace export/import; function names and minified code are never used to guess them.

```ts
import { of, map } from 'rxjs';
import { createInspector, getSubscriptionGraph } from '@hansschenker/rxjs-inspector';

function doubleValue(value: number): number { return value * 2; }

const inspector = createInspector({
  nodes: [
    { id: 'source', label: 'numbers$', kind: 'source' },
    { id: 'double', label: 'Double each value', kind: 'operator', operator: 'map', domain: 'doubleValue' },
    { id: 'result', label: 'result$', kind: 'sink' },
  ],
  edges: [{ from: 'source', to: 'double' }, { from: 'double', to: 'result' }],
});

const result$ = of(1, 2, 3).pipe(
  inspector.inspect<number>('source'),
  inspector.operator('double', map(doubleValue)),
  inspector.inspect<number>('result'),
);

result$.subscribe();
result$.subscribe(); // A separate cold execution with the same definition labels.

const graph = getSubscriptionGraph(inspector.getTrace());
console.table(graph.nodes.map(node => ({
  label: node.label, definition: node.nodeId, execution: node.id, status: node.status,
})));
console.table(graph.edges);
```

The supplied operator is applied once when the pipeline is constructed. Each subscription gets its own observed output execution. This preserves operators that intentionally share construction-time state. Generic labels expose output boundaries; they do not manufacture inner-subscription or private-state evidence. Use the specialized adapters for their additional observations.

See [Stable labels and the subscription graph](docs/SUBSCRIPTION_GRAPH.md) for the full API, relationship kinds, sharing example, and evidence limits.

## Open the viewer

```ts
import { mountInspector } from '@hansschenker/rxjs-inspector/viewer';

const element = document.querySelector<HTMLElement>('#inspector')!;
const viewer = mountInspector(element, inspector.getTrace());

// Refresh explicitly when the application chooses to expose a newer snapshot.
viewer.setTrace(inspector.getTrace());

// Remove the viewer and its event handlers when the host view is disposed.
viewer.destroy();
```

The viewer provides event stepping, an event selector, the declared pipeline graph, a separate subscription graph at the selected cursor, subscription lifetime lanes, captured values, causal navigation, and operator explanations. It accepts exported JSON locally. No server, telemetry, or cloud service is required.

The root package can be imported in Node without a DOM. Browser rendering is an optional, separate entry point.

## Export, import, and inspect programmatically

```ts
import {
  serializeTrace, parseTrace, getExecutions, getSubscriptionGraph, getSwitchMapState,
} from '@hansschenker/rxjs-inspector';

const json = serializeTrace(inspector.getTrace());
const reopened = parseTrace(json);
const executions = getExecutions(reopened);
const graph = getSubscriptionGraph(reopened);

const selected = executions.find(execution => execution.role === 'operator');
if (selected) {
  const state = getSwitchMapState(reopened, selected.id);
  console.log(state.provenance, state.explanation);
}
```

`getExecutions(trace, eventOrdinal)`, `getSubscriptionGraph(trace, eventOrdinal)`, and `getSwitchMapState(trace, executionId, eventOrdinal)` inspect a position in history. `explainEvent(trace, event)` provides a concise event description. Event ordinals disambiguate synchronous notifications that share a timestamp. Graph relationships are read from retained connection evidence, not inferred from declared node edges or equal values.

## Recording options

| Option | Behavior |
| --- | --- |
| `name` | Human-readable recording name. |
| `nodes` / `edges` | Explicit source, operator, and sink descriptions. IDs must be unique and edge endpoints must exist. |
| `maxEvents` | Bounded ring buffer; default 50,000, maximum 250,000. Older events are evicted with a visible dropped-event count. |
| `clock` | Explicit `{ name, kind, now }` clock. Times are milliseconds relative to its initial reading. Default: `performance.now()`. |
| `captureValue` | Optional capture-time projection, followed by bounded JSON snapshotting. Failures produce an unavailable value and preserve delivery. |

The default snapshotter avoids application getters and `toJSON` methods. It bounds captured depth, entry count, total nodes, and string length. Cycles, accessors, symbol-keyed properties, and non-plain object internals are marked as truncated; undefined, nonfinite numbers, bigint, symbols, dates, and errors receive JSON-safe previews. No live application objects are retained or frozen.

JSON exchange is bounded to 32 Mi characters and 250,000 retained events. The browser file picker applies a 20 MiB input limit. Choose a smaller event capacity or a compact capture projection for large payloads.

Custom capture functions must remain observational: do not mutate the application, subscribe, emit values, or perform effects from them. Object proxies can also have observable traps; recording has a cost and is intended for development and controlled diagnostics.

If a clock throws, returns a nonfinite value, or moves backward, the recorder reuses the last usable time and increments `capture.clockErrors`. Event ordinals remain authoritative.

## Sharing is explicit

Use `inspector.share('shared')` with a declared operator node whose `operator` is `'share'` to record a shared source connection and its consumer relationships. It delegates to RxJS's real `share()` and defaults to the normal Subject connector with all three reset options enabled. The adapter accepts boolean `resetOnError`, `resetOnComplete`, and `resetOnRefCountZero` options.

Each upstream connection has its own execution identity and can outlive the consumer that first connected. A later reset/reconnection receives a new identity. Membership is recorded when consumers connect, even before a source value is emitted.

An ordinary `share()` or a generic labelled `share()` keeps its actual sharing behavior, but its internal relationships are outside the specialized adapter's coverage. Custom connectors, replay, and notifier-based reset policies need additional adapters. The recorder never inserts sharing into a pipeline unless the application explicitly uses it.

## Facts and explanations

Recorded events are observations. The `switchMap` panel is **reconstructed state**, derived from those observations.

- A retained, complete execution can be explained even if unrelated older events were evicted.
- If required history is missing, state is marked unavailable.
- Reentrant projection in RxJS 7.8.2 can create overlapping inner executions. The recorder preserves the actual behavior; the current single-active-inner explanation model marks that case unavailable.
- A trace records observed values. It cannot supply an unobserved future result for a cancelled source.
- Selecting a past event is history navigation. Deterministic application reruns and generated test oracles are separate future capabilities.

## Architecture and development

- [Architecture](docs/ARCHITECTURE.md)
- [Stable labels and the subscription graph](docs/SUBSCRIPTION_GRAPH.md)
- [Trace format and event semantics](docs/TRACE_FORMAT.md)
- [Development roadmap](docs/ROADMAP.md)
- [Project conventions](AGENTS.md)

The implementation uses functions and closures with strong TypeScript types. Its version-bound capture adapter uses RxJS's exported `Observable` and `Subscriber` primitives to preserve synchronous disposal. Actual downstream relationships are resolved through the pinned Subscriber destination chain with guarded data-property inspection. It does not patch RxJS globals, subclass RxJS, or implement its own switching/sharing policy.

Tests cover synchronous disposal, reentrancy, projector failure, inner errors, independent versus shared executions, retained-history gaps, snapshot isolation, import validation, and viewer navigation. The supported baseline is pinned to RxJS 7.8.2, including its observed edge cases.

## Inspiration

- Jason Laster's [WebReplay talk notes](https://gist.github.com/jasonLaster/1e220992c294a571dd9b59abd084ccf2) and [JSConf EU 2018 talk](https://2018.jsconf.eu/speakers/jason-laster-time-travel-debugging-a-step-by-step-guide-.html).
- [Replay DevTools](https://github.com/replayio/devtools): one execution explored through synchronized views.
- [rxjs-spy](https://github.com/cartant/rxjs-spy): explicit tags, subscription observation, and developer tooling.
- [RxJS 7.8.2 switchMap source](https://github.com/ReactiveX/rxjs/blob/7.8.2/src/internal/operators/switchMap.ts) and [marble testing](https://rxjs.dev/guide/testing/marble-testing).
- [rxjs-lift-debug](https://github.com/hansschenker/rxjs-lift-debug): the analysis of construction, execution, cancellation, and shared-connection identity that informed this increment.

This project is an independent implementation; Replay and rxjs-spy code is not bundled.

## License

MIT. See [LICENSE](LICENSE).
