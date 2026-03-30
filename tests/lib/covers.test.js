import { describe, it, expect } from 'vitest';
import { generateCoverGradient } from '../../src/lib/covers';

describe('generateCoverGradient', () => {
  it('returns a CSS gradient string', () => {
    const gradient = generateCoverGradient('test-book');
    expect(gradient).toContain('gradient');
    expect(gradient).toContain('linear-gradient');
    expect(gradient).not.toContain('undefined');
  });

  it('returns different gradients for different book IDs', () => {
    const a = generateCoverGradient('book-alpha');
    const b = generateCoverGradient('book-beta');
    expect(a).not.toBe(b);
  });

  it('returns stable output for same input', () => {
    const first = generateCoverGradient('stable-id');
    const second = generateCoverGradient('stable-id');
    expect(first).toBe(second);
  });

  it('handles empty/null input gracefully', () => {
    expect(generateCoverGradient('')).toContain('gradient');
    expect(generateCoverGradient(null)).toContain('gradient');
    expect(generateCoverGradient(undefined)).toContain('gradient');
  });

  it('does not generate invalid color tokens for known catalog ids', () => {
    expect(generateCoverGradient('deep-research-report')).not.toContain('undefined');
    expect(generateCoverGradient('designing-data-intensive-applications-2nd-edition')).not.toContain('undefined');
    expect(generateCoverGradient('progit')).not.toContain('undefined');
  });
});
