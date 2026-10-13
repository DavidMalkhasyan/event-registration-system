import { useState } from 'react';
import { Check, Copy, MapPin, Navigation } from 'lucide-react';
import { Field, buttonClass } from './ui';

// Event location (K-711, PD-91). Shown on the organizer, public, management and ticket pages. The
// directions links are ordinary links the visitor chooses to open: our pages load nothing from map
// sites, and the links carry only the venue's public address or coordinates, never a token or any
// participant data (link-page tokens live in the URL fragment, which browsers never send, and the
// pages' referrer policy is no-referrer).

export interface Location {
  venueName: string;
  streetAddress: string;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
  arrivalInstructions: string | null;
  coordinates: { latitude: number; longitude: number } | null;
}

export function addressLine(l: Location): string {
  return [l.streetAddress, [l.postalCode, l.city].filter(Boolean).join(' '), l.region, l.country]
    .filter(Boolean)
    .join(', ');
}

/** Google Maps directions to the venue (coordinates when the organizer gave them, else the address). */
export function directionsUrl(l: Location): string {
  const destination = l.coordinates
    ? `${l.coordinates.latitude},${l.coordinates.longitude}`
    : `${l.venueName}, ${addressLine(l)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/** The venue on OpenStreetMap: a marker at the coordinates, or a search for the address. */
export function openStreetMapUrl(l: Location): string {
  if (l.coordinates) {
    const { latitude: lat, longitude: lon } = l.coordinates;
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
  }
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(addressLine(l))}`;
}

