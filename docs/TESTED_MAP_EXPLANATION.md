# RxJS Inspector tested map explanation

**Development brief · 13 November 2026 · Status: proposed implementation**

Build one complete operator explanation: observe an actual `map` execution, explain its recorded input and output at a selected event, display that explanation in the viewer, and verify that instrumentation preserves RxJS behavior. The deliverable follows **Intuition → Specification → Verification**.

This brief defines the next development target. The proposed `inspector.map` adapter and map explanation query are not implemented in the baseline below. Checklist items remain open until supported by implementation and verification evidence.

**Author:** GPT-6 Astra, in collaboration with hansschenker.

## Baseline and intended outcome

| Item | Baseline |
| --- | --- |
| Repository | [hansschenker/rxjs-inspector](https://github.com/hansschenker/rxjs-inspector) |
| Reference commit | [f6f6b7a](https://github.com/hansschenker/rxjs-inspector/commit/f6f6b7a0802a271dae3c306491232451bb355c23) |
| Package version | 0.2.0 |
| RxJS target | 7.8.2 |
| Existing foundation | Stable definitions, per-subscription execution IDs, input/output event ports, synchronous cause links, bounded snapshots, and an explicit subscription graph |
| Existing verification | The reference commit records 93 passing tests, library and demo builds, and package checks; visual browser layout verification remains open |
| Milestone outcome | A specialized map adapter, a pure historical explanation query, a viewer example, regression tests, and documentation |

The current generic `inspector.operator(nodeId, actualOperator)` records an output boundary with `role: 'boundary'`. A label such as `operator: 'map'` does not establish that the richer map observations exist. The new analysis must require the specialized capture contract. See the [baseline recorder](https://github.com/hansschenker/rxjs-inspector/blob/f6f6b7a0802a271dae3c306491232451bb355c23/src/recorder.ts) and [roadmap](https://github.com/hansschenker/rxjs-inspector/blob/f6f6b7a0802a271dae3c306491232451bb355c23/docs/ROADMAP.md).

## Intuition

A map stage receives values over time. For each delivered input, RxJS invokes the named projection with the value and its index. When normal processing produces an output while the destination remains open, that result flows downstream. The domain function defines the transformation; RxJS controls delivery and lifetime. Construction describes this dataflow. Subscription activates an execution.

The inspector should make an ordinary recorded step readable:

> Double each value received 2. Its output boundary then emitted 4 while processing that input. The stage uses the named projection doubleValue.

That wording describes observations and their recorded relationship. Input/output probes do not record the exact instant a projection returns. A projection can close the subscription and then return, leaving an input and a cancellation observation without an output. Missing output must therefore remain an observation, not an invented result.

The adapter must preserve existing timing, scheduling, cancellation, and sharing. It introduces no timer or scheduling boundary and no additional application subscription. Two cold subscriptions have separate executions and projection indices. Sharing remains explicit where the application places it. The operator behavior is grounded in the [RxJS 7.8.2 map implementation](https://github.com/ReactiveX/rxjs/blob/7.8.2/src/internal/operators/map.ts).

## Scope

This increment includes a specialized `map` adapter using the real RxJS operator, input/output/lifecycle capture within one operator execution, historical explanations, a viewer presentation, a runnable example, portable trace coverage, and parity tests against plain RxJS 7.8.2.

Use the current trace v2 input/output events and `causeEventSeq` where they provide sufficient evidence. Do not introduce speculative fields for future operators. If implementation reveals a necessary schema change, document the concrete evidence gap and compatibility decision before extending the format.

This increment excludes evaluating saved projections, stepping through arbitrary JavaScript instructions, recording every private operator variable, replaying application effects, automatic whole-program instrumentation, and implementations of `filter`, `scan`, or `take`. Those operators follow after this workflow is verified.

## Specification

### Runtime behavior

| Situation | Required behavior and observation |
| --- | --- |
| Pipeline construction | Bind explicit metadata and compose the real map operator; do not subscribe or invoke the projection. |
| New subscription | Create a fresh operator execution and preserve RxJS's per-subscription projection index. |
| Input value | Observe the input before forwarding it into the real map operator. Preserve the original value and normal projection invocation. |
| Output value | Observe the actual output before forwarding it downstream. Retain the causal relationship to the input when available. |
| Source error | Observe the input error and the resulting output error when delivered. Preserve the application's error object identity. |
| Error during value processing | Preserve RxJS error delivery and teardown. Describe only the error origin supported by recorded evidence. |
| Source completion | Observe the input completion and resulting output completion when delivered. |
| Consumer closes | Dispose immediately through the existing subscription chain, including during synchronous production or projection. |
| Reentrant source activity | Preserve actual invocation and delivery order. Nested processing may finish before an earlier projection returns. |

The actual projection must be invoked only by the real RxJS operator at its normal invocation point. Analysis and display never invoke it. Use functions, closures, type aliases for new model types, and named responsibilities. Follow the repository's [project conventions](https://github.com/hansschenker/rxjs-inspector/blob/f6f6b7a0802a271dae3c306491232451bb355c23/AGENTS.md).

### Evidence rules

1. **Identity:** associate events with an execution ID and its stable definition. Equal labels or values do not join executions.
2. **Causality:** associate a map output with a supported input event through recorded cause evidence within that execution. Do not pair adjacent events or match values. A subscription graph edge describes a connection, not a per-value transformation.
3. **Cursor:** read only events at or before the selected ordinal. At an input event, a later output is still unknown even if present elsewhere in the saved trace.
4. **Index:** derive a zero-based input/projection index only when the specialized capture contract and complete required input prefix justify it. Mark it as reconstructed. After relevant history is lost, report an unknown index rather than renumbering retained inputs from zero. Eviction confined to other executions does not by itself invalidate a fully retained map execution.
5. **Payload:** display the captured snapshot and its captured, truncated, or unavailable status. A preview is not a live application object and must never be passed back to the projection.
6. **Cancellation:** input followed by cancellation without output establishes no delivered result. It does not establish whether the projection returned, threw after closure, or was still executing at the observation point.
7. **Error attribution:** a retained input error can support an upstream-error explanation. An output error caused by an input value supports “error while processing this input.” That cause alone does not prove the projection threw.
8. **Unavailable evidence:** generic boundary traces, missing starts or causes, and unsupported execution shapes retain their recorded events but receive an explicit model limitation.

The error rule matters because RxJS's operator subscriber catches exceptions around both projection processing and downstream delivery. A raw Subscriber can throw during delivery after an output has already been observed. Exact throw-origin claims need stronger evidence than an input cause link. See [OperatorSubscriber in RxJS 7.8.2](https://github.com/ReactiveX/rxjs/blob/7.8.2/src/internal/operators/OperatorSubscriber.ts).

## Historical explanation contract

The proposed query selects one map execution at an event cursor. It returns the execution's lifecycle, the selected observation, any supported input/output association, the named projection, and explicit evidence status. Its output is detached and immutable, like the existing analysis results.

Keep three concerns separate:

| Concern | What to expose |
| --- | --- |
| Recorded facts | Event ordinals, timestamps, execution identity, port, notification kind, cause references, and captured values |
| Reconstructed explanation | A supported association between an input and an observed output or error; an index only when justified |
| Missing evidence | The precise unavailable field or unsupported interpretation, while preserving usable recorded facts |

Do not store a single mutable “current input” and assume reactions are atomic. Reentrant processing can leave several inputs in progress. The model must resolve each supported relationship from its own evidence or report it as unavailable.

### Cursor example

The following is an illustrative expected sequence for an adapter-only synchronous run over inputs 2 and 3 with `doubleValue`. It is not a newly recorded trace. Additional source or sink probes would add their own events and change the global ordinals.

| Ordinal | Observation | Cause | Explanation available at this cursor |
| --- | --- | --- | --- |
| 1 | Map output subscription starts | — | This execution is active. |
| 2 | Input next 2 | — | Input 2 is observed; no corresponding output is yet recorded. |
| 3 | Output next 4 | 2 | Output 4 was observed while processing input event 2. |
| 4 | Input next 3 | — | Input 3 is observed; no corresponding output is yet recorded. |
| 5 | Output next 6 | 4 | Output 6 was observed while processing input event 4. |
| 6 | Input complete | — | Source completion is observed; output completion has not yet been observed. |
| 7 | Output complete | 6 | This execution's output has completed. |

Equal timestamps are allowed. Global event ordinals order observations within a moment. The viewer steps through recorded history; it does not pause or rerun the application.

## Verification

Use plain RxJS 7.8.2 as the runtime oracle. Execute each parity fixture once with plain `map` and once with the proposed adapter, using equivalent fresh sources and projections. Compare application-visible outcomes and a separate lifecycle log. Additional inspector events naturally differ from the plain run.

Compare values, projection arguments and indices, notification order, error identity, source subscription count, and teardown count/order. Error identity is checked in the live fixture; serialized trace snapshots are detached descriptions.

| Case | Scenario | Required evidence |
| --- | --- | --- |
| MAP 01 | Construct the pipeline and query an empty recording | Zero source subscriptions and zero projection calls. |
| MAP 02 | Ordinary synchronous values and completion | Same values, indices, order, and completion as plain map; valid input/output cause links. |
| MAP 03 | Two subscriptions to the same cold pipeline | Same stable definitions, distinct execution IDs, independently restarted indices, and one source subscription per consumer. |
| MAP 04 | Empty source and controlled scheduled source | Empty completion makes no projection call; scheduled delivery preserves the source's notification order and scheduler timing. |
| MAP 05 | Projection throws a known error | Same live error identity and teardown as plain map; explanation does not claim an unrecorded exact throw origin. |
| MAP 06 | Source errors before or after values, including a reentrant source error during projection | Input-error evidence is distinct from value-processing evidence; terminal behavior matches RxJS. |
| MAP 07 | Synchronous producer followed by inspected map and take(1) | Only necessary production/projection occurs; teardown occurs once and cancellation is immediate. |
| MAP 08 | Already closed destination and downstream take(0) | No source subscription or projection call. Do not manufacture an execution that was never activated. |
| MAP 09 | Projector reenters the source | Nested input/output order matches plain RxJS; links use each event's cause rather than FIFO or adjacency. |
| MAP 10 | Downstream delivery reenters the source | Preserve actual projection, notification, and disposal order without mixing separate inputs. |
| MAP 11 | Projector closes the subscription, then returns or throws | Preserve RxJS suppression after closure; no invented output, return event, or error notification. |
| MAP 12 | A deliberately supplied raw Subscriber throws during delivery | Preserve actual RxJS behavior; an input cause must not be displayed as proof that the projection threw. |
| MAP 13 | Cursor before output, evicted prefix, missing cause, and generic labelled map | No future evidence; unknown index when required history is absent; unsupported models remain explicit. |
| MAP 14 | Export/import, repeated queries, and viewer navigation | Preserve supported explanations, safe text, graph identities, and payload status; trigger zero application work during analysis or navigation. |

Cover captured, truncated, and unavailable values in MAP 13–14. Include a pipeline that already shares its source in the integration checks and confirm that adding map observations does not change source subscription count. Preserve the existing v1/v2 compatibility tests and specialized switchMap/share behavior. The cancellation fixtures follow the pinned [take implementation](https://github.com/ReactiveX/rxjs/blob/7.8.2/src/internal/operators/take.ts) and [Subscriber lifecycle](https://github.com/ReactiveX/rxjs/blob/7.8.2/src/internal/Subscriber.ts).

### Representative acceptance scenarios

**Given** an active map execution using `doubleValue`, **when** input 2 is delivered normally, **then** the live consumer receives 4 and the trace can associate its observed output with that input.

**Given** that the saved recording contains both input and output, **when** the cursor selects only the input event, **then** the explanation reports the input without revealing the later output.

**Given** that processing input A synchronously produces a nested input B, **when** B's output arrives first, **then** the explanation associates it with B and retains the real event order.

**Given** a projector that closes its destination before returning, **when** its function returns a value, **then** no output is fabricated in the recording or explanation.

## Implementation sequence

| Step | Deliverable | Completion evidence |
| --- | --- | --- |
| 1 | Finalize the map capture and explanation contract | Supported facts, reconstructed fields, cursor behavior, and unavailable cases are explicit. |
| 2 | Add the real-operator adapter in `src/recorder.ts` | Focused runtime parity cases pass, including synchronous disposal and reentrancy. |
| 3 | Add a pure map explanation module and public exports | Historical analysis respects evidence and cursor limits; generic boundary capture does not qualify. |
| 4 | Add viewer presentation and a named-function demo | Selection displays input, observed output/error, lifecycle, and evidence status using safe text. |
| 5 | Integrate portability and package checks | Public types compile in a consumer; the root import remains usable without a DOM; v1/v2 behavior remains supported. |
| 6 | Verify, document, and commit the increment | Required gates pass, browser acceptance is checked, documentation matches the final API, and the repository records the result. |

Likely files include `src/recorder.ts`, `src/types.ts`, `src/index.ts`, a focused map analysis module, `src/viewer.ts`, focused recording/analysis tests, `test/viewer.test.ts`, `test/package.test.ts`, `examples/demo.ts`, and the relevant documentation. Extend existing helpers only where responsibilities genuinely match. Name each new responsibility clearly and compose small functions.

## Definition of done

- [ ] The specialized map adapter uses the real RxJS 7.8.2 operator and preserves normal construction behavior.
- [ ] Stable metadata, execution identity, and existing subscription relationships remain correct.
- [ ] The application-visible parity matrix passes, including closure during projection and reentrant delivery.
- [ ] Historical explanations use only supported retained evidence at or before the cursor.
- [ ] Projection indices are justified and labelled as reconstructed, or explicitly unknown.
- [ ] Error wording distinguishes recorded upstream errors from errors during input processing without overstating throw origin.
- [ ] Queries, import/export, and viewer navigation never evaluate the projection or subscribe to application sources.
- [ ] The viewer and demo show the complete feature with safe text, keyboard navigation, and readable wide/narrow layouts.
- [ ] The full `npm run check` gate, demo build, and package consumer checks pass; the test count is updated from actual results.
- [ ] Public API documentation and evidence limits match the implementation; README contributor credit and the commit co-author trailer are preserved.

Any blocked browser check must remain an explicit open verification item. Do not mark this entire checklist complete solely because automated tests pass. Publishing an npm release is a separate action requiring an explicit request under the repository conventions.

## Proposed API and example

The following names are an implementation proposal, not available APIs in version 0.2.0:

```ts
inspector.map<T, R>(
  nodeId: string,
  project: (value: T, index: number) => R,
): OperatorFunction<T, R>;

getMapExplanation(
  trace: Trace,
  executionId: string,
  atSeq?: number,
): MapExplanation;
```

The first API accepts an explicit operator definition with `operator: 'map'`. The named projection supplies application logic. The second API reads a snapshot only. Finalize the `MapExplanation` type around the evidence contract above; avoid a universal private-state interface or a single “current input” field that cannot represent reentrancy.

Illustrative usage after implementation:

```ts
import { of } from 'rxjs';
import {
  createInspector,
  getExecutions,
  getMapExplanation,
} from '@hansschenker/rxjs-inspector';

function doubleValue(value: number): number {
  return value * 2;
}

const inspector = createInspector({
  nodes: [
    { id: 'source', label: 'numbers$', kind: 'source' },
    {
      id: 'double',
      label: 'Double each value',
      kind: 'operator',
      operator: 'map',
      domain: 'doubleValue',
    },
  ],
  edges: [{ from: 'source', to: 'double' }],
});

const doubled$ = of(2, 3).pipe(
  inspector.inspect<number>('source'),
  inspector.map('double', doubleValue),
);

doubled$.subscribe(); // Observed outputs: 4, 6.

const trace = inspector.getTrace();
const execution = getExecutions(trace).find(
  entry => entry.nodeId === 'double' && entry.role === 'operator',
);
const input = trace.events.find(
  event => event.executionId === execution?.id
    && event.port === 'input'
    && event.kind === 'next',
);

if (execution && input) {
  const explanation = getMapExplanation(trace, execution.id, input.seq);
  console.log(explanation); // At this cursor, the later output is not yet visible.
}
```

## Following increments

Once this map workflow is verified, extend it to `filter` with actual predicate-decision evidence, `scan` with initialization and accumulator transitions, and `take` with configured limits and termination reasons. The domain functions change; the recording, evidence, historical analysis, and verification structure should remain reusable.

Further flattening policies, timer observations, richer sharing, and controlled test export remain in the [development roadmap](https://github.com/hansschenker/rxjs-inspector/blob/main/docs/ROADMAP.md).
