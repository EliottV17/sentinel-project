import { getCorsOptions } from './cors-options';

describe('getCorsOptions', () => {
  it.each([
    'https://localhost',
    'https://status.example.com',
    'http://localhost:5173',
  ])('accepts valid production origin %s', (origins) => {
    expect(getCorsOptions(origins, 'production')).toEqual({
      origin: [origins],
      credentials: true,
    });
  });

  it.each(['', '   ', ',,,', 'https://one.example.com,*'])('rejects invalid production origins %s', (origins) => {
    expect(() => getCorsOptions(origins, 'production')).toThrow(/CORS_ORIGINS/);
  });

  it.each([
    'https://example.com/path',
    'ftp://example.com',
    'not an origin',
    'https://user:pass@example.com',
    'https://example.com, ,',
  ])('rejects malformed production origin list %s', (origins) => {
    expect(() => getCorsOptions(origins, 'production')).toThrow(/CORS_ORIGINS/);
  });

  it('preserves development wildcard fallback and comma-separated behavior', () => {
    expect(getCorsOptions('', 'development')).toEqual({
      origin: '*',
      credentials: true,
    });
    expect(getCorsOptions(' https://localhost, ,http://localhost:5173 ', 'test')).toEqual({
      origin: ['https://localhost', 'http://localhost:5173'],
      credentials: true,
    });
  });
});
