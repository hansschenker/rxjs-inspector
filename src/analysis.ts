import type { ExecutionSummary, SwitchMapState, Trace, TraceEvent } from './types.js';

type MutableExecution = { -readonly [Key in keyof ExecutionSummary]: ExecutionSummary[Key] };

function cursor(trace: Trace, atSeq: number | undefined): number {
  if (atSeq === undefined) return trace.capture.totalEvents;
  if (!Number.isSafeInteger(atSeq) || atSeq < 0) throw new RangeError('Event cursor must be a non-negative safe integer');
  return atSeq;
}

function ending(event: TraceEvent): ExecutionSummary['status'] | undefined {
  if (event.port !== 'output') return undefined;
  if (event.kind === 'complete') return 'completed';
  if (event.kind === 'error') return 'errored';
  if (event.kind === 'unsubscribe') return 'unsubscribed';
  return undefined;
}

/** Summaries are local to each execution and include only events at/before the cursor. */
export function getExecutions(trace: Trace, atSeq?: number): readonly ExecutionSummary[] {
  const selectedSeq = cursor(trace, atSeq);
  const executions = new Map<string, MutableExecution>();
  for (const event of trace.events) {
    if (event.seq > selectedSeq) break;
    let execution = executions.get(event.executionId);
    if (!execution) {
      execution = {
        id: event.executionId,
        nodeId: event.nodeId,
        role: event.role,
        ...(event.parentExecutionId !== undefined ? { parentExecutionId: event.parentExecutionId } : {}),
        status: 'unknown',
        nextCount: 0,
      };
      executions.set(event.executionId, execution);
    }
    if (event.kind === 'subscribe') {
      execution.startSeq = event.seq;
      execution.startTime = event.time;
      execution.status = 'active';
    }
    if (event.kind === 'next' && event.port === 'output') execution.nextCount += 1;
    const status = ending(event);
    if (status) {
      execution.status = status;
      execution.endSeq = event.seq;
      execution.endTime = event.time;
    }
  }
  return Object.freeze([...executions.values()].map((execution) => Object.freeze(execution)));
}

/** A small model of observed switchMap decisions, never an evaluator of user functions. */
export function getSwitchMapState(trace: Trace, executionId: string, atSeq?: number): SwitchMapState {
  const selectedSeq = cursor(trace, atSeq);
  const relevant = trace.events.filter((event) => event.seq <= selectedSeq && (event.executionId === executionId || event.parentExecutionId === executionId));
  const first = relevant.find((event) => event.executionId === executionId);
  const definition = first && trace.nodes.find((node) => node.id === first.nodeId);
  if (!first || first.kind !== 'subscribe' || first.role !== 'operator' || definition?.operator !== 'switchMap') {
    const outputStatus = getExecutions(trace, selectedSeq).find((execution) => execution.id === executionId)?.status ?? 'unknown';
    return Object.freeze({
      executionId,
      provenance: 'unavailable',
      outerCompleted: false,
      activeInnerId: null,
      outputStatus,
      explanation: !first
        ? 'This execution has not been observed at the selected event.'
        : first.kind !== 'subscribe'
          ? 'The subscription start is outside the retained history; operator state cannot be reconstructed.'
          : 'This execution has no supported switchMap model. Recorded events remain available.',
    });
  }

  let outerCompleted = false;
  let activeInnerId: string | null = null;
  let outputStatus: ExecutionSummary['status'] = 'active';
  const activeInners = new Set<string>();
  let unsupportedOverlap = false;
  let unsupportedTransition = false;
  for (const event of relevant) {
    if (event.executionId === executionId) {
      if (event.port === 'input' && event.kind === 'next' && outerCompleted) unsupportedTransition = true;
      if (event.port === 'input' && event.kind === 'complete') outerCompleted = true;
      const status = ending(event);
      if (status === 'completed' && (!outerCompleted || activeInners.size > 0)) unsupportedTransition = true;
      if (status) outputStatus = status;
    } else if (event.role === 'inner') {
      if (event.kind === 'subscribe') {
        if (outputStatus !== 'active') unsupportedTransition = true;
        activeInners.add(event.executionId);
        if (activeInners.size > 1) unsupportedOverlap = true;
      }
      if (ending(event)) {
        if (!activeInners.has(event.executionId)) unsupportedTransition = true;
        activeInners.delete(event.executionId);
      }
      activeInnerId = activeInners.size === 1 ? [...activeInners][0] ?? null : null;
    }
  }

  if (unsupportedOverlap || unsupportedTransition) {
    return Object.freeze({
      executionId,
      provenance: 'unavailable',
      outerCompleted,
      activeInnerId: null,
      outputStatus,
      explanation: unsupportedOverlap
        ? 'Reentrant or overlapping inner executions exceed the supported switchMap model. The recorded lifetimes and notifications remain available.'
        : 'This transition is outside the supported switchMap model. The recorded lifetimes and notifications remain available.',
    });
  }

  const explanation = outputStatus === 'completed'
    ? 'The output completed after the outer and the active inner execution had completed.'
    : outputStatus === 'errored'
      ? 'The output delivered an error. Subscription cleanup may appear in subsequent recorded events.'
      : outputStatus === 'unsubscribed'
        ? 'The output subscription was disposed. Subscription cleanup may appear in subsequent recorded events.'
        : outerCompleted && activeInnerId !== null
          ? 'The outer has completed. The output stays open while the active inner execution finishes.'
          : outerCompleted
            ? 'The outer has completed and no inner execution is active. The output completion has not yet been observed at this cursor.'
            : activeInnerId !== null
              ? 'The latest inner execution is active. A new outer value will replace it.'
              : 'No inner execution is active at this event. The outer can still deliver values.';
  return Object.freeze({ executionId, provenance: 'reconstructed', outerCompleted, activeInnerId, outputStatus, explanation });
}

