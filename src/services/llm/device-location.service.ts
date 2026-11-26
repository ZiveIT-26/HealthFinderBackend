import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * The user's location for one chat session, asked from the app while a
 * response is streaming.
 *
 * Flow: a tool calls `ask()` -> the stream sends `location_request` with a
 * `requestId` -> the app asks the user (current position or home) ->
 * `POST /chat/location` calls `answer()` -> the waiting tool continues.
 *
 * Coordinates stay in memory on the server: they are not saved to the
 * database and the model only sees the label (see request-location.tool.ts).
 *
 * An answer is kept for one reply only: every new message starts without a
 * location ([startReply]), so the next search asks the app again. Whether the
 * user is asked again is up to the app: it may remember the choice for the
 * whole chat and answer by itself with a fresh position.
 */

/** Where a shared location comes from. */
export type LocationSource = 'current' | 'home';

export type SharedLocation = {
  lat: number;
  lon: number;
  source: LocationSource;
  /** Display name from reverse geocoding on the device, e.g. "Košice - Staré Mesto". */
  label?: string;
};

/** What the user answered to one request. */
export type LocationReply =
  | { kind: 'shared'; location: SharedLocation }
  | { kind: 'declined' }
  | { kind: 'unanswered' };

/** The session's location as far as this server knows it. */
export type LocationState =
  | { status: 'unknown' }
  | { status: 'shared'; location: SharedLocation }
  | { status: 'declined' }
  | { status: 'unanswered' };

/** Pending request, shared by every tool of the session that asks at the same time. */
export type LocationRequest = {
  requestId: string;
  /** True for the caller that created it: only that one sends the event to the app. */
  isNew: boolean;
  reply: Promise<LocationReply>;
  /** Gives up without an answer, e.g. when the event could not be sent to the app. */
  cancel(): void;
};

/** What the tools of one session may do. */
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

  /** Not a constructor parameter: Nest would try to inject it. Tests may lower it. */
  timeoutMs = LOCATION_REQUEST_TIMEOUT_MS;

  /** Access for the tools of one stream of [sessionId], owned by [userId]. */
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

  /** A new message of [sessionId]: the previous reply's location is forgotten. */
  startReply(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** A location the app sent without being asked (`location` in `POST /chat`). */
  remember(sessionId: string, location: SharedLocation): void {
    this.setState(sessionId, { status: 'shared', location });
  }

  /**
   * The app's answer to [requestId] (`POST /chat/location`).
   * Returns false when there is no such request for [userId]: unknown, already
   * answered, timed out, or another user's.
   */
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

/**
 * Checks a location sent by the app. Returns undefined for anything invalid,
 * so callers can ignore it (POST /chat) or reject it (POST /chat/location).
 */
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
