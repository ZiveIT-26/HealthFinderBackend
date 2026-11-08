import type { ChatSessionService } from '../../services/llm/chat-session.service.js';
import type { Renderer } from '../render/renderer.js';
import { parseUserLocation, type UserLocation } from '../../services/llm/user-location.js';


export const DEBUG_SECTIONS = ['triage', 'tools', 'context', 'tokens'] as const;
export type DebugSection = (typeof DEBUG_SECTIONS)[number];

export type CliState = {
  sessionId?: string;
  location?: UserLocation;
  debug: Set<DebugSection>;
};

export type CommandContext = {
  state: CliState;
  chat: ChatSessionService;
  out: Renderer;
};

type Command = {
  name: string;
  usage: string;
  description: string;
  run: (args: string[], ctx: CommandContext) => Promise<'quit' | void> | 'quit' | void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    run: (args, { state, out }) => {
      const id = args[0];
      if (!id) {
        out.info(`session: ${state.sessionId ?? '(none yet — starts with your first message)'}`);
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
    name: 'location',
    usage: '/location [lat lon|off]',
    description: 'set your coordinates (default: Košice centre)',
    run: (args, { state, out }) => {
      if (args[0] === 'off') {
        state.location = undefined;
      } else if (args.length >= 2) {
        const location = parseUserLocation({ lat: args[0], lon: args[1] });
        if (!location) {
          out.error('usage: /location 48.72 21.25');
          return;
        }
        state.location = location;
      }
      out.info(
        `location: ${state.location ? `${state.location.lat}, ${state.location.lon}` : 'default (Košice centre)'}`,
      );
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
  return command.run(args, ctx);
}
