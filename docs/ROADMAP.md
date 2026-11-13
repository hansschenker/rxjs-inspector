# Development roadmap

## Implemented in 0.2.0: stable labels and observed subscription graphs

- `inspector.operator(nodeId, actualOperator)` binds immutable explicit metadata to a real RxJS operator and applies it once at construction.
- Actual Subscriber relationships produce `upstream` links; the switchMap adapter records explicit `inner` links.
- `inspector.share` records a distinct source connection and consumer membership using the real RxJS share policy, with normal Subject and boolean reset options.
- `getSubscriptionGraph(trace, cursor)` exposes labelled execution nodes, observed relationships, independent lifetimes, and missing-history placeholders.
- A separate subscription graph complements the viewer's declared dataflow graph and lifetime timeline.
- Trace v2 preserves bounded relationship evidence; v1 import and its historical analysis remain supported.
- Meaningful parity checks cover construction-time state, silent shared membership, reconnection, early disposal, reentrant independent subscriptions, terminal resets, delayed subscription setup, and graph history/import behavior.

The [subscription graph guide](SUBSCRIPTION_GRAPH.md) describes the public API and supported evidence. The implementation remains opt-in and introduces no global RxJS patches.

## Implemented in 0.1.0

- RxJS 7.8.2 peer dependency and a version-bound recording adapter.
- Explicit graph descriptions and per-subscription execution identities.
- Boundary notifications and lifecycle capture.
- Real switchMap instrumentation with inner lifetimes and causal event links.
- Bounded historical value capture and explicit retention gaps.
- Validated JSON export/import.
- Pure execution summaries and a supported switchMap explanation model.
- Browser viewer with synchronized history, graph, lifetimes, and selected-event details.
- Local runnable examples and semantic regression tests.

## Next: more explanation models

Add map/filter/scan/take and the remaining flattening policies. Preserve the distinction between generic operator policy and named domain function. Every state model needs supported-capture requirements, an unavailable state, and tests against real RxJS 7.8.2 behavior.

For mergeMap show overlap and configured concurrency; concatMap shows pending outer inputs; exhaustMap shows accepted versus ignored inputs. Models must preserve observed reentrancy rather than assuming idealized atomic reactions.

## Then: source connections and time

Extend sharing observations to custom connectors, replay, and notifier-based reset policies. Add timer scheduling/firing/cancellation adapters and readiness views for combination operators. Time must identify its source or scheduler. The normal Subject/boolean-reset sharing path already has explicit connection identities in 0.2.0.

## Later: controlled reruns and test export

Turn supported recordings into reviewable test drafts with input fixtures, inner-source fixtures, scheduler configuration, and subscription assertions. A recorded failing run is not automatically the correct expected behavior.

Alternative operator comparisons require a new controlled run or a declared source model. A partial cancelled execution does not establish its unobserved future outputs.

Full browser/runtime replay, arbitrary private-state inspection, automatic whole-program graph extraction, cloud collaboration, and a browser extension are outside the first release.
