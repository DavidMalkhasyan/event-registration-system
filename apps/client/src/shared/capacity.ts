// Event capacity input (K-707, amendment A-2): 1 to 100 000 seats, and after creation never lower than
// the current capacity. The forms correct a value when the field is left or the form is submitted,
// never while the organizer is typing; blank stays allowed while editing. The server enforces the same
// rules (422 for values outside the range, 409 for a decrease).

export const CAPACITY_MIN = 1;
export const CAPACITY_MAX = 100_000;

export interface CapacityCheck {
  /** The value the field should show. */
  value: string;
  /** Why the value was corrected. */
  note?: string;
  /** Why the value can't be used (it is left as typed). */
  error?: string;
}

const seats = (n: number) => `${n.toLocaleString('en-GB')} ${n === 1 ? 'seat' : 'seats'}`;

/** Normalizes a typed capacity: clamps whole numbers into [min, 100 000]; refuses fractions. */
export function normalizeCapacity(raw: string, min = CAPACITY_MIN): CapacityCheck {
  const text = raw.trim();
  if (text === '') return { value: raw };
  const n = Number(text);
  if (!Number.isFinite(n)) return { value: raw, error: 'Enter a whole number of seats.' };
  if (!Number.isInteger(n)) return { value: raw, error: 'Enter a whole number of seats, without decimals.' };
  if (n > CAPACITY_MAX)
    return {
      value: String(CAPACITY_MAX),
      note: `The maximum is ${seats(CAPACITY_MAX)}, so the value was set to ${CAPACITY_MAX.toLocaleString('en-GB')}.`,
    };
  if (n < min)
    return {
      value: String(min),
      note:
        min > CAPACITY_MIN
          ? `Capacity can only be increased. The current capacity is ${seats(min)}, so the value was set back to ${min.toLocaleString('en-GB')}.`
          : 'The minimum is 1 seat, so the value was set to 1.',
    };
  return { value: String(n) };
}
