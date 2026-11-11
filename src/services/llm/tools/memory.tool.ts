import { InMemoryStore } from '@langchain/core/stores';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { DbService } from '../../db/db.service.js';

type Memory = { id: string; content: string };
const MAX_MEMORIES = 50;
const MAX_MEMORY_LENGTH = 500;

export function createMemoryTools(
  store: InMemoryStore<Memory[]>,
  dbService: DbService,
  sessionId: string,
) {
  const getUserId = async () => {
    const userId = await dbService.getSessionUserId(sessionId);
    if (!userId) throw new Error(`Session not found: ${sessionId}`);
    return userId;
  };

  const loadMemories = async (userId: string) => {
    let [memories] = await store.mget([userId]);
    if (!memories) {
      memories = await dbService.getMemories(userId);
      await store.mset([[userId, memories]]);
    }
    return memories;
  };

  const readMemory = tool(
    async () => {
      const memories = await loadMemories(await getUserId());
      return memories.length
        ? memories.map(({ id, content }) => `[${id}] ${content}`).join('\n')
        : 'No saved memories.';
    },
    {
      name: 'read_memory',
      description: 'Read important information previously saved about the user.',
      schema: z.object({}),
    },
  );

  const saveMemory = tool(
    async ({ memory }) => {
      const userId = await getUserId();
      const normalized = normalizeMemory(memory);
      const memories = await loadMemories(userId);
      if (memories.length >= MAX_MEMORIES) {
        return 'Memory limit reached; edit or delete an existing memory first.';
      }
      if (memories.some((item) => item.content === normalized)) {
        return 'That memory is already saved.';
      }

      await dbService.saveMemory(userId, normalized);
      await store.mset([[userId, await dbService.getMemories(userId)]]);
      return 'Memory saved.';
    },
    {
      name: 'save_memory',
      description:
        'Save important user information that may help in future sessions. Do not save passwords, secrets, or inferred diagnoses.',
      schema: z.object({
        memory: z.string().min(1).max(MAX_MEMORY_LENGTH).describe('One concise fact to remember'),
      }),
    },
  );

  const editMemory = tool(
    async ({ id, memory }) => {
      const userId = await getUserId();
      await dbService.updateMemory(userId, id, normalizeMemory(memory));
      await store.mset([[userId, await dbService.getMemories(userId)]]);
      return 'Memory updated.';
    },
    {
      name: 'edit_memory',
      description: 'Correct an existing saved memory using its ID from read_memory.',
      schema: z.object({
        id: z.string().min(1),
        memory: z.string().min(1).max(MAX_MEMORY_LENGTH),
      }),
    },
  );

  const deleteMemory = tool(
    async ({ id }) => {
      const userId = await getUserId();
      await dbService.deleteMemory(userId, id);
      await store.mset([[userId, await dbService.getMemories(userId)]]);
      return 'Memory deleted.';
    },
    {
      name: 'delete_memory',
      description: 'Delete an incorrect or unwanted saved memory using its ID from read_memory.',
      schema: z.object({ id: z.string().min(1) }),
    },
  );

  return [readMemory, saveMemory, editMemory, deleteMemory];
}

function normalizeMemory(memory: string): string {
  return memory.trim().replace(/\s+/g, ' ');
}
