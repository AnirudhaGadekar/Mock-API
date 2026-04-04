import { EventEmitter } from 'events';

/**
 * Internal EventEmitter system.
 *
 * Used for:
 * - "requestLogged"   → analytics, real-time dashboards
 * - "endpointCreated" → onboarding flows, notifications
 * - "endpointUpdated" → cache invalidation, sync
 * - "endpointDeleted" → cleanup, sync
 */

export type RequestLoggedEvent = {
  id: string;
  endpointId: string;
  method: string;
  path: string;
  status: number;
  timestamp: Date;
  latencyMs: number;
};

export type EndpointEvent = {
  id: string;
  userId: string;
  name: string;
  createdAt: Date;
};

export type EndpointUpdatedEvent = EndpointEvent & {
  changes: Record<string, unknown>;
};

export type EndpointDeletedEvent = {
  id: string;
  userId: string;
  deletedAt: Date;
};

type MockAPIEvents = {
  requestLogged: (payload: RequestLoggedEvent) => void;
  endpointCreated: (payload: EndpointEvent) => void;
  endpointUpdated: (payload: EndpointUpdatedEvent) => void;
  endpointDeleted: (payload: EndpointDeletedEvent) => void;
};

class MockAPIEventBus extends EventEmitter {
  emit<EventName extends keyof MockAPIEvents>(
    event: EventName,
    payload: Parameters<MockAPIEvents[EventName]>[0],
  ): boolean {
    return super.emit(event, payload);
  }

  on<EventName extends keyof MockAPIEvents>(
    event: EventName,
    listener: MockAPIEvents[EventName],
  ): this {
    return super.on(event, listener);
  }

  off<EventName extends keyof MockAPIEvents>(
    event: EventName,
    listener: MockAPIEvents[EventName],
  ): this {
    return super.off(event, listener);
  }
}

export const events = new MockAPIEventBus();
