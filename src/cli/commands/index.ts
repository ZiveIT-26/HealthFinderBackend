import { randomUUID } from 'node:crypto';
import type { ChatSessionService } from '../../services/llm/chat-session.service.js';
import type { DbService } from '../../services/db/db.service.js';
import type { Renderer } from '../render/renderer.js';


export const DEBUG_SECTIONS = ['triage', 'tools', 'context', 'tokens'] as const;
export type DebugSection = (typeof DEBUG_SECTIONS)[number];

export type CliState = {
  sessionId?: string;
  userId: string;
  debug: Set<DebugSection>;
};

export type CommandContext = {
  state: CliState;
  chat: ChatSessionService;
  db: DbService;
  out: Renderer;
};

type Command = {
  name: string;
  usage: string;
  description: string;
  run: (args: string[], ctx: CommandContext) => Promise<'quit' | void> | 'quit' | void;
};

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const COMMANDS: Command[] = [
  {
    name: 'help',
    usage: '/help',
    description: 'show commands',
    run: (_args, { out }) => {
      for (const command of COMMANDS) {
        out.info(`  ${command.usage.padEnd(26)} ${command.description}`);
      }
    },
  },
  {
    name: 'new',
    usage: '/new',
    description: 'start a new conversation',
    run: (_args, { state, out }) => {
      state.sessionId = undefined;
      out.info('(new conversation)');
    },
  },
  {
    name: 'session',
    usage: '/session [id]',
    description: 'show the current session or continue a saved one',
    run: async (args, { state, db, out }) => {
      const id = args[0];
      if (!id) {
        out.info(`session: ${state.sessionId ?? '(none yet — starts with your first message)'}`);
        if (state.sessionId) {
          const title = await db.getSessionTitle(state.sessionId);
          out.info(`title: ${title ?? '(no title yet)'}`);
        }
        return;
      }
      if (!UUID.test(id)) {
        out.error('session id must be a UUID');
        return;
      }
      state.sessionId = id;
      out.info(`(continuing session ${id}; history is loaded from the database)`);
    },
  },
  {
    name: 'history',
    usage: '/history',
    description: 'messages saved in the database for this session',
    run: async (_args, { state, chat, out }) => {
      if (!state.sessionId) {
        out.info('(no session yet)');
        return;
      }
      out.history(await chat.getHistory(state.sessionId));
    },
  },
  {
    name: 'sessions',
    usage: '/sessions',
    description: 'conversations of the current user, newest first',
    run: async (_args, { state, db, out }) => {
      const sessions = await db.listSessions(state.userId);
      if (sessions.length === 0) {
        out.info('(no conversations for this user)');
        return;
      }
      for (const session of sessions) {
        const marker = session.id === state.sessionId ? '*' : ' ';
        const created = new Date(session.createdAt).toISOString().slice(0, 16).replace('T', ' ');
        out.info(`${marker} ${session.id}  ${created}  ${session.title ?? '(no title)'}`);
      }
      out.info('(continue one with /session <id>)');
    },
  },
  {
    name: 'title',
    usage: '/title [new title]',
    description: 'show or rename the current conversation',
    run: async (args, { state, chat, db, out }) => {
      if (!state.sessionId) {
        out.info('(no session yet)');
        return;
      }
      const title = args.join(' ').trim();
      if (!title) {
        out.info(`title: ${(await db.getSessionTitle(state.sessionId)) ?? '(no title yet)'}`);
        return;
      }
      if (title.length > 100) {
        out.error('title is too long (max 100 characters)');
        return;
      }
      await chat.renameSession(state.sessionId, title, state.userId);
      out.info(`(renamed to "${title}")`);
    },
  },
  {
    name: 'user',
    usage: '/user [id|new]',
    description: 'show the current user, switch to another one, or make a random one',
    run: (args, { state, out }) => {
      const arg = args[0];
      if (!arg) {
        out.info(`user: ${state.userId}`);
        return;
      }
      const id = arg === 'new' ? randomUUID() : arg;
      if (!UUID.test(id)) {
        out.error('user id must be a UUID (or "new")');
        return;
      }
      state.userId = id;
      state.sessionId = undefined;
      out.info(`(now user ${id}; new conversation)`);
    },
  },
  {
    name: 'memories',
    usage: '/memories',
    description: 'what the agent remembers about the current user',
    run: async (_args, { state, db, out }) => {
      const memories = await db.getMemories(state.userId);
      if (memories.length === 0) {
        out.info('(no memories for this user)');
        return;
      }
      for (const memory of memories) {
        out.info(`  #${memory.id} ${memory.content}`);
      }
    },
  },
  {
    name: 'debug',
    usage: `/debug [on|off|${DEBUG_SECTIONS.join('|')}]`,
    description: 'toggle all debug output, or one section',
    run: (args, { state, out }) => {
      const arg = args[0];
      if (arg && (DEBUG_SECTIONS as readonly string[]).includes(arg)) {
        toggle(state, arg as DebugSection);
      }
      else if (arg === 'on' || (!arg && state.debug.size < DEBUG_SECTIONS.length)) {
        DEBUG_SECTIONS.forEach((section) => state.debug.add(section));
      }
      else if (arg === 'off' || !arg) {
        state.debug.clear();
      }
      else {
        out.error(`unknown debug section "${arg}"`);
        return;
      }
      out.info(`debug: ${state.debug.size > 0 ? [...state.debug].join(', ') : 'off'}`);
    },
  },
  {
    name: 'triage',
    usage: '/triage',
    description: 'toggle triage output (level, red flags, reasons)',
    run: (_args, { state, out }) => {
      toggle(state, 'triage');
      out.info(`triage output: ${state.debug.has('triage') ? 'on' : 'off'}`);
    },
  },
  {
    name: 'quit',
    usage: '/quit',
    description: 'exit (Ctrl+C works too)',
    run: () => 'quit',
  },
];

function toggle(state: CliState, section: DebugSection): void {
  if (state.debug.has(section)) state.debug.delete(section);
  else state.debug.add(section);
}

export async function runCommand(line: string, ctx: CommandContext): Promise<'quit' | void> {
  const [name, ...args] = line.slice(1).trim().split(/\s+/);
  const command = COMMANDS.find((candidate) => candidate.name === name);
  if (!command) {
    ctx.out.error(`unknown command /${name} — try /help`);
    return;
  }
  try {
    return await command.run(args, ctx);
  } catch (error) {
    // e.g. /title on another user's session, or the database is down: report, keep the CLI running
    ctx.out.error(error instanceof Error ? error.message : String(error));
  }
}
