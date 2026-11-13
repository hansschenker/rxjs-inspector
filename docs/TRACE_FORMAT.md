# Trace format v2 and legacy v1

The public TypeScript contract is `src/types.ts`. New JSON traces use `schemaVersion: 2` and declare `rxjsBaseline: "7.8.2"`. This is the supported adapter baseline, not runtime package-version detection. The importer also accepts schema v1 and preserves its version and serialized shape.

## Top-level fields

| Field | Meaning |
| --- | --- |
| `name` | Recording label. |
| `clock` | Clock name, kind, and millisecond unit. |
| `nodes` | Explicit graph definitions with optional operator and domain-function labels. |
| `edges` | Declared graph edges between known node IDs. |
| `events` | Retained notifications, subscription events, and v2 runtime relationship events in increasing global ordinal order. |
| `capture` | Capacity, total count, dropped-prefix count, history completeness, optional clock-error count. |

`capture.complete` means no events have been evicted. It does not mean application execution has completed.

## Events

Each event contains `seq`, `time`, `nodeId`, `executionId`, `role`, `port`, and `kind`. Optional fields include `parentExecutionId`, `innerIndex`, `causeEventSeq`, and a captured `value`. V2 adds a `link` payload exclusively for relationship events.

- `seq` starts at 1 and orders observations even when their timestamps match.
- `time` is relative to the recorder's initial clock reading.
- `role` is boundary, operator, inner, or (v2) connection. A connection is a separately observed shared upstream execution, not a consumer's owned inner.
- `port` is input or output. An input complete notification does not terminate the operator output.
- `kind` is subscribe, next, error, complete, unsubscribe, or (v2) link.
- `parentExecutionId` associates an inner with its operator execution. V2 reserves this field for the inner role; sharing does not overload it.
- `causeEventSeq` refers to a known earlier event observed in the active synchronous delivery context. The referenced event may have been evicted.

Only output complete/error or early unsubscribe closes the corresponding observed execution. A normal complete/error is not followed by a synthetic unsubscribe event. Internal cleanup is not represented as an additional terminal notification.

## V2 subscription links

A link event has `port: "output"`, carries no captured value, and contains:

```json
{
  "kind": "upstream",
  "sourceExecutionId": "e3",
  "destinationExecutionId": "e2"
}
```

This object is the event's `link` field, not a standalone event. The enclosing event's `executionId` must equal `sourceExecutionId`. Both endpoint subscriptions are established before the relationship is recorded.

| Link kind | Meaning |
| --- | --- |
| `upstream` | An observed Subscriber destination relationship from upstream execution to downstream execution |
| `inner` | An explicitly observed inner execution connected to its operator parent |
| `shared` | A separately observed source connection serving a sharing consumer |

An inner link originates at an inner-role execution and names its `parentExecutionId` as destination. A shared link originates at a connection-role execution. Self-links, duplicate kind/source/destination tuples, unknown endpoints in complete history, source-identity mismatches, and links after an endpoint has already terminated are invalid.

When a prefix was evicted, references to missing older executions are legitimate. A retained later subscription start cannot retroactively justify a reference to that execution at an earlier cursor. Unknown endpoint metadata is represented honestly by the graph query.

Link events consume the same ring-buffer capacity as all other events. Sequence order and retention accounting therefore include them. Their presence does not count as an emitted value, complete an execution, or imply exclusive lifetime ownership.

`getSubscriptionGraph(trace, atSeq)` uses retained links visible at the selected cursor. It never fills gaps from declared `edges`, cause links, payload equality, or future events. Relationship status is derived from each endpoint's recorded lifetime.

## Capture values

Values have status captured, truncated, or unavailable. Captured data is JSON-only. Preview tags such as `$type` describe unsupported JavaScript values; they are display metadata, not executable deserialization instructions. Import never recreates functions, prototypes, or application objects.

The default snapshotter uses own data descriptors and avoids getters/toJSON. A payload containing property names such as `__proto__` remains ordinary inert data. Preview markers are not a lossless application serialization protocol.

## Retention

The retained events form a contiguous suffix:

`totalEvents = droppedEvents + events.length`

The first retained ordinal is `droppedEvents + 1`; the final ordinal is `totalEvents`. Missing execution starts and causal references can therefore be legitimate after eviction. Analysis reports unknown or unavailable state when necessary history is missing.

## Temporal scope

The format captures a single JavaScript runtime. Clock readings can coincide; event order is authoritative. Invalid or backward readings use the last usable time and increment `capture.clockErrors`.

Events identify observation boundaries. They are not CPU-level snapshots, an entire browser event log, a universal sequence of scheduler ticks, or a guarantee about external effect completion.

## Compatibility

The importer validates supported versions, object shapes, limits, definitions, ordinal order, retention metadata, execution consistency, and v2 relationship consistency. It rejects malformed traces. Future schema versions require an explicit migration or a new importer; the current parser does not guess their meaning.

Version 1 remains readable and round-trips without an implicit upgrade. V2-only fields, kinds, and roles are rejected inside a v1 document. The old v1-only parser cannot read v2; consumers must update the library to use new recordings. V1 execution timelines and supported switchMap explanations still work, while the subscription graph reports `evidence: "legacy"` and supplies no invented runtime edges.

The graph evidence categories are `observed` (retained instrumented relationships), `partial` (evicted prefix or missing endpoint history), and `legacy` (no v2 relationship observations). None claims automatic whole-program coverage.

JSON import and export accept at most 32 Mi characters and 250,000 retained events, with a maximum payload nesting depth of 128. The browser file picker limits input files to 20 MiB. The recorder's own value-capture limits are smaller and documented in src/capture.ts.
