# Architecture

## Definition and execution

Nodes and edges describe the dataflow. A subscription activates an execution. A node can have several executions with separate lifetimes and state. Dynamic inner executions name their parent operator execution.

The recorder observes existing subscriptions. The viewer and analysis functions consume snapshots of recorded data and never subscribe to the application.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/recorder.ts` | Opt-in boundary capture, version-bound switchMap instrumentation, identity, clock, causal delivery context, bounded event retention. |
| `src/capture.ts` | Detached, bounded JSON-safe value snapshots. |
| `src/types.ts` | Public portable trace types. |
| `src/trace.ts` | Validation, import, and export. |
| `src/analysis.ts` | Pure historical execution summaries and supported operator explanations. |
| `src/viewer.ts` | Framework-independent browser renderer and local import/export. |

## Capture mechanics

Each observed subscription receives a fresh execution ID before source subscription. A forwarding RxJS Subscriber is linked to its destination before subscribing upstream. Consequently downstream disposal, including synchronous `take(1)`, can close the upstream observer during delivery.

The switchMap adapter calls the real RxJS 7.8.2 operator. It observes the outer input port, wraps the ObservableInput produced by the named projector, and records the output port. The domain projection remains at RxJS's own projection point. Inner subscription IDs, parent identities, and ordered events are captured without replacing the operator's policy.

The adapter deliberately targets 7.8.2. The exported Subscriber constructor is version-sensitive; parity tests are a required gate for changes. Direct RxJS APIs may use classes internally, while this library's own implementation uses functions and closures.

## Observation points

Notification events are recorded immediately before forwarding the notification. Unsubscription is recorded at observed disposal, before all upstream cleanup necessarily finishes. Selecting an event therefore describes an observation boundary, not an arbitrary paused JavaScript instruction.

Synchronous delivery establishes a scoped cause event. Nested observed deliveries inherit that cause; asynchronous deliveries begin without a fabricated causal predecessor. Graph edges describe declared structure, while cause links describe recorded delivery relationships.

## Explanation model

The initial switchMap model reconstructs outer completion, active inner identity, and output status from retained events. It never reads private closure variables or reruns the projector. Missing initial history or overlapping active inner executions makes the supported model unavailable.

This is intentionally stricter than pretending all recordings fit a simplified model. Real reentrant behavior remains visible in the raw trace.

## Sharing

Sharing is application-controlled. A source probe before share observes the upstream execution. Consumer probes after share observe their independent subscriptions. The first version exposes these facts using execution identities and declared graph edges; full source-connection and reset-policy models remain future work.

## Resource limits

The recorder uses an O(1) ring-buffer write per event plus value inspection and bounded snapshot output. Enumerating a very large object's property names can still have significant cost. A trace snapshot allocates an ordered array of retained event references; recorded values are detached and frozen. Dropped prefixes are explicitly counted. The viewer may limit rendered rows for readability while preserving the underlying trace.

Snapshotting and custom capture hooks have runtime cost. Development diagnostics should choose maxEvents and captureValue deliberately.

## Package boundaries

The root entry point has no DOM dependency. The optional viewer entry point mounts in a supplied element. The demo is local development infrastructure and is excluded from the package. No network service is needed for recording, viewing, or JSON exchange.
