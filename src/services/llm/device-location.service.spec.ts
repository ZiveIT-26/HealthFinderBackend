import { loadLlmConfig } from '../../config/llm.config.js';
import { DeviceLocationService, parseSharedLocation } from './device-location.service.js';
import { createRequestLocationTool } from './tools/request-location.tool.js';

const SESSION = 'session-1';
const USER = 'user-1';
const kosice = { lat: 48.7164, lon: 21.2611, source: 'current' as const, label: 'Košice' };

describe('DeviceLocationService', () => {
  it('a request waits for the answer and remembers it for the reply', async () => {
    const service = new DeviceLocationService();
    const access = service.forSession(SESSION, USER);

    const request = access.ask();
    expect(request.isNew).toBe(true);
    expect(service.answer(request.requestId, USER, kosice)).toBe(true);

    await expect(request.reply).resolves.toEqual({ kind: 'shared', location: kosice });
    expect(access.state()).toEqual({ status: 'shared', location: kosice });
  });

  it('tools asking at the same time share one request', () => {
    const access = new DeviceLocationService().forSession(SESSION, USER);
    const first = access.ask();
    const second = access.ask();
    expect(second.isNew).toBe(false);
    expect(second.requestId).toBe(first.requestId);
  });

  it('another user cannot answer, and an answer counts once', () => {
    const service = new DeviceLocationService();
    const { requestId } = service.forSession(SESSION, USER).ask();

    expect(service.answer(requestId, 'someone-else', kosice)).toBe(false);
    expect(service.answer(requestId, USER, 'declined')).toBe(true);
    expect(service.answer(requestId, USER, kosice)).toBe(false);
    expect(service.state(SESSION)).toEqual({ status: 'declined' });
  });

  it('a new message forgets the location of the previous reply', () => {
    const service = new DeviceLocationService();
    service.remember(SESSION, kosice);
    service.remember('other-session', kosice);

    service.startReply(SESSION);
    expect(service.state(SESSION)).toEqual({ status: 'unknown' });
    expect(service.state('other-session')).toEqual({ status: 'shared', location: kosice });
  });

  it('gives up after the timeout', async () => {
    const service = new DeviceLocationService();
    service.timeoutMs = 10;
    const request = service.forSession(SESSION, USER).ask();

    await expect(request.reply).resolves.toEqual({ kind: 'unanswered' });
    expect(service.answer(request.requestId, USER, kosice)).toBe(false);
  });
});

describe('parseSharedLocation', () => {
  it('accepts valid coordinates and cleans the label', () => {
    expect(parseSharedLocation({ lat: 48.7, lon: 21.2, label: '  Košice \n I ' }, 'home')).toEqual({
      lat: 48.7,
      lon: 21.2,
      source: 'home',
      label: 'Košice I',
    });
  });

  it('rejects coordinates out of range or not numbers', () => {
    expect(parseSharedLocation({ lat: 91, lon: 21 }, 'current')).toBeUndefined();
    expect(parseSharedLocation({ lat: '48', lon: 21 }, 'current')).toBeUndefined();
    expect(parseSharedLocation(undefined, 'current')).toBeUndefined();
  });
});

describe('request_location tool', () => {
  const config = loadLlmConfig();

  it('answers from the current reply without asking again', async () => {
    const service = new DeviceLocationService();
    service.remember(SESSION, { ...kosice, source: 'home' });
    const tool = createRequestLocationTool(service.forSession(SESSION, USER), config);

    const text = String(await tool.invoke({}));
    expect(text).toContain('Košice');
    expect(text).toContain(config.requestLocation.sourceHome);
    expect(text).not.toContain('48.7164');
  });

  it('without an answer from the app it continues after the timeout', async () => {
    const service = new DeviceLocationService();
    service.timeoutMs = 10;
    const tool = createRequestLocationTool(service.forSession(SESSION, USER), config);

    expect(String(await tool.invoke({}))).toBe(config.requestLocation.unanswered);
  });
});
