// src/instrumentation/types.ts

export interface OperatorInfo {
  name: string;
  parent?: number;
  stackTrace?: string;
}

// ---- Events ----

interface BaseEvent {
  timestamp: number;
  observableId: number;
}

export interface ObservableCreateEvent extends BaseEvent {
  type: 'observable-create';
  operatorInfo?: OperatorInfo;
}

export interface SubscribeEvent extends BaseEvent {
  type: 'subscribe';
  subscriptionId: number;
}

export interface NextEvent extends BaseEvent {
  type: 'next';
  subscriptionId: number;
  value: unknown;
}

export interface ErrorEvent extends BaseEvent {
  type: 'error';
  subscriptionId: number;
  error: unknown;
}

export interface CompleteEvent extends BaseEvent {
  type: 'complete';
  subscriptionId: number;
}

export interface UnsubscribeEvent extends BaseEvent {
  type: 'unsubscribe';
  subscriptionId: number;
}

export type NotificationEvent =
  | ObservableCreateEvent
  | SubscribeEvent
  | NextEvent
  | ErrorEvent
  | CompleteEvent
  | UnsubscribeEvent;

// ---- Instrumentation config ----

export interface InstrumentationConfig {
  enabled: boolean;
  /**
   * 0..1 – percentage of `next` events to capture.
   * 1 = capture all, 0.1 = 10% sampling. Default: 1.
   */
  sampleRate: number;
  /**
   * When true, replaces `.value` in next events with "<redacted>".
   */
  excludeValues: boolean;
  /**
   * Optional: how many events consumers may want to batch together.
   * (Currently mainly for consumers, not used inside core instrumentation.)
   */
  bufferSize?: number;
}

export const defaultInstrumentationConfig: InstrumentationConfig = {
  enabled: true,
  sampleRate: 1,
  excludeValues: false,
};

// ---- Print / CLI options ----

export type GroupBy = 'observable' | 'subscription' | 'operator';

export interface PrintOptions {
  format: 'tree' | 'flat' | 'timeline';
  showValues: boolean;
  showTimestamps: boolean;
  colorize: boolean;
  groupBy: GroupBy;
}

export const defaultPrintOptions: PrintOptions = {
  format: 'flat',
  showValues: true,
  showTimestamps: true,
  colorize: true,
  groupBy: 'observable',
};
