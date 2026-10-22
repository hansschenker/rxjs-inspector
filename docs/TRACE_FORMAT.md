# Trace format v1

The public TypeScript contract is `src/types.ts`. JSON traces use `schemaVersion: 1` and declare `rxjsBaseline: "7.8.2"`. This is the supported adapter baseline, not runtime package-version detection.

## Top-level fields

| Field | Meaning |
| --- | --- |
| `name` | Recording label. |
| `clock` | Clock name, kind, and millisecond unit. |
| `nodes` | Explicit graph definitions with optional operator and domain-function labels. |
| `edges` | Declared graph edges between known node IDs. |
| `events` | Retained events in increasing global ordinal order. |
| `capture` | Capacity, total count, dropped-prefix count, history completeness, optional clock-error count. |

`capture.complete` means no events have been evicted. It does not mean application execution has completed.

## Events

Each event contains `seq`, `time`, `nodeId`, `executionId`, `role`, `port`, and `kind`. Optional fields include `parentExecutionId`, `innerIndex`, `causeEventSeq`, and a captured `value`.

- `seq` starts at 1 and orders observations even when their timestamps match.
- `time` is relative to the recorder's initial clock reading.
- `role` is boundary, operator, or inner.
- `port` is input or output. An input complete notification does not terminate the operator output.
- `kind` is subscribe, next, error, complete, or unsubscribe.
- `parentExecutionId` associates an inner with its operator execution.
- `causeEventSeq` refers to a known earlier event observed in the active synchronous delivery context. The referenced event may have been evicted.

Only output complete/error or early unsubscribe closes the corresponding observed execution. A normal complete/error is not followed by a synthetic unsubscribe event. Internal cleanup is not represented as an additional terminal notification.

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

The importer validates supported versions, object shapes, limits, definitions, ordinal order, retention metadata, and execution consistency. It rejects malformed traces. Future schema versions require an explicit migration or a new importer; the current parser does not guess their meaning.

JSON import and export accept at most 32 Mi characters and 250,000 retained events, with a maximum payload nesting depth of 128. The browser file picker limits input files to 20 MiB. The recorder's own value-capture limits are smaller and documented in src/capture.ts.
