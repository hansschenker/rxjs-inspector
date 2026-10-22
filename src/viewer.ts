import { explainEvent, getExecutions, getSwitchMapState } from './analysis.js';
import { parseTrace, serializeTrace } from './trace.js';
import type { ExecutionSummary, Trace, TraceEvent, TraceNode } from './types.js';

export interface InspectorView {
  /** Replace the recording and return the cursor to its first retained event. */
  setTrace(trace: Trace): void;
  /** Remove this view and release its listeners. Does not affect application subscriptions. */
  destroy(): void;
}

const css = `
.rx-inspector{--rx-bg:light-dark(#fff,#171c24);--rx-surface:light-dark(#f5f7fa,#222a36);--rx-text:light-dark(#202d3f,#ecf1f7);--rx-muted:light-dark(#53647b,#afbdd0);--rx-line:light-dark(#d6dfeb,#3c4a5f);--rx-track:light-dark(#e3eaf3,#344155);--rx-active:light-dark(#3565a4,#8cb4ed);--rx-focus:light-dark(#eaf1fc,#2b3c56);--rx-complete:light-dark(#237454,#91d5b6);--rx-error:light-dark(#ae3434,#ffa4a4);--rx-cancel:light-dark(#a45621,#efb27e);--rx-button:light-dark(#263e61,#dce8fa);--rx-button-text:light-dark(#fff,#172d4c);color-scheme:light dark;container-type:inline-size;font:400 14px/1.5 system-ui,sans-serif;color:var(--rx-text);background:var(--rx-bg);border:1px solid var(--rx-line);border-radius:12px;overflow:hidden;max-width:100%;min-width:0}
.rx-inspector *{box-sizing:border-box}.rx-inspector h2,.rx-inspector h3,.rx-inspector p{margin:0}.rx-inspector h2{font-size:18px;font-weight:600}.rx-inspector h3{font-size:14px;font-weight:600}.rx-inspector button,.rx-inspector select,.rx-inspector input{font:inherit;color:var(--rx-text)}.rx-inspector button,.rx-inspector select{border:1px solid var(--rx-line);border-radius:6px;background:var(--rx-bg);padding:7px 10px;min-height:38px}.rx-inspector button{cursor:pointer}.rx-inspector button:disabled{cursor:default;opacity:.42}.rx-inspector button:focus-visible,.rx-inspector select:focus-visible,.rx-inspector input:focus-visible{outline:2px solid var(--rx-active);outline-offset:3px}.rx-inspector .rx-primary{background:var(--rx-button);color:var(--rx-button-text);border-color:transparent}.rx-inspector .rx-muted{font-size:12px;color:var(--rx-muted)}.rx-inspector .rx-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.rx-inspector .rx-header,.rx-inspector .rx-section{padding:16px 20px}.rx-inspector .rx-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--rx-line)}.rx-inspector .rx-header-main{min-width:0}.rx-inspector .rx-trace-name{overflow-wrap:anywhere}.rx-inspector .rx-files{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.rx-inspector .rx-file-input{position:absolute;width:1px;height:1px;padding:0;opacity:0;pointer-events:none}.rx-inspector .rx-controls{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:end;padding:12px 20px;background:var(--rx-surface)}.rx-inspector .rx-picker{display:grid;gap:4px;min-width:0;font-size:12px;color:var(--rx-muted)}.rx-inspector .rx-picker select{min-width:0;width:100%;color:var(--rx-text);font-size:14px}.rx-inspector .rx-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px 16px;flex-wrap:wrap;margin-bottom:12px}.rx-inspector .rx-graph{position:relative;padding:8px 0}.rx-inspector .rx-graph-nodes{position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:34px}.rx-inspector .rx-node{position:relative;z-index:1;text-align:left;padding:12px;border-radius:8px;background:var(--rx-surface);min-width:0;display:grid;align-content:start;gap:3px}.rx-inspector .rx-node[data-selected=true]{background:var(--rx-focus);border-color:var(--rx-active)}.rx-inspector .rx-node-name{font-weight:600;overflow-wrap:anywhere}.rx-inspector .rx-node-domain{font-size:12px}.rx-inspector .rx-graph-lines{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;color:var(--rx-muted)}.rx-inspector .rx-edge{fill:none;stroke:currentColor;stroke-width:1.3}.rx-inspector .rx-edge[data-selected=true]{color:var(--rx-active);stroke-width:1.8}.rx-inspector .rx-connections{margin-top:9px;overflow-wrap:anywhere}.rx-inspector .rx-lanes{display:grid;gap:5px}.rx-inspector .rx-lane{display:grid;grid-template-columns:160px minmax(0,1fr);gap:12px;align-items:center;min-height:50px}.rx-inspector .rx-lane-name{min-width:0;text-align:left;border:0;background:transparent;padding:5px 0;display:grid;gap:1px;font-size:12px;line-height:1.3}.rx-inspector .rx-lane-name[data-selected=true]{color:var(--rx-active)}.rx-inspector .rx-lane-id{overflow-wrap:anywhere}.rx-inspector .rx-plot{height:34px;position:relative;margin:0 12px}.rx-inspector .rx-track,.rx-inspector .rx-life{position:absolute;top:15px;height:5px;min-width:2px;border-radius:2px;background:var(--rx-track)}.rx-inspector .rx-life{background:var(--rx-active)}.rx-inspector .rx-life[data-status=completed]{background:var(--rx-complete)}.rx-inspector .rx-life[data-status=errored]{background:var(--rx-error)}.rx-inspector .rx-life[data-status=unsubscribed]{background:var(--rx-cancel)}.rx-inspector .rx-cursor{position:absolute;top:0;height:34px;width:1px;background:var(--rx-muted);opacity:.55}.rx-inspector .rx-emission{position:absolute;top:12px;height:11px;width:2px;background:var(--rx-muted);opacity:.6}.rx-inspector .rx-selected-mark{position:absolute;top:10px;width:14px;height:14px;transform:translateX(-6px);border-radius:50%;background:var(--rx-button);box-shadow:0 0 0 2px var(--rx-bg)}.rx-inspector .rx-axis{display:grid;grid-template-columns:160px minmax(0,1fr);gap:12px;margin-top:7px;font-size:12px;color:var(--rx-muted)}.rx-inspector .rx-axis-labels{display:flex;justify-content:space-between;border-top:1px solid var(--rx-line);padding-top:4px;margin:0 12px;font-variant-numeric:tabular-nums}.rx-inspector .rx-legend{display:flex;gap:8px 18px;flex-wrap:wrap;margin-top:12px;font-size:12px;color:var(--rx-muted)}.rx-inspector .rx-legend-item{display:inline-flex;align-items:center;gap:6px}.rx-inspector .rx-swatch{display:inline-block;width:14px;height:4px;background:var(--rx-active);border-radius:1px}.rx-inspector .rx-swatch[data-status=completed]{background:var(--rx-complete)}.rx-inspector .rx-swatch[data-status=errored]{background:var(--rx-error)}.rx-inspector .rx-swatch[data-status=unsubscribed]{background:var(--rx-cancel)}.rx-inspector .rx-detail{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;border-top:1px solid var(--rx-line);background:var(--rx-surface)}.rx-inspector .rx-detail p{margin-top:7px;overflow-wrap:anywhere}.rx-inspector .rx-detail-title{font-weight:600}.rx-inspector .rx-value{font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;margin:9px 0 0;padding:10px;background:var(--rx-bg);border-radius:6px}.rx-inspector .rx-facts{display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px 12px;margin:10px 0 0;font-size:12px}.rx-inspector .rx-facts dt{color:var(--rx-muted)}.rx-inspector .rx-facts dd{margin:0;overflow-wrap:anywhere}.rx-inspector .rx-provenance{font-size:12px;color:var(--rx-muted);margin-top:4px}.rx-inspector .rx-cause{margin-top:10px;font-size:12px}.rx-inspector .rx-message{padding:10px 20px;border-top:1px solid var(--rx-line);font-size:13px;overflow-wrap:anywhere}.rx-inspector .rx-message[data-error=true]{color:var(--rx-error)}.rx-inspector [hidden]{display:none!important}.rx-inspector .rx-footer{border-top:1px solid var(--rx-line);padding:10px 20px;font-size:12px;color:var(--rx-muted)}.rx-inspector .rx-gap{color:var(--rx-cancel)}.rx-inspector .rx-empty{color:var(--rx-muted);padding:12px 0}.rx-inspector .rx-position{font-variant-numeric:tabular-nums}
@media(max-width:620px){.rx-inspector .rx-header,.rx-inspector .rx-section{padding:14px}.rx-inspector .rx-controls{padding:12px 14px;grid-template-columns:1fr 1fr;gap:8px}.rx-inspector .rx-picker{grid-column:1/-1;grid-row:1}.rx-inspector .rx-picker select{font-size:16px}.rx-inspector .rx-graph-nodes{grid-template-columns:1fr;gap:24px}.rx-inspector .rx-detail{grid-template-columns:1fr;gap:20px}.rx-inspector .rx-lane,.rx-inspector .rx-axis{grid-template-columns:95px minmax(0,1fr);gap:5px}.rx-inspector .rx-lane-name{font-size:12px}.rx-inspector .rx-plot,.rx-inspector .rx-axis-labels{margin-left:8px;margin-right:8px}.rx-inspector .rx-files{width:100%}.rx-inspector .rx-footer,.rx-inspector .rx-message{padding-left:14px;padding-right:14px}}
@container(max-width:620px){.rx-inspector .rx-header,.rx-inspector .rx-section{padding:14px}.rx-inspector .rx-controls{padding:12px 14px;grid-template-columns:1fr 1fr;gap:8px}.rx-inspector .rx-picker{grid-column:1/-1;grid-row:1}.rx-inspector .rx-picker select{font-size:16px}.rx-inspector .rx-graph-nodes{grid-template-columns:1fr;gap:24px}.rx-inspector .rx-detail{grid-template-columns:1fr;gap:20px}.rx-inspector .rx-lane,.rx-inspector .rx-axis{grid-template-columns:95px minmax(0,1fr);gap:5px}.rx-inspector .rx-plot,.rx-inspector .rx-axis-labels{margin-left:8px;margin-right:8px}.rx-inspector .rx-files{width:100%}.rx-inspector .rx-footer,.rx-inspector .rx-message{padding-left:14px;padding-right:14px}}
@media(pointer:coarse){.rx-inspector button,.rx-inspector select{min-height:44px}}
`;

