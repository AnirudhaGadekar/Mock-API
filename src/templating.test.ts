import { describe, expect, it } from 'vitest';
import { renderTemplate } from './lib/templateEngine.js';

function makeContext(overrides?: Partial<Parameters<typeof renderTemplate>[1]>) {
  return {
    body: {
      title: 'Buy milk',
      done: false,
      id: 5,
    },
    headers: {
      authorization: 'Bearer test-token',
    },
    query: {
      page: '3',
    },
    params: {
      id: '5',
    },
    ...overrides,
  };
}

describe('templateEngine', () => {
  it('renders POST body echo', () => {
    const result = renderTemplate('{{body}}', makeContext());

    expect(result.error).toBe(false);
    expect(result.rendered).toBe('{"title":"Buy milk","done":false,"id":5}');
  });

  it('renders body field values', () => {
    const result = renderTemplate('{{body "id"}}', makeContext({ body: { id: 5 } }));

    expect(result.error).toBe(false);
    expect(result.rendered).toBe('5');
  });

  it('renders header values', () => {
    const result = renderTemplate('{{header "authorization"}}', makeContext());

    expect(result.error).toBe(false);
    expect(result.rendered).toBe('Bearer test-token');
  });

  it('renders query param values', () => {
    const result = renderTemplate('{{queryParam "page"}}', makeContext());

    expect(result.error).toBe(false);
    expect(result.rendered).toBe('3');
  });

  it('renders UUIDs', () => {
    const result = renderTemplate('{{uuid}}', makeContext());

    expect(result.error).toBe(false);
    expect(result.rendered).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('renders ISO timestamps', () => {
    const result = renderTemplate('{{timestamp}}', makeContext());

    expect(result.error).toBe(false);
    expect(Number.isNaN(Date.parse(result.rendered))).toBe(false);
    expect(result.rendered).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('renders faker values', () => {
    const result = renderTemplate('{{faker "person.firstName"}}', makeContext());

    expect(result.error).toBe(false);
    expect(result.rendered.trim().length).toBeGreaterThan(0);
  });

  it('renders repeat blocks as arrays', () => {
    const result = renderTemplate('{{#repeat 3}}{"index":{{@index}}}{{/repeat}}', makeContext());

    expect(result.error).toBe(false);
    expect(JSON.parse(result.rendered)).toEqual([
      { index: 0 },
      { index: 1 },
      { index: 2 },
    ]);
  });

  it('returns 561 payloads for broken templates', () => {
    const result = renderTemplate('{{{{broken}}}}', makeContext());

    expect(result.error).toBe(true);
    expect(result.rendered).toContain('"code":561');
  });

  it('handles GET requests with no body', () => {
    const result = renderTemplate('{{body}}', makeContext({ body: {} }));

    expect(result.error).toBe(false);
    expect(result.rendered).toBe('{}');
  });
});
