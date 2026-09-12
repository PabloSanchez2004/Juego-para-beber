import {
  describeResolvedGuess,
  formatGuessTyping,
  magnitudeOf,
  parseGuessCoefficient,
  resolveGuess,
} from './number-format';

describe('number-format', () => {
  it('inserts thousand dots while typing', () => {
    expect(formatGuessTyping('1000')).toBe('1.000');
    expect(formatGuessTyping('1000000')).toBe('1.000.000');
    expect(formatGuessTyping('1.000')).toBe('1.000');
  });

  it('keeps a Spanish decimal comma', () => {
    expect(formatGuessTyping('12,5')).toBe('12,5');
    expect(formatGuessTyping('1234,56')).toBe('1.234,56');
  });

  it('parses coefficient ignoring thousand dots', () => {
    expect(parseGuessCoefficient('1.000')).toBe(1000);
    expect(parseGuessCoefficient('1.234,5')).toBe(1234.5);
    expect(parseGuessCoefficient('-20')).toBe(-20);
  });

  it('resolves 1 millón as 1.000.000', () => {
    expect(resolveGuess('1', magnitudeOf('millions').factor)).toBe(1_000_000);
    expect(describeResolvedGuess('1', magnitudeOf('millions'))).toContain('1.000.000');
  });

  it('resolves miles de millones and billones', () => {
    expect(resolveGuess('2', magnitudeOf('billions').factor)).toBe(2_000_000_000);
    expect(resolveGuess('1', magnitudeOf('trillions').factor)).toBe(1_000_000_000_000);
  });
});
