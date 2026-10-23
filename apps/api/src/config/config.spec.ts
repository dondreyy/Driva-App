import { loadConfig } from './config';

describe('loadConfig', () => {
  it('reads DATABASE_URL and PORT', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x', PORT: '4000' })).toEqual({
      databaseUrl: 'postgres://x',
      port: 4000,
    });
  });

  it('fails fast without DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