/** The venue, its address and arrival instructions, with copy and directions actions. */
export function VenueDetails({ location, heading = 'Location' }: { location: Location; heading?: string }) {
  const [copied, setCopied] = useState(false);
  const full = `${location.venueName}, ${addressLine(location)}`;
  const copy = () => {
    void navigator.clipboard
      ?.writeText(full)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => setCopied(false));
  };
  return (
    <section className="venue" aria-label={heading}>
      <MapPin className="venue-icon" aria-hidden="true" />
      <div className="venue-body">
        <span className="eyebrow">{heading}</span>
        <strong className="venue-name">{location.venueName}</strong>
        <address>
          {location.streetAddress}
          <br />
          {[location.postalCode, location.city].filter(Boolean).join(' ')}
          {location.region ? `, ${location.region}` : ''}
          <br />
          {location.country}
        </address>
        {location.arrivalInstructions && <p className="venue-arrival">{location.arrivalInstructions}</p>}
        <div className="venue-actions">
          <a
            className={buttonClass('primary', 'sm')}
            href={directionsUrl(location)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Navigation size={15} aria-hidden="true" /> Get directions
          </a>
          <a
            className={buttonClass('outline', 'sm')}
            href={openStreetMapUrl(location)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MapPin size={15} aria-hidden="true" /> OpenStreetMap
          </a>
          <button type="button" className={buttonClass('ghost', 'sm')} onClick={copy}>
            {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
            {copied ? 'Address copied' : 'Copy address'}
          </button>
        </div>
        <p className="venue-note">
          Directions open on another site, which receives only the venue’s address.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- form

export interface LocationDraft {
  venueName: string;
  streetAddress: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  arrivalInstructions: string;
  latitude: string;
  longitude: string;
}

export const EMPTY_LOCATION: LocationDraft = {
  venueName: '',
  streetAddress: '',
  city: '',
  region: '',
  postalCode: '',
  country: '',
  arrivalInstructions: '',
  latitude: '',
  longitude: '',
};

export function draftOf(l: Location | null): LocationDraft {
  if (!l) return EMPTY_LOCATION;
  return {
    venueName: l.venueName,
    streetAddress: l.streetAddress,
    city: l.city,
    region: l.region ?? '',
    postalCode: l.postalCode ?? '',
    country: l.country,
    arrivalInstructions: l.arrivalInstructions ?? '',
    latitude: l.coordinates ? String(l.coordinates.latitude) : '',
    longitude: l.coordinates ? String(l.coordinates.longitude) : '',
  };
}

export type LocationPayload = {
  venueName: string;
  streetAddress: string;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
  arrivalInstructions: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * The API body for a draft: null for an empty form; an error when it is incomplete or the coordinates
 * are not numbers in range (the server checks the same).
 */
export function payloadOf(d: LocationDraft): { payload: LocationPayload | null } | { error: string } {
  const t = (s: string) => s.trim();
  if (Object.values(d).every((v) => !t(v))) return { payload: null };
  if (!t(d.venueName) || !t(d.streetAddress) || !t(d.city) || !t(d.country))
    return { error: 'A location needs the venue name, street address, city and country.' };
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (t(d.latitude) || t(d.longitude)) {
    latitude = Number(t(d.latitude).replace(',', '.'));
    longitude = Number(t(d.longitude).replace(',', '.'));
    if (!t(d.latitude) || !t(d.longitude) || !Number.isFinite(latitude) || !Number.isFinite(longitude))
      return { error: 'Give both latitude and longitude as decimal numbers, or leave both empty.' };
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
      return { error: 'Latitude is between −90 and 90, longitude between −180 and 180.' };
  }
  return {
    payload: {
      venueName: t(d.venueName),
      streetAddress: t(d.streetAddress),
      city: t(d.city),
      region: t(d.region) || null,
      postalCode: t(d.postalCode) || null,
      country: t(d.country),
      arrivalInstructions: t(d.arrivalInstructions) || null,
      latitude,
      longitude,
    },
  };
}

export function sameLocation(a: Location | null, b: LocationPayload | null): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.venueName === b.venueName &&
    a.streetAddress === b.streetAddress &&
    a.city === b.city &&
    a.region === b.region &&
    a.postalCode === b.postalCode &&
    a.country === b.country &&
    a.arrivalInstructions === b.arrivalInstructions &&
    (a.coordinates?.latitude ?? null) === b.latitude &&
    (a.coordinates?.longitude ?? null) === b.longitude
  );
}

export function LocationFields({
  value,
  onChange,
}: {
  value: LocationDraft;
  onChange: (next: LocationDraft) => void;
}) {
  const input = (
    key: keyof LocationDraft,
    label: string,
    opts: { max: number; auto?: string; hint?: string },
  ) => (
    <Field label={label} hint={opts.hint}>
      {(id) => (
        <input
          id={id}
          className="input"
          maxLength={opts.max}
          autoComplete={opts.auto ?? 'off'}
          value={value[key]}
          onChange={(e) => onChange({ ...value, [key]: e.target.value })}
        />
      )}
    </Field>
  );
  return (
    <div className="location-fields">
      {input('venueName', 'Venue name', { max: 200 })}
      {input('streetAddress', 'Street address', { max: 300, auto: 'street-address' })}
      <div className="location-row">
        {input('postalCode', 'Postal code (optional)', { max: 20, auto: 'postal-code' })}
        {input('city', 'City', { max: 120, auto: 'address-level2' })}
      </div>
      <div className="location-row">
        {input('region', 'Region (optional)', { max: 120, auto: 'address-level1' })}
        {input('country', 'Country', { max: 120, auto: 'country-name' })}
      </div>
      <Field label="Arrival instructions (optional)" hint="For example the entrance, parking or the floor.">
        {(id) => (
          <textarea
            id={id}
            className="textarea"
            rows={2}
            maxLength={1000}
            value={value.arrivalInstructions}
            onChange={(e) => onChange({ ...value, arrivalInstructions: e.target.value })}
          />
        )}
      </Field>
      <div className="location-row">
        {input('latitude', 'Latitude (optional)', {
          max: 20,
          hint: 'Decimal degrees, for example 40.177628. Leave empty if you are not sure: it is never guessed.',
        })}
        {input('longitude', 'Longitude (optional)', { max: 20, hint: 'For example 44.512546.' })}
      </div>
    </div>
  );
}
