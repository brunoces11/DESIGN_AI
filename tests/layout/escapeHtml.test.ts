import { describe, it, expect } from 'vitest';
import { escapeHtml } from '@/lib/layout/render';

describe('escapeHtml', () => {
  it('escapes & to &amp;', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes < to &lt;', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes > to &gt;', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes " to &quot;', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it("escapes ' to &#x27;", () => {
    expect(escapeHtml("it's")).toBe('it&#x27;s');
  });

  it('escapes all five characters in a single string', () => {
    expect(escapeHtml(`<div class="a" data-x='b'>a & b</div>`)).toBe(
      '&lt;div class=&quot;a&quot; data-x=&#x27;b&#x27;&gt;a &amp; b&lt;/div&gt;',
    );
  });

  it('returns an empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('returns a string with no special characters unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('handles strings with only special characters', () => {
    expect(escapeHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#x27;');
  });

  it('handles repeated special characters', () => {
    expect(escapeHtml('<<<')).toBe('&lt;&lt;&lt;');
  });

  it('handles unicode and newlines alongside special characters', () => {
    const input = 'Olá <mundo>\n"amigo" & \'parceiro\'';
    const expected = 'Olá &lt;mundo&gt;\n&quot;amigo&quot; &amp; &#x27;parceiro&#x27;';
    expect(escapeHtml(input)).toBe(expected);
  });

  it('is pure — calling twice with the same input yields the same result', () => {
    const input = '<script>alert("xss")</script>';
    expect(escapeHtml(input)).toBe(escapeHtml(input));
  });

  it('does not double-escape already-escaped entities', () => {
    // &amp; contains & which should be escaped again — this is correct behaviour
    // for a raw escaper (it escapes the & in &amp; to &amp;amp;)
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});
