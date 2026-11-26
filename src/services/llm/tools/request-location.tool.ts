import { Logger } from '@nestjs/common';
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import type { RunnableConfig } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { RequestLocationTexts } from '../../../config/llm.config.js';
import { fillTemplate } from '../../../config/template.js';
import type {
  LocationAccess,
  LocationReply,
  SharedLocation,
} from '../device-location.service.js';

export const REQUEST_LOCATION_TOOL = 'request_location';

/**
 * Custom LangChain event sent while a tool waits for the app. The chat stream
 * turns it into the SSE payload `{ type: 'location_request', requestId, reason? }`.
 */
export const LOCATION_REQUEST_EVENT = 'location_request';

export type LocationRequestEvent = {
  type: 'location_request';
  requestId: string;
  reason?: string;
  /**
   * The user wants to change the location: the app shows the choice even
   * when it remembers one for this chat.
   */
  change?: true;
};

const REASON_MAX_LENGTH = 120;

const logger = new Logger('RequestLocation');

/**
 * Asks the app for the location and waits for the answer (or the timeout).
 * Several tools of one session asking at once share one request, so the user
 * sees one question.
 */
export async function askDeviceLocation(
  access: LocationAccess,
  config: RunnableConfig | undefined,
  { reason, change }: { reason?: string; change?: boolean } = {},
): Promise<LocationReply> {
  const request = access.ask();
  if (request.isNew) {
    const event: LocationRequestEvent = {
      type: 'location_request',
      requestId: request.requestId,
      ...(reason ? { reason } : {}),
      ...(change ? { change: true } : {}),
    };
    try {
      await dispatchCustomEvent(LOCATION_REQUEST_EVENT, event, config);
    } catch (error) {
      // Outside a streamed run (e.g. a unit test) nobody could answer.
      logger.warn(`Could not send the location request to the app: ${String(error)}`);
      request.cancel();
    }
  }
  return request.reply;
}

/** What the model reads about a location. Never contains coordinates. */
export function describeLocation(location: SharedLocation, texts: RequestLocationTexts): string {
  return fillTemplate(texts.shared, {
    source: location.source === 'home' ? texts.sourceHome : texts.sourceCurrent,
    label: location.label ?? texts.unnamedPlace,
  });
}

export function describeReply(reply: LocationReply, texts: RequestLocationTexts): string {
  switch (reply.kind) {
    case 'shared':
      return describeLocation(reply.location, texts);
    case 'declined':
      return texts.declined;
    case 'unanswered':
      return texts.unanswered;
  }
}

/**
 * Lets the model ask the user's device where to search. The app asks the user
 * to choose between the current position and the home address.
 */
export function createRequestLocationTool(
  access: LocationAccess,
  { requestLocation: texts }: { requestLocation: RequestLocationTexts },
) {
  return tool(
    async ({ reason, refresh }, config) => {
      const state = access.state();
      if (!refresh) {
        // Already answered during this reply: do not ask twice.
        if (state.status === 'shared') return describeLocation(state.location, texts);
        if (state.status === 'declined') return texts.declined;
      }

      const cleanReason = reason?.replace(/\s+/g, ' ').trim().slice(0, REASON_MAX_LENGTH);
      return describeReply(
        await askDeviceLocation(access, config, { reason: cleanReason, change: refresh }),
        texts,
      );
    },
    {
      name: REQUEST_LOCATION_TOOL,
      description: texts.description,
      schema: z.object({
        reason: z.string().optional().describe(texts.reasonField),
        refresh: z.boolean().optional().describe(texts.refreshField),
      }),
    },
  );
}
