import { describe, it, expect } from 'vitest';
import { _normalizeBullets as normalizeBullets } from '../../src/lib/markdown';

describe('normalizeBullets', () => {
  it('converts • to list syntax', () => {
    expect(normalizeBullets('• item one\n• item two')).toBe('- item one\n- item two');
  });

  it('converts other bullet characters (◦ ▪ ▸ ‣)', () => {
    expect(normalizeBullets('◦ sub\n▪ sub\n▸ sub\n‣ sub')).toBe('- sub\n- sub\n- sub\n- sub');
  });

  it('preserves indentation', () => {
    expect(normalizeBullets('  • nested\n    • deeper')).toBe('  - nested\n    - deeper');
  });

  it('leaves normal text untouched', () => {
    const text = 'No bullets here.\nJust regular text.';
    expect(normalizeBullets(text)).toBe(text);
  });

  it('does not convert bullets inside fenced code blocks', () => {
    const text = '• outside\n```\n• inside code\n```\n• outside again';
    expect(normalizeBullets(text)).toBe('- outside\n```\n• inside code\n```\n- outside again');
  });

  it('does not convert bullets inside ~~~ code blocks', () => {
    const text = '~~~\n• inside\n~~~';
    expect(normalizeBullets(text)).toBe('~~~\n• inside\n~~~');
  });

  it('does not convert bullets inside $$ math blocks', () => {
    const text = '• before\n$$\n• in math\n$$\n• after';
    expect(normalizeBullets(text)).toBe('- before\n$$\n• in math\n$$\n- after');
  });

  it('handles unclosed code block (protects to end of text)', () => {
    const text = '• before\n```\n• inside unclosed';
    expect(normalizeBullets(text)).toBe('- before\n```\n• inside unclosed');
  });

  it('handles bullet mid-line (no conversion)', () => {
    const text = 'This has a • bullet in the middle';
    expect(normalizeBullets(text)).toBe(text);
  });
});
