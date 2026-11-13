import { getExecutions } from './analysis.js';
import type { SubscriptionGraph, SubscriptionGraphEdge, SubscriptionGraphNode, Trace } from './types.js';

function selectCursor(trace: Trace, atSeq: number | undefined): number {
  if (atSeq === undefined) return trace.capture.totalEvents;
  if (!Number.isSafeInteger(atSeq) || atSeq < 0) throw new RangeError('Event cursor must be a non-negative safe integer');
  return atSeq;
}

function edgeStatus(source: SubscriptionGraphNode, destination: SubscriptionGraphNode): SubscriptionGraphEdge['status'] {
  const closed = (node: SubscriptionGraphNode) => node.status !== 'active' && node.status !== 'unknown';
  if (closed(source) || closed(destination)) return 'closed';
  if (source.status === 'unknown' || destination.status === 'unknown') return 'unknown';
  return 'active';
}

/** Explicit recorded subscription relationships at a cursor; declared edges never imply runtime links. */
export function getSubscriptionGraph(trace: Trace, atSeq?: number): SubscriptionGraph {
  const selectedSeq = selectCursor(trace, atSeq);
  const definitions = new Map(trace.nodes.map(node => [node.id, node]));
  const nodes = new Map<string, SubscriptionGraphNode>();
  for (const execution of getExecutions(trace, selectedSeq)) {
    const definition = definitions.get(execution.nodeId);
    nodes.set(execution.id, Object.freeze({
      ...execution,
      label: definition?.label ?? execution.nodeId,
      ...(definition?.operator === undefined ? {} : { operator: definition.operator }),
      ...(definition?.domain === undefined ? {} : { domain: definition.domain }),
      provenance: execution.startSeq === undefined ? 'missing-history' : 'observed',
    }));
  }

  function getEndpoint(executionId: string): SubscriptionGraphNode {
    const known = nodes.get(executionId);
    if (known) return known;
    const missing: SubscriptionGraphNode = Object.freeze({
      id: executionId,
      label: executionId,
      status: 'unknown',
      nextCount: 0,
      provenance: 'missing-history',
    });
    nodes.set(executionId, missing);
    return missing;
  }

  const edges: SubscriptionGraphEdge[] = [];
  if (trace.schemaVersion === 2) {
    for (const event of trace.events) {
      if (event.seq > selectedSeq) break;
      if (event.kind !== 'link' || event.link === undefined) continue;
      const source = getEndpoint(event.link.sourceExecutionId);
      const destination = getEndpoint(event.link.destinationExecutionId);
      edges.push(Object.freeze({
        ...event.link,
        id: `link:${event.seq}`,
        observedAtSeq: event.seq,
        status: edgeStatus(source, destination),
      }));
    }
  }

  const evidence: SubscriptionGraph['evidence'] = trace.schemaVersion === 1
    ? 'legacy'
    : trace.capture.droppedEvents > 0 || [...nodes.values()].some(node => node.provenance === 'missing-history')
      ? 'partial'
      : 'observed';

  return Object.freeze({
    nodes: Object.freeze([...nodes.values()]),
    edges: Object.freeze(edges),
    atSeq: selectedSeq,
    evidence,
  });
}
