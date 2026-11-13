# Architecture

## Definition and execution

Nodes and declared edges describe the dataflow. A subscription activates an execution. A node can have several executions with separate lifetimes and state. Dynamic inner executions name their parent operator execution. Explicit `link` events record relationships between particular executions; they are separate from declared node edges and notification causality.

The recorder observes existing subscriptions. The viewer and analysis functions consume snapshots of recorded data and never subscribe to the application.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/recorder.ts` | Opt-in boundary capture, stable operator bindings, version-bound switchMap/share instrumentation, observed subscriber relationships, identity, clock, causal delivery context, bounded event retention. |
| `src/capture.ts` | Detached, bounded JSON-safe value snapshots. |
| `src/types.ts` | Public portable trace types. |
| `src/trace.ts` | Validation, import, and export. |
| `src/analysis.ts` | Pure historical execution summaries and supported operator explanations. |
| `src/subscription-graph.ts` | Pure historical graph of observed execution relationships, stable labels, and explicit missing-history placeholders. |
| `src/viewer.ts` | Framework-independent browser renderer and local import/export. |

## Capture mechanics

Each observed subscription receives a fresh execution ID before source subscription. A forwarding RxJS Subscriber is linked to its destination before subscribing upstream. Consequently downstream disposal, including synchronous `take(1)`, can close the upstream observer during delivery.

The switchMap adapter calls the real RxJS 7.8.2 operator. It observes the outer input port, wraps the ObservableInput produced by the named projector, and records the output port. The domain projection remains at RxJS's own projection point. Inner subscription IDs, parent identities, and ordered events are captured without replacing the operator's policy.

The generic `operator(nodeId, actualOperator)` wrapper applies the real operator once at construction and records each subscription's output boundary. It binds to frozen explicit metadata, without inspecting function names or invoking domain functions again. Its boundary role does not claim the richer evidence of a semantic adapter.

Recorder-created Subscribers are weakly associated with execution identities. A guarded walk through data descriptors on the pinned RxJS Subscriber destination chain finds actual observed downstream relationships. This preserves supported scheduled connections and avoids falsely attaching independent reentrant subscriptions to the current event's execution. Unsupported/custom paths remain gaps; there is no global prototype patch.

The adapter deliberately targets 7.8.2. The exported Subscriber constructor is version-sensitive; parity tests are a required gate for changes. Direct RxJS APIs may use classes internally, while this library's own implementation uses functions and closures.

## Observation points

Notification events are recorded immediately before forwarding the notification. Unsubscription is recorded at observed disposal, before all upstream cleanup necessarily finishes. Selecting an event therefore describes an observation boundary, not an arbitrary paused JavaScript instruction.

Synchronous delivery establishes a scoped cause event. Nested observed deliveries inherit that cause; asynchronous deliveries begin without a fabricated causal predecessor. Declared graph edges describe application structure; runtime `link` events describe observed connections; cause links describe recorded delivery relationships. These relationships are not interchangeable.

## Explanation model

The initial switchMap model reconstructs outer completion, active inner identity, and output status from retained events. It never reads private closure variables or reruns the projector. Missing initial history or overlapping active inner executions makes the supported model unavailable.

This is intentionally stricter than pretending all recordings fit a simplified model. Real reentrant behavior remains visible in the raw trace.

## Sharing

Sharing is application-controlled. The dedicated `share` adapter wraps RxJS's actual share implementation once at construction. A functional connector delegates notifications to a normal RxJS Subject and records consumer membership. Each actual source connection has a distinct `connection` execution; it is not parented to its first consumer. Active membership is cleaned up when consumers close, and each reconnect receives a fresh connection identity.

The adapter supports boolean resetOnError/resetOnComplete/resetOnRefCountZero options. It does not replace RxJS reference counting or reset logic. Custom connectors, replay, and notifier resets remain outside this adapter. Ordinary share used through the generic operator wrapper retains its behavior but does not supply the specialized connection evidence.

## Resource limits

The recorder uses an O(1) ring-buffer write per event plus value inspection and bounded snapshot output. Enumerating a very large object's property names can still have significant cost. A trace snapshot allocates an ordered array of retained event references; recorded values are detached and frozen. Dropped prefixes are explicitly counted. The viewer may limit rendered rows for readability while preserving the underlying trace.

Connection evidence is stored as link events in the same ring. There is no separate unbounded relationship history. Historical graph analysis includes only retained links at/before the cursor and uses unknown placeholders when referenced execution history is missing.

Snapshotting and custom capture hooks have runtime cost. Development diagnostics should choose maxEvents and captureValue deliberately.

## Package boundaries

The root entry point has no DOM dependency. The optional viewer entry point mounts in a supplied element. The demo is local development infrastructure and is excluded from the package. No network service is needed for recording, viewing, or JSON exchange.

New recordings use schema v2. The importer preserves supported v1 recordings and their original format version; the runtime graph explicitly reports legacy evidence for them. See [Stable labels and the subscription graph](SUBSCRIPTION_GRAPH.md).
