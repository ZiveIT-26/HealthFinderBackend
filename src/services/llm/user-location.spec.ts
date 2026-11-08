import { parseUserLocation } from './user-location.js';

describe('parseUserLocation', () => {
  it('accepts numbers and numeric strings', () => {
    expect(parseUserLocation({ lat: 48.72, lon: 21.25 })).toEqual({ lat: 48.72, lon: 21.25 });
    expect(parseUserLocation({ lat: '48.72', lon: '21.25' })).toEqual({ lat: 48.72, lon: 21.25 });
  });

  it.each([undefined, null, 'Košice', {}, { lat: 'x', lon: 1 }, { lat: 200, lon: 21 }])('ignores %j', (value) => {
    expect(parseUserLocation(value)).toBeUndefined();
  });
});