/** Explain one recorded fact; inferred policy is identified explicitly in the text. */
export function explainEvent(trace: Trace, event: TraceEvent): string {
  const node = trace.nodes.find((candidate) => candidate.id === event.nodeId);
  const label = node?.label ?? event.nodeId;
  const subject = event.role === 'inner' ? `Inner execution ${event.executionId}` : label;
  if (event.kind === 'subscribe') {
    return event.role === 'inner'
      ? `${subject} subscribed${event.causeEventSeq !== undefined ? ` during event #${event.causeEventSeq}` : ''}. Its future notifications are not yet known at this cursor.`
      : `${subject} subscribed. This execution has its own identity and lifecycle.`;
  }
  if (event.kind === 'next') {
    if (event.port === 'input' && node?.operator === 'switchMap') {
      return `${label} received an outer value. The switchMap model replaces any active inner execution; subsequent events show the recorded disposal and subscription.`;
    }
    return `${subject} delivered a captured value on its ${event.port} boundary${event.causeEventSeq !== undefined ? ` during event #${event.causeEventSeq}` : ''}.`;
  }
  if (event.kind === 'error') return `${subject} delivered an error on its ${event.port} boundary.`;
  if (event.kind === 'complete') {
    if (event.port === 'input' && node?.operator === 'switchMap') {
      return `${label}'s outer input completed. The switchMap model waits for an active inner execution before completing the output.`;
    }
    return `${subject} delivered a completion notification. This is an observed terminal notification.`;
  }
  const cause = event.causeEventSeq === undefined ? undefined : trace.events.find((candidate) => candidate.seq === event.causeEventSeq);
  if (event.role === 'inner' && cause !== undefined && cause.executionId === event.parentExecutionId && cause.port === 'input' && cause.kind === 'next' && node?.operator === 'switchMap') {
    return `${subject} was unsubscribed during outer event #${cause.seq}. The switchMap model identifies this as replacement by the latest input. Transport abort requires separate evidence.`;
  }
  return `${subject} was unsubscribed before an output terminal notification was recorded. Its external effects may have their own cleanup behavior.`;
}