let viewCount = 0;
const MAX_LANES = 80;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

function formatTime(time: number): string {
  return Number(time.toFixed(3)).toString();
}

function statusText(status: ExecutionSummary['status']): string {
  return status === 'unsubscribed' ? 'Unsubscribed' : status[0]!.toUpperCase() + status.slice(1);
}

/** Mount an offline trace viewer. Navigation never subscribes to the application. */
export function mountInspector(element: HTMLElement, initialTrace: Trace): InspectorView {
  const document = element.ownerDocument;
  const window = document.defaultView;
  const instanceId = `rx-inspector-${++viewCount}`;
  let trace = initialTrace;
  let cursor = 0;
  let disposed = false;
  let importGeneration = 0;
  let frame: number | undefined;
  let allExecutions: readonly ExecutionSummary[] = [];
  let eventsByExecution = new Map<string, TraceEvent[]>();
  let nodeById = new Map<string, TraceNode>();
  let graphButtons = new Map<string, HTMLButtonElement>();
  const urls = new Set<string>();
  const cleanups: (() => void)[] = [];

  function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(text: string, action: string, className = ''): HTMLButtonElement {
    const node = make('button', className, text);
    node.type = 'button';
    node.dataset.action = action;
    return node;
  }

  const root = make('section', 'rx-inspector');
  root.setAttribute('aria-label', 'RxJS execution inspector');
  const style = make('style');
  style.textContent = css;
  const header = make('header', 'rx-header');
  const headerMain = make('div', 'rx-header-main');
  headerMain.append(make('h2', '', 'rxjs-inspector'));
  const traceName = make('p', 'rx-muted rx-trace-name');
  headerMain.append(traceName);
  const files = make('div', 'rx-files');
  const importButton = button('Open trace', 'import');
  const exportButton = button('Export JSON', 'export');
  const fileInput = make('input', 'rx-file-input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.tabIndex = -1;
  fileInput.setAttribute('aria-label', 'Choose an RxJS trace JSON file');
  files.append(importButton, exportButton, fileInput);
  header.append(headerMain, files);

  const controls = make('nav', 'rx-controls');
  controls.setAttribute('aria-label', 'Recorded event navigation');
  const previous = button('← Previous', 'previous');
  const next = button('Next →', 'next', 'rx-primary');
  const pickerLabel = make('label', 'rx-picker', 'Recorded event');
  const picker = make('select');
  picker.setAttribute('aria-label', 'Select a recorded event');
  pickerLabel.append(picker);
  controls.append(previous, pickerLabel, next);

  const graphSection = make('section', 'rx-section');
  const graphHeading = make('div', 'rx-section-head');
  graphHeading.append(make('h3', '', 'Dataflow definitions'), make('span', 'rx-muted', 'Select a stage to find its execution'));
  const graph = make('div', 'rx-graph');
  const graphSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  graphSvg.classList.add('rx-graph-lines');
  graphSvg.setAttribute('aria-hidden', 'true');
  const graphNodes = make('div', 'rx-graph-nodes');
  graph.append(graphSvg, graphNodes);
  const connections = make('p', 'rx-connections rx-muted');
  graphSection.append(graphHeading, graph, connections);

  const timelineSection = make('section', 'rx-section');
  const timelineHeading = make('div', 'rx-section-head');
  const position = make('span', 'rx-muted rx-position');
  timelineHeading.append(make('h3', '', 'Subscription lifetimes'), position);
  const lanes = make('div', 'rx-lanes');
  lanes.setAttribute('aria-label', 'Recorded execution lifetimes');
  const axis = make('div', 'rx-axis');
  axis.append(make('span', '', 'Time (ms)'));
  const axisLabels = make('div', 'rx-axis-labels');
  axis.append(axisLabels);
  const legend = make('div', 'rx-legend');
  for (const [status, label] of [['active', 'Active'], ['completed', 'Completed'], ['unsubscribed', 'Unsubscribed'], ['errored', 'Errored']] as const) {
    const item = make('span', 'rx-legend-item');
    const swatch = make('span', 'rx-swatch');
    swatch.dataset.status = status;
    swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, document.createTextNode(label));
    legend.append(item);
  }
  const laneNote = make('p', 'rx-muted');
  timelineSection.append(timelineHeading, lanes, axis, legend, laneNote);

  const detail = make('section', 'rx-section rx-detail');
  detail.setAttribute('aria-label', 'Selected event and operator state');
  const eventPanel = make('div');
  eventPanel.append(make('h3', '', 'Recorded event'));
  const eventTitle = make('p', 'rx-detail-title');
  eventTitle.setAttribute('aria-live', 'polite');
  eventTitle.setAttribute('aria-atomic', 'true');
  const eventExplanation = make('p', 'rx-muted');
  const eventFacts = make('dl', 'rx-facts');
  const capturedStatus = make('p', 'rx-muted');
  const value = make('pre', 'rx-value');
  const cause = button('', 'cause', 'rx-cause');
  eventPanel.append(eventTitle, eventExplanation, eventFacts, capturedStatus, value, cause);
  const modelPanel = make('div');
  modelPanel.append(make('h3', '', 'Operator state'));
  const provenance = make('p', 'rx-provenance');
  const modelFacts = make('dl', 'rx-facts');
  const modelExplanation = make('p', 'rx-muted');
  modelPanel.append(provenance, modelFacts, modelExplanation);
  detail.append(eventPanel, modelPanel);
  const message = make('div', 'rx-message');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  message.hidden = true;
  const footer = make('footer', 'rx-footer');
  root.append(style, header, controls, graphSection, timelineSection, detail, message, footer);

  function showMessage(text: string, isError = false): void {
    message.textContent = text;
    message.dataset.error = String(isError);
    message.hidden = !text;
  }

  function addFact(container: HTMLDListElement, label: string, content: string): void {
    container.append(make('dt', '', label), make('dd', 'rx-mono', content));
  }

  function selectedEvent(): TraceEvent | undefined {
    return trace.events[cursor];
  }

  function rebuild(): void {
    allExecutions = getExecutions(trace);
    nodeById = new Map(trace.nodes.map(node => [node.id, node]));
    eventsByExecution = new Map();
    for (const event of trace.events) {
      const executionEvents = eventsByExecution.get(event.executionId) ?? [];
      executionEvents.push(event);
      eventsByExecution.set(event.executionId, executionEvents);
    }
    traceName.textContent = `${trace.name} · RxJS ${trace.rxjsBaseline} · ${trace.clock.name}`;
    picker.replaceChildren();
    for (const event of trace.events) {
      const option = make('option', '', `#${event.seq} · ${formatTime(event.time)} ms · ${nodeById.get(event.nodeId)?.label ?? event.nodeId} · ${event.role === 'inner' ? 'inner ' : ''}${event.port} ${event.kind}`);
      option.value = String(event.seq);
      picker.append(option);
    }
    graphNodes.replaceChildren();
    graphButtons = new Map();
    for (const node of trace.nodes) {
      const nodeButton = button('', 'node', 'rx-node');
      nodeButton.dataset.node = node.id;
      nodeButton.append(make('span', 'rx-node-name', node.label));
      nodeButton.append(make('span', 'rx-muted', node.operator ?? node.kind));
      if (node.domain) nodeButton.append(make('span', 'rx-node-domain rx-mono', node.domain));
      const state = make('span', 'rx-muted');
      state.dataset.nodeState = '';
      nodeButton.append(state);
      graphButtons.set(node.id, nodeButton);
      graphNodes.append(nodeButton);
    }
    connections.textContent = trace.edges.length
      ? `Declared connections: ${trace.edges.map(edge => `${nodeById.get(edge.from)?.label ?? edge.from} → ${nodeById.get(edge.to)?.label ?? edge.to}`).join(' · ')}`
      : 'No connections declared. Event order does not imply a graph edge.';
    footer.textContent = `Recording: ${trace.events.length} retained / ${trace.capture.totalEvents} events. Clock: ${trace.clock.kind}, milliseconds. Navigation reads recorded history; it does not run the pipeline.`;
    footer.classList.toggle('rx-gap', !trace.capture.complete);
    if (trace.capture.droppedEvents) footer.textContent += ` ${trace.capture.droppedEvents} earlier events were dropped; affected states may be unavailable.`;
    if (trace.capture.clockErrors) footer.textContent += ` ${trace.capture.clockErrors} invalid clock readings used the last usable time; event ordinals preserve ordering.`;
    render();
  }

  function drawEdges(): void {
    if (disposed) return;
    const bounds = graph.getBoundingClientRect();
    graphSvg.replaceChildren();
    if (!bounds.width || !bounds.height) return;
    graphSvg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.id = `${instanceId}-arrow`;
    for (const [name, val] of Object.entries({ viewBox: '0 0 8 8', refX: '7', refY: '4', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' })) marker.setAttribute(name, val);
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrow.setAttribute('d', 'M 0 1 L 7 4 L 0 7');
    arrow.setAttribute('fill', 'none');
    arrow.setAttribute('stroke', 'currentColor');
    marker.append(arrow);
    defs.append(marker);
    graphSvg.append(defs);
    for (const edge of trace.edges) {
      const from = graphButtons.get(edge.from)?.getBoundingClientRect();
      const to = graphButtons.get(edge.to)?.getBoundingClientRect();
      if (!from || !to) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      let d: string;
      if (Math.abs(from.top - to.top) < 10 && to.left > from.left) {
        const x1 = from.right - bounds.left;
        const y1 = from.top + from.height / 2 - bounds.top;
        const x2 = to.left - bounds.left;
        const y2 = to.top + to.height / 2 - bounds.top;
        if (x2 - x1 > 70) {
          // Route a non-adjacent connection above intervening cards. A straight
          // line behind a middle node would incorrectly suggest another edge.
          const top = Math.min(from.top, to.top) - bounds.top - 6;
          d = `M ${x1} ${y1} C ${x1 + 12} ${y1}, ${x1 + 12} ${top}, ${x1 + 24} ${top} L ${x2 - 24} ${top} C ${x2 - 12} ${top}, ${x2 - 12} ${y2}, ${x2} ${y2}`;
        } else {
          d = `M ${x1} ${y1} C ${x1 + 18} ${y1}, ${x2 - 18} ${y2}, ${x2} ${y2}`;
        }
      } else if (to.top > from.top) {
        const x1 = from.left + from.width / 2 - bounds.left;
        const y1 = from.bottom - bounds.top;
        const x2 = to.left + to.width / 2 - bounds.left;
        const y2 = to.top - bounds.top;
        if (y2 - y1 > 60) {
          const side = bounds.width + 6;
          d = `M ${x1} ${y1} C ${x1} ${y1 + 10}, ${side} ${y1 + 10}, ${side} ${y1 + 20} L ${side} ${y2 - 20} C ${side} ${y2 - 10}, ${x2} ${y2 - 10}, ${x2} ${y2}`;
        } else {
          d = `M ${x1} ${y1} C ${x1} ${y1 + 14}, ${x2} ${y2 - 14}, ${x2} ${y2}`;
        }
      } else if (edge.from === edge.to || to.top < from.top) {
        const x1 = from.right - bounds.left;
        const y1 = from.top + from.height / 2 - bounds.top;
        const x2 = edge.from === edge.to ? to.left + to.width / 2 - bounds.left : to.right - bounds.left;
        const y2 = edge.from === edge.to ? to.top - bounds.top : to.top + to.height / 2 - bounds.top;
        const side = bounds.width + 7;
        d = `M ${x1} ${y1} C ${side} ${y1}, ${side} ${y2 - 7}, ${x2} ${y2}`;
      } else {
        const x1 = from.left + from.width / 2 - bounds.left;
        const x2 = to.left + to.width / 2 - bounds.left;
        const y1 = from.top - bounds.top;
        const y2 = to.top - bounds.top;
        const bend = Math.min(y1, y2) - 7;
        d = `M ${x1} ${y1} C ${x1} ${bend}, ${x2} ${bend}, ${x2} ${y2}`;
      }
      path.setAttribute('d', d);
      path.classList.add('rx-edge');
      path.setAttribute('marker-end', `url(#${instanceId}-arrow)`);
      path.dataset.selected = String(selectedEvent()?.nodeId === edge.from || selectedEvent()?.nodeId === edge.to);
      graphSvg.append(path);
    }
  }

  function scheduleEdges(): void {
    if (frame !== undefined && window) window.cancelAnimationFrame(frame);
    if (window?.requestAnimationFrame) frame = window.requestAnimationFrame(drawEdges);
    else drawEdges();
  }

  function renderTimeline(event: TraceEvent | undefined, executions: readonly ExecutionSummary[]): void {
    lanes.replaceChildren();
    let minimum = 0;
    let maximum = 0;
    for (const recorded of trace.events) {
      minimum = Math.min(minimum, recorded.time);
      maximum = Math.max(maximum, recorded.time);
    }
    const span = maximum - minimum || 1;
    const percent = (time: number): number => Math.max(0, Math.min(100, 100 * (time - minimum) / span));
    const states = new Map(executions.map(execution => [execution.id, execution]));
    let visible = allExecutions.slice(0, MAX_LANES);
    if (event && !visible.some(execution => execution.id === event.executionId)) {
      const current = allExecutions.find(execution => execution.id === event.executionId);
      if (current) visible = [...visible.slice(0, MAX_LANES - 1), current];
    }
    for (const execution of visible) {
      const executionEvents = eventsByExecution.get(execution.id) ?? [];
      const state = states.get(execution.id);
      const firstEvent = executionEvents[0];
      const start = execution.startTime ?? firstEvent?.time ?? minimum;
      const end = execution.endTime ?? maximum;
      const row = make('div', 'rx-lane');
      const name = button('', 'execution', 'rx-lane-name');
      name.dataset.execution = execution.id;
      name.dataset.selected = String(event?.executionId === execution.id);
      const node = nodeById.get(execution.nodeId);
      name.append(make('span', 'rx-lane-id', `${node?.label ?? execution.nodeId}${execution.role === 'inner' ? ' · inner' : ''}`));
      name.append(make('span', 'rx-muted rx-mono', execution.id));
      name.append(make('span', 'rx-muted', state ? `${statusText(state.status)} · ${state.nextCount} value${state.nextCount === 1 ? '' : 's'}` : 'Not started at cursor'));
      const plot = make('div', 'rx-plot');
      plot.setAttribute('role', 'img');
      plot.setAttribute('aria-label', `${execution.id}: ${execution.startTime === undefined ? 'start not retained' : `started at ${formatTime(start)} milliseconds`}; ${state ? statusText(state.status) : 'not started at cursor'}${state?.endTime !== undefined ? ` at ${formatTime(state.endTime)} milliseconds` : ''}.`);
      const track = make('span', 'rx-track');
      track.style.left = `${percent(start)}%`;
      track.style.width = `${Math.max(0, percent(end) - percent(start))}%`;
      plot.append(track);
      if (state && event) {
        const life = make('span', 'rx-life');
        life.style.left = `${percent(start)}%`;
        life.style.width = `${Math.max(0, percent(Math.min(event.time, end)) - percent(start))}%`;
        life.dataset.status = state.status;
        plot.append(life);
      }
      for (const notification of executionEvents) {
        if (notification.kind !== 'next' || notification.port !== 'output') continue;
        const tick = make('span', 'rx-emission');
        tick.style.left = `${percent(notification.time)}%`;
        if (!event || notification.seq > event.seq) tick.style.opacity = '.18';
        plot.append(tick);
      }
      if (event) {
        const cursorLine = make('span', 'rx-cursor');
        cursorLine.style.left = `${percent(event.time)}%`;
        plot.append(cursorLine);
        if (execution.id === event.executionId) {
          const selected = make('span', 'rx-selected-mark');
          selected.style.left = `${percent(event.time)}%`;
          plot.append(selected);
        }
      }
      row.append(name, plot);
      lanes.append(row);
    }
    if (!allExecutions.length) lanes.append(make('p', 'rx-empty', 'No subscription executions recorded.'));
    axisLabels.replaceChildren();
    axisLabels.append(make('span', '', formatTime(minimum)));
    if (maximum > minimum) axisLabels.append(make('span', '', formatTime(minimum + span / 2)), make('span', '', formatTime(maximum)));
    laneNote.textContent = `${allExecutions.length > MAX_LANES ? `Showing ${visible.length} of ${allExecutions.length} executions; the selected execution is always included. ` : ''}Ticks show output values; the dot marks the selected event. Muted segments belong to later recorded events. Equal timestamps retain their event order.`;
  }

  function render(): void {
    const event = selectedEvent();
    const executions = getExecutions(trace, event?.seq ?? 0);
    previous.disabled = !event || cursor === 0;
    next.disabled = !event || cursor >= trace.events.length - 1;
    picker.disabled = !event;
    const options = Array.from(picker.options);
    for (const option of options) option.selected = false;
    const selectedOption = options.find(option => option.value === String(event?.seq));
    if (selectedOption) selectedOption.selected = true;
    position.textContent = event ? `Event ${cursor + 1} / ${trace.events.length} · #${event.seq} · ${formatTime(event.time)} ms` : 'No events';
    for (const [nodeId, nodeButton] of graphButtons) {
      nodeButton.dataset.selected = String(event?.nodeId === nodeId);
      const count = executions.filter(execution => execution.nodeId === nodeId && execution.role !== 'inner').length;
      const state = nodeButton.querySelector<HTMLElement>('[data-node-state]');
      if (state) state.textContent = `${count} execution${count === 1 ? '' : 's'} observed at cursor`;
      nodeButton.disabled = !trace.events.some(item => item.nodeId === nodeId);
    }
    renderTimeline(event, executions);
    eventFacts.replaceChildren();
    modelFacts.replaceChildren();
    value.hidden = true;
    cause.hidden = true;
    capturedStatus.textContent = '';
    if (!event) {
      eventTitle.textContent = 'No event selected';
      eventExplanation.textContent = 'Subscribe to an instrumented pipeline, then open its captured trace.';
      provenance.textContent = 'No execution selected';
      modelExplanation.textContent = '';
      scheduleEdges();
      return;
    }
    eventTitle.textContent = `#${event.seq} · ${event.kind} · ${nodeById.get(event.nodeId)?.label ?? event.nodeId}`;
    eventExplanation.textContent = explainEvent(trace, event);
    addFact(eventFacts, 'Execution', event.executionId);
    addFact(eventFacts, 'Boundary', `${event.role} · ${event.port}`);
    addFact(eventFacts, 'Time', `${formatTime(event.time)} ms`);
    if (event.parentExecutionId) addFact(eventFacts, 'Parent execution', event.parentExecutionId);
    if (event.value) {
      capturedStatus.textContent = `Value capture: ${event.value.status}${event.value.reason ? ` · ${event.value.reason}` : ''}`;
      if (event.value.data !== undefined) {
        value.hidden = false;
        value.textContent = JSON.stringify(event.value.data, null, 2);
      }
    }
    if (event.causeEventSeq !== undefined) {
      cause.hidden = false;
      const retained = trace.events.some(item => item.seq === event.causeEventSeq);
      cause.textContent = retained ? `Go to cause #${event.causeEventSeq}` : `Cause #${event.causeEventSeq} is not retained`;
      cause.disabled = !retained;
    }
    const operatorId = event.role === 'inner' ? event.parentExecutionId : event.role === 'operator' ? event.executionId : undefined;
    if (operatorId) {
      const state = getSwitchMapState(trace, operatorId, event.seq);
      provenance.textContent = state.provenance === 'reconstructed' ? 'Reconstructed from the switchMap model' : 'State unavailable from the supported model';
      addFact(modelFacts, 'Execution', operatorId);
      addFact(modelFacts, 'Active inner', state.provenance === 'unavailable' ? 'Unknown' : state.activeInnerId ?? 'None');
      addFact(modelFacts, 'Outer completed', state.outerCompleted ? 'Yes' : 'No completion observed');
      addFact(modelFacts, 'Output', statusText(state.outputStatus));
      modelExplanation.textContent = state.explanation;
    } else {
      provenance.textContent = 'Recorded boundary';
      const state = executions.find(item => item.id === event.executionId);
      if (state) {
        addFact(modelFacts, 'Execution status', statusText(state.status));
        addFact(modelFacts, 'Output values', String(state.nextCount));
      }
      modelExplanation.textContent = 'Select a switchMap execution or one of its inner events to inspect the operator policy.';
    }
    scheduleEdges();
  }

  function selectIndex(index: number): void {
    if (!trace.events.length || !Number.isInteger(index)) return;
    cursor = Math.max(0, Math.min(trace.events.length - 1, index));
    render();
  }

  function selectSequence(seq: number | undefined): void {
    if (seq === undefined) return;
    const index = trace.events.findIndex(event => event.seq === seq);
    if (index !== -1) selectIndex(index);
  }

  function exportJson(): void {
    try {
      const urlApi = window?.URL;
      if (!urlApi?.createObjectURL) throw new Error('This environment does not support file downloads.');
      const text = serializeTrace(trace);
      const blob = new (window?.Blob ?? Blob)([text], { type: 'application/json' });
      const url = urlApi.createObjectURL(blob);
      urls.add(url);
      const filename = `${trace.name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'rxjs-trace'}.json`;
      const anchor = make('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.hidden = true;
      root.append(anchor);
      anchor.click();
      anchor.remove();
      // Keep the URL valid until the browser has processed the download click.
      window?.setTimeout(() => { urlApi.revokeObjectURL(url); urls.delete(url); }, 0);
      showMessage(`Exported ${filename}.`);
    } catch (error) {
      showMessage(`Export failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  function click(event: Event): void {
    const target = event.target as Element | null;
    const actionElement = target?.closest?.<HTMLElement>('[data-action]');
    if (!actionElement || !root.contains(actionElement) || actionElement.hasAttribute('disabled')) return;
    switch (actionElement.dataset.action) {
      case 'previous': selectIndex(cursor - 1); break;
      case 'next': selectIndex(cursor + 1); break;
      case 'import': fileInput.click(); break;
      case 'export': exportJson(); break;
      case 'cause': selectSequence(selectedEvent()?.causeEventSeq); break;
      case 'execution': {
        const recorded = eventsByExecution.get(actionElement.dataset.execution ?? '');
        selectSequence(recorded?.[0]?.seq);
        break;
      }
      case 'node': {
        const matching = trace.events.filter(item => item.nodeId === actionElement.dataset.node && item.role !== 'inner');
        const selected = matching.filter(item => item.seq <= (selectedEvent()?.seq ?? 0)).at(-1) ?? matching[0];
        selectSequence(selected?.seq);
        break;
      }
    }
  }

  function changeEvent(): void { selectSequence(Number(picker.value)); }

  async function importFile(): Promise<void> {
    const file = fileInput.files?.[0];
    if (!file) return;
    const generation = ++importGeneration;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('Trace files must be 20 MB or smaller.');
      const imported = parseTrace(await file.text());
      if (disposed || generation !== importGeneration) return;
      trace = imported;
      cursor = 0;
      rebuild();
      showMessage(`Opened ${file.name}: ${trace.events.length} retained events.`);
    } catch (error) {
      if (!disposed && generation === importGeneration) showMessage(`Import failed: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      if (!disposed && generation === importGeneration) fileInput.value = '';
    }
  }

  const changedFile = (): void => { void importFile(); };
  root.addEventListener('click', click);
  picker.addEventListener('change', changeEvent);
  fileInput.addEventListener('change', changedFile);
  cleanups.push(() => root.removeEventListener('click', click), () => picker.removeEventListener('change', changeEvent), () => fileInput.removeEventListener('change', changedFile));
  element.append(root);
  const Observer = (window as unknown as { ResizeObserver?: typeof ResizeObserver } | null)?.ResizeObserver;
  if (Observer) {
    const observer = new Observer(scheduleEdges);
    observer.observe(graph);
    cleanups.push(() => observer.disconnect());
  } else if (window) {
    window.addEventListener('resize', scheduleEdges);
    cleanups.push(() => window.removeEventListener('resize', scheduleEdges));
  }
  rebuild();

  return {
    setTrace(nextTrace: Trace): void {
      if (disposed) throw new Error('This inspector view has been destroyed.');
      importGeneration += 1;
      trace = nextTrace;
      cursor = 0;
      rebuild();
      showMessage('');
    },
    destroy(): void {
      if (disposed) return;
      disposed = true;
      importGeneration += 1;
      if (frame !== undefined && window) window.cancelAnimationFrame(frame);
      for (const cleanup of cleanups) cleanup();
      for (const url of urls) window?.URL.revokeObjectURL(url);
      urls.clear();
      root.remove();
    },
  };
}
