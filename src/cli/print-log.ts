// src/cli/print-log.ts
import {
  NotificationEvent,
  ObservableCreateEvent,
  PrintOptions,
  defaultPrintOptions,
} from '../instrumentation/types.js';
import { eventsToMarbleDiagram } from '../visualization/marbleDiagram.js';

interface OperatorNode {
  id: number;
  name: string;
  parent?: number;
  children: OperatorNode[];
}

export function printLog(
  events: NotificationEvent[],
  options: Partial<PrintOptions> = {},
): void {
  const opts = { ...defaultPrintOptions, ...options };
  const labelMap = buildLabelMap(events);

  switch (opts.format) {
    case 'tree':
      printOperatorChain(events);
      break;
    case 'timeline':
      printTimeline(events, opts, labelMap);
      break;
    case 'flat':
    default:
      printFlat(events, opts, labelMap);
      break;
  }
}

// ---- Operator chain (tree) ----

export function printOperatorChain(events: NotificationEvent[]): void {
  const creates = events.filter(
    (e): e is ObservableCreateEvent => e.type === 'observable-create',
  );

  const roots = buildOperatorGraph(creates);

  console.log('\nOperator Chain:\n');
  for (const root of roots) {
    printOperatorNode(root, 0);
  }
}

function buildOperatorGraph(
  creates: ObservableCreateEvent[],
): OperatorNode[] {
  const nodes = new Map<number, OperatorNode>();

  for (const evt of creates) {
    const node: OperatorNode = {
      id: evt.observableId,
      name: evt.operatorInfo?.name ?? 'Unknown',
      parent: evt.operatorInfo?.parent,
      children: [],
    };
    nodes.set(node.id, node);
  }

  for (const node of nodes.values()) {
    if (node.parent != null) {
      const parent = nodes.get(node.parent);
      if (parent) {
        parent.children.push(node);
      }
    }
  }

  return Array.from(nodes.values()).filter((n) => n.parent == null);
}

function printOperatorNode(node: OperatorNode, depth: number): void {
  // Collapse noise nodes ("Function"/"Observable") when they have a single child
  if (isNoiseNode(node) && node.children.length === 1) {
    printOperatorNode(node.children[0], depth);
    return;
  }

  const indent = '  '.repeat(depth);
  console.log(`${indent}${node.name}`);
  for (const child of node.children) {
    printOperatorNode(child, depth + 1);
  }
}

function isNoiseNode(node: OperatorNode): boolean {
  return node.name === 'Function' || node.name === 'Observable' || node.name === 'Unknown';
}

// ---- Flat view ----

function printFlat(
  events: NotificationEvent[],
  opts: PrintOptions,
  labels: Map<number, string>,
): void {
  const withTs = (ts: number) =>
    opts.showTimestamps ? `[${ts}] ` : '';

  for (const e of events) {
    const label = e.type === 'observable-create'
      ? labels.get(e.observableId) ?? e.operatorInfo?.name
      : undefined;

    switch (e.type) {
      case 'observable-create':
        console.log(
          `${withTs(e.timestamp)}observable-create ${labelOrId(e.observableId, labels)}`,
        );
        break;
      case 'subscribe':
      case 'unsubscribe':
      case 'complete':
        console.log(
          `${withTs(e.timestamp)}${e.type} ${labelOrId(e.observableId, labels)} sub=${e.subscriptionId}`,
        );
        break;
      case 'next': {
        const valueStr =
          opts.showValues && 'value' in e
            ? ` value=${JSON.stringify(e.value)}`
            : '';
        console.log(
          `${withTs(e.timestamp)}next ${labelOrId(e.observableId, labels)} sub=${e.subscriptionId}${valueStr}`,
        );
        break;
      }
      case 'error':
        console.log(
          `${withTs(e.timestamp)}error ${labelOrId(e.observableId, labels)} sub=${e.subscriptionId} error=${e.error}`,
        );
        break;
    }
  }
}

// ---- Timeline view (delegate to existing tools) ----

function printTimeline(
  events: NotificationEvent[],
  _opts: PrintOptions,
  labels: Map<number, string>,
): void {
  const creates = events.filter(
    (e): e is ObservableCreateEvent => e.type === 'observable-create',
  );

  const laneOrder = orderedLabeledObservables(creates);
  const labeledIds = new Set(laneOrder.map((n) => n.id));
  const parentIds = new Set<number>();
  for (const c of creates) {
    const p = c.operatorInfo?.parent;
    if (p != null && labeledIds.has(p)) {
      parentIds.add(p);
    }
  }

  for (const { id, name } of laneOrder) {
    const line = eventsToMarbleDiagram(events, id, 1000);
    if (line) {
      console.log(`${name}: ${line}`);
    } else if (!parentIds.has(id)) {
      // If no marble but a leaf, still print a bare completion marker if present
      const hasComplete = events.some(
        (e) => e.type === 'complete' && e.observableId === id,
      );
      console.log(`${name}: ${hasComplete ? '|' : ''}`);
    }
  }

  // or, alternatively, your Mermaid generator:
  // console.log(eventsToTimelineMermaid(events));
}

function labelOrId(id: number, labels: Map<number, string>): string {
  const label = labels.get(id);
  return label ? label : `obs=${id}`;
}

function buildLabelMap(events: NotificationEvent[]): Map<number, string> {
  const labels = new Map<number, string>();
  for (const e of events) {
    if (
      e.type === 'observable-create' &&
      e.operatorInfo?.name &&
      !isNoiseName(e.operatorInfo.name)
    ) {
      labels.set(e.observableId, e.operatorInfo.name);
    }
  }
  return labels;
}

function isNoiseName(name: string): boolean {
  return name === 'Function' || name === 'Observable' || name === 'Unknown';
}

interface LabeledNode {
  id: number;
  name: string;
  parent?: number;
  children: LabeledNode[];
}

/**
 * Return labeled observables in parent/child order, skipping noise nodes.
 */
function orderedLabeledObservables(
  creates: ObservableCreateEvent[],
): Array<{ id: number; name: string }> {
  const nodes = new Map<number, LabeledNode>();

  for (const evt of creates) {
    const name = evt.operatorInfo?.name ?? 'Unknown';
    nodes.set(evt.observableId, {
      id: evt.observableId,
      name,
      parent: evt.operatorInfo?.parent,
      children: [],
    });
  }

  // Link children
  for (const node of nodes.values()) {
    if (node.parent != null) {
      const parent = nodes.get(node.parent);
      if (parent) parent.children.push(node);
    }
  }

  // Roots = nodes whose parent is missing or null
  const roots = Array.from(nodes.values()).filter(
    (n) => n.parent == null || !nodes.has(n.parent),
  );

  const ordered: Array<{ id: number; name: string }> = [];

  const visit = (node: LabeledNode): void => {
    if (!isNoiseName(node.name)) {
      ordered.push({ id: node.id, name: node.name });
      node.children.sort((a, b) => a.id - b.id);
      for (const child of node.children) visit(child);
    } else {
      node.children.sort((a, b) => a.id - b.id);
      for (const child of node.children) visit(child);
    }
  };

  roots.sort((a, b) => a.id - b.id);
  for (const root of roots) visit(root);

  return ordered;
}
