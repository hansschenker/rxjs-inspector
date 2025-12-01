// src/cli/print-log.ts
import {
  NotificationEvent,
  ObservableCreateEvent,
  PrintOptions,
  defaultPrintOptions,
} from '../instrumentation/types';
import { eventsToMarbleDiagram } from '../visualization/marbleDiagram';
import { eventsToTimelineMermaid } from '../visualization/eventsToTimelineMermaid'; // if you have this

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

  switch (opts.format) {
    case 'tree':
      printOperatorChain(events);
      break;
    case 'timeline':
      printTimeline(events, opts);
      break;
    case 'flat':
    default:
      printFlat(events, opts);
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
  const indent = '  '.repeat(depth);
  console.log(`${indent}Observable ${node.id} (${node.name})`);
  for (const child of node.children) {
    printOperatorNode(child, depth + 1);
  }
}

// ---- Flat view ----

function printFlat(events: NotificationEvent[], opts: PrintOptions): void {
  const withTs = (ts: number) =>
    opts.showTimestamps ? `[${ts}] ` : '';

  for (const e of events) {
    switch (e.type) {
      case 'observable-create':
        console.log(
          `${withTs(e.timestamp)}observable-create #${e.observableId} (${e.operatorInfo?.name ?? 'Unknown'})`,
        );
        break;
      case 'subscribe':
      case 'unsubscribe':
      case 'complete':
        console.log(
          `${withTs(e.timestamp)}${e.type} obs=${e.observableId} sub=${e.subscriptionId}`,
        );
        break;
      case 'next': {
        const valueStr =
          opts.showValues && 'value' in e
            ? ` value=${JSON.stringify(e.value)}`
            : '';
        console.log(
          `${withTs(e.timestamp)}next obs=${e.observableId} sub=${e.subscriptionId}${valueStr}`,
        );
        break;
      }
      case 'error':
        console.log(
          `${withTs(e.timestamp)}error obs=${e.observableId} sub=${e.subscriptionId} error=${e.error}`,
        );
        break;
    }
  }
}

// ---- Timeline view (delegate to existing tools) ----

function printTimeline(events: NotificationEvent[], _opts: PrintOptions): void {
  // Example: print an ASCII marble per observable
  const observableIds = Array.from(
    new Set(events.map((e) => e.observableId)),
  ).sort((a, b) => a - b);

  for (const id of observableIds) {
    const line = eventsToMarbleDiagram(events, id);
    if (line) {
      console.log(`obs ${id}: ${line}`);
    }
  }

  // or, alternatively, your Mermaid generator:
  // console.log(eventsToTimelineMermaid(events));
}
