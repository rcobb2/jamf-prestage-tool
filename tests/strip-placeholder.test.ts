import { stripPlaceholder } from '../server/utils.ts';

describe('stripPlaceholder', () => {
  it("converts the 'N/A' display placeholder to an empty string", () => {
    // Without this, editing any one field PUTs "N/A" into every empty preload field.
    expect(stripPlaceholder('N/A')).toBe('');
  });

  it('converts null and undefined to an empty string', () => {
    expect(stripPlaceholder(null)).toBe('');
    expect(stripPlaceholder(undefined)).toBe('');
  });

  it('passes real values through untouched', () => {
    expect(stripPlaceholder('zcollins')).toBe('zcollins');
    expect(stripPlaceholder('05574')).toBe('05574');
    expect(stripPlaceholder('Lawr')).toBe('Lawr');
  });

  it('leaves an already-empty string alone', () => {
    expect(stripPlaceholder('')).toBe('');
  });

  it('only matches the exact placeholder, not values containing it', () => {
    expect(stripPlaceholder('N/A Building')).toBe('N/A Building');
    expect(stripPlaceholder('n/a')).toBe('n/a');
  });

  it('does not coerce falsy non-placeholder values', () => {
    // A room literally named "0" must survive; `||` would have eaten it.
    expect(stripPlaceholder(0)).toBe(0);
    expect(stripPlaceholder(false)).toBe(false);
  });
});
