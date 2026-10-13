import { describe, expect, it } from 'vitest';
import {
  EMPTY_LOCATION,
  addressLine,
  directionsUrl,
  draftOf,
  openStreetMapUrl,
  payloadOf,
  sameLocation,
  type Location,
} from './location';

// K-711: the location form's checks and the directions links (only the venue's public address or the
// organizer's coordinates go into them; nothing is guessed).

const HALL: Location = {
  venueName: 'Riverside Hall',
  streetAddress: '12 Mill Lane',
  city: 'Yerevan',
  region: null,
  postalCode: '0010',
  country: 'Armenia',
  arrivalInstructions: null,
  coordinates: null,
};

describe('payloadOf', () => {
  it('sends nothing for an empty form and refuses an incomplete one', () => {
    expect(payloadOf(EMPTY_LOCATION)).toEqual({ payload: null });
    expect(payloadOf({ ...EMPTY_LOCATION, city: 'Yerevan' })).toEqual({
      error: 'A location needs the venue name, street address, city and country.',
    });
  });

  it('trims, turns empty optional fields into null and never invents coordinates', () => {
    const result = payloadOf({ ...draftOf(HALL), venueName: '  Riverside Hall ', region: '  ' });
    expect(result).toEqual({
      payload: {
        venueName: 'Riverside Hall',
        streetAddress: '12 Mill Lane',
        city: 'Yerevan',
        region: null,
        postalCode: '0010',
        country: 'Armenia',
        arrivalInstructions: null,
        latitude: null,
        longitude: null,
      },
    });
  });

  it('needs both coordinates as numbers in range; accepts a decimal comma', () => {
    const base = draftOf(HALL);
    expect(payloadOf({ ...base, latitude: '40.17' })).toHaveProperty('error');
    expect(payloadOf({ ...base, latitude: 'north', longitude: '44' })).toHaveProperty('error');
    expect(payloadOf({ ...base, latitude: '91', longitude: '44' })).toHaveProperty('error');
    expect(payloadOf({ ...base, latitude: '40,177628', longitude: '44.512546' })).toMatchObject({
      payload: { latitude: 40.177628, longitude: 44.512546 },
    });
  });

  it('recognizes an unchanged location', () => {
    const result = payloadOf(draftOf(HALL));
    expect('payload' in result && sameLocation(HALL, result.payload)).toBe(true);
    expect(sameLocation(null, null)).toBe(true);
    expect(sameLocation(HALL, null)).toBe(false);
  });
});

describe('links', () => {
  it('builds the address line and links from the address, or from the coordinates when given', () => {
    expect(addressLine(HALL)).toBe('12 Mill Lane, 0010 Yerevan, Armenia');
    expect(directionsUrl(HALL)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Riverside%20Hall%2C%2012%20Mill%20Lane%2C%200010%20Yerevan%2C%20Armenia',
    );
    expect(openStreetMapUrl(HALL)).toBe(
      'https://www.openstreetmap.org/search?query=12%20Mill%20Lane%2C%200010%20Yerevan%2C%20Armenia',
    );
    const pinned = { ...HALL, coordinates: { latitude: 40.177628, longitude: 44.512546 } };
    expect(directionsUrl(pinned)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=40.177628%2C44.512546',
    );
    expect(openStreetMapUrl(pinned)).toBe(
      'https://www.openstreetmap.org/?mlat=40.177628&mlon=44.512546#map=17/40.177628/44.512546',
    );
  });
});
