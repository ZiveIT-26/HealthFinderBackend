import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type LocationSource = 'current' | 'home';

export type SharedLocation = {
  lat: number;
  lon: number;
  source: LocationSource;
  label?: string; // displayed location
};

export type LocationReply =
  | { kind: 'shared'; location: SharedLocation }
  | { kind: 'declined' }
  | { kind: 'unanswered' };

export type LocationState =
  | { status: 'unknown' }
  | { status: 'shared'; location: SharedLocation }
  | { status: 'declined' }
  | { status: 'unanswered' };

export type LocationRequest = {
  requestId: string;
  isNew: boolean;
  reply: Promise<LocationReply>;
  cancel(): void;
};

export type LocationAccess = {
  state(): LocationState;
  ask(): LocationRequest;
};

/** How long a tool waits for the user's answer. The SSE heartbeat keeps the stream open. */
export const LOCATION_REQUEST_TIMEOUT_MS = 120_000;
/**
 * Safety net for replies that never end: a session's location is forgotten
 * after this long, even before the next message.
 */
const STATE_TTL_MS = 30 * 60 * 1000;

const LABEL_MAX_LENGTH = 200;

type SessionEntry = { state: Exclude<LocationState, { status: 'unknown' }>; updatedAt: number };

type Pending = {
  requestId: string;
  sessionId: string;
  userId: string;
  reply: Promise<LocationReply>;
  settle: (reply: LocationReply) => void;
};

@Injectable()
export class DeviceLocationService {
  private readonly logger = new Logger(DeviceLocationService.name);
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly pendingById = new Map<string, Pending>();
  private readonly pendingBySession = new Map<string, Pending>();

  timeoutMs = LOCATION_REQUEST_TIMEOUT_MS;

  forSession(sessionId: string, userId: string): LocationAccess {
    return {
      state: () => this.state(sessionId),
      ask: () => this.ask(sessionId, userId),
    };
  }

  state(sessionId: string): LocationState {
    const entry = this.sessions.get(sessionId);
    if (!entry) return { status: 'unknown' };
    if (Date.now() - entry.updatedAt > STATE_TTL_MS) {
      this.sessions.delete(sessionId);
      return { status: 'unknown' };
    }
    return entry.state;
  }

  startReply(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  remember(sessionId: string, location: SharedLocation): void {
    this.setState(sessionId, { status: 'shared', location });
  }

  answer(requestId: string, userId: string, reply: SharedLocation | 'declined'): boolean {
    const pending = this.pendingById.get(requestId);
    if (!pending || pending.userId !== userId) return false;

    pending.settle(
      reply === 'declined' ? { kind: 'declined' } : { kind: 'shared', location: reply },
    );
    return true;
  }

  private ask(sessionId: string, userId: string): LocationRequest {
    const existing = this.pendingBySession.get(sessionId);
    if (existing) {
      return {
        requestId: existing.requestId,
        isNew: false,
        reply: existing.reply,
        cancel: () => existing.settle({ kind: 'unanswered' }),
      };
    }

    const requestId = randomUUID();
    let resolve!: (reply: LocationReply) => void;
    const reply = new Promise<LocationReply>((done) => (resolve = done));

    const timer = setTimeout(() => pending.settle({ kind: 'unanswered' }), this.timeoutMs);
    timer.unref?.();

    const pending: Pending = {
      requestId,
      sessionId,
      userId,
      reply,
      settle: (result) => {
        if (this.pendingById.get(requestId) !== pending) return; // already settled
        clearTimeout(timer);
        this.pendingById.delete(requestId);
        this.pendingBySession.delete(sessionId);
        this.setState(
          sessionId,
          result.kind === 'shared' ? { status: 'shared', location: result.location } : { status: result.kind },
        );
        this.logger.log(`[${sessionId}] Location request ${requestId}: ${result.kind}`);
        resolve(result);
      },
    };

    this.pendingById.set(requestId, pending);
    this.pendingBySession.set(sessionId, pending);
    this.logger.log(`[${sessionId}] Location requested ${requestId}`);
    return {
      requestId,
      isNew: true,
      reply,
      cancel: () => pending.settle({ kind: 'unanswered' }),
    };
  }

  private setState(sessionId: string, state: SessionEntry['state']): void {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (now - entry.updatedAt > STATE_TTL_MS) this.sessions.delete(id);
    }
    this.sessions.set(sessionId, { state, updatedAt: now });
  }
}

export function parseSharedLocation(
  value: unknown,
  source: LocationSource,
): SharedLocation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { lat, lon, label } = value as Record<string, unknown>;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return undefined;
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) return undefined;

  const cleanLabel =
    typeof label === 'string' ? label.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX_LENGTH) : '';
  return { lat, lon, source, ...(cleanLabel ? { label: cleanLabel } : {}) };
}
