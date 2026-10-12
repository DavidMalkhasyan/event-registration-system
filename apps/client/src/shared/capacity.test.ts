import { describe, expect, it } from 'vitest';
import { CAPACITY_MAX, normalizeCapacity } from './capacity';

// K-707 (amendment A-2): capacity normalization in the forms.

describe('normalizeCapacity (K-707)', () => {
  it('keeps whole numbers in range as they are (without leading zeros or spaces)', () => {
    expect(normalizeCapacity('1')).toEqual({ value: '1' });
    expect(normalizeCapacity(' 250 ')).toEqual({ value: '250' });
    expect(normalizeCapacity('007')).toEqual({ value: '7' });
    expect(normalizeCapacity('100000')).toEqual({ value: '100000' });
  });

  it('sets values above the maximum to 100 000, with a note', () => {
    const r = normalizeCapacity('250000');
    expect(r.value).toBe(String(CAPACITY_MAX));
    expect(r.note).toBe('The maximum is 100,000 seats, so the value was set to 100,000.');
    expect(normalizeCapacity('1e9').value).toBe('100000');
  });

  it('sets zero and negative values to the minimum, with a note', () => {
    expect(normalizeCapacity('0')).toEqual({
      value: '1',
      note: 'The minimum is 1 seat, so the value was set to 1.',
    });
    expect(normalizeCapacity('-12').value).toBe('1');
  });

  it('refuses fractions instead of rounding them, and leaves the typed value', () => {
    expect(normalizeCapacity('2.5')).toEqual({
      value: '2.5',
      error: 'Enter a whole number of seats, without decimals.',
    });
    expect(normalizeCapacity('-0.5').error).toBeDefined();
  });

  it('allows a blank field while editing', () => {
    expect(normalizeCapacity('')).toEqual({ value: '' });
    expect(normalizeCapacity('  ')).toEqual({ value: '  ' });
  });

  it('never goes below the current capacity when editing an event', () => {
    expect(normalizeCapacity('3', 40)).toEqual({
      value: '40',
      note: 'Capacity can only be increased. The current capacity is 40 seats, so the value was set back to 40.',
    });
    expect(normalizeCapacity('41', 40)).toEqual({ value: '41' });
    expect(normalizeCapacity('999999', 40).value).toBe('100000');
  });
});
