/** Portable, JSON-only values. Application objects are never retained in a trace. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface CapturedValue {
  readonly status: 'captured' | 'truncated' | 'unavailable';
  readonly data?: JsonValue;
  readonly reason?: string;
}

export interface TraceNode {
  readonly id: string;
  readonly label: string;
  readonly kind: 'source' | 'operator' | 'sink';
  readonly operator?: string;
  readonly domain?: string;
}

export interface TraceEdge {
  readonly from: string;
  readonly to: string;
}

export type TraceEventKind = 'subscribe' | 'next' | 'error' | 'complete' | 'unsubscribe';
export type ExecutionRole = 'boundary' | 'operator' | 'inner';

export interface TraceEvent {
  readonly seq: number;
  /** Milliseconds relative to the recorder's clock origin. Ordering comes from seq. */
  readonly time: number;
  readonly nodeId: string;
  readonly executionId: string;
  readonly kind: TraceEventKind;
  readonly port: 'input' | 'output';
  readonly role: ExecutionRole;
  readonly parentExecutionId?: string;
  readonly causeEventSeq?: number;
  readonly innerIndex?: number;
  readonly value?: CapturedValue;
}

export interface Trace {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly rxjsBaseline: '7.8.2';
  readonly clock: { readonly name: string; readonly kind: 'monotonic' | 'virtual' | 'custom'; readonly unit: 'ms' };
  readonly nodes: readonly TraceNode[];
  readonly edges: readonly TraceEdge[];
  readonly events: readonly TraceEvent[];
  readonly capture: {
    readonly maxEvents: number;
    readonly droppedEvents: number;
    readonly totalEvents: number;
    readonly complete: boolean;
    /** Invalid or regressing clock readings were replaced by the last usable time. */
    readonly clockErrors?: number;
  };
}

export interface ExecutionSummary {
  readonly id: string;
  readonly nodeId: string;
  readonly role: ExecutionRole;
  readonly parentExecutionId?: string;
  readonly startSeq?: number;
  readonly startTime?: number;
  readonly endSeq?: number;
  readonly endTime?: number;
  readonly status: 'active' | 'completed' | 'errored' | 'unsubscribed' | 'unknown';
  readonly nextCount: number;
}

export interface SwitchMapState {
  readonly executionId: string;
  readonly provenance: 'reconstructed' | 'unavailable';
  readonly outerCompleted: boolean;
  readonly activeInnerId: string | null;
  readonly outputStatus: ExecutionSummary['status'];
  readonly explanation: string;
}
