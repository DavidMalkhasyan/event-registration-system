import { expect, type Browser, type Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_MAILBOX, ORIGIN } from './env.js';

interface Mail {
  to: string;
  subject: string;
  text: string;
}

export const ZONE = 'Europe/Berlin'; // matches timezoneId in playwright.config.ts
export const HOUR = 3_600_000;

/** A unique address per test run, so mailbox lookups never see another run's emails. */
export function address(name: string): string {
  return `${name}.${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}@example.test`;
}

function readMail(): Mail[] {
  if (!existsSync(E2E_MAILBOX)) return [];
  return readdirSync(E2E_MAILBOX)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(E2E_MAILBOX, f), 'utf8')) as Mail);
}

export function mailFor(to: string, subjectPrefix: string): Mail[] {
  return readMail().filter((m) => m.to === to && m.subject.startsWith(subjectPrefix));
}

/** Waits until the worker has delivered matching emails to the fake provider's mailbox. */
export async function waitForMail(to: string, subjectPrefix: string, count = 1): Promise<Mail[]> {
  await expect
    .poll(() => mailFor(to, subjectPrefix).length, {
      timeout: 20_000,
      message: `"${subjectPrefix}" email to ${to}`,
    })
    .toBeGreaterThanOrEqual(count);
  return mailFor(to, subjectPrefix);
}

/** Extracts an emailed link such as http://localhost:3100/verify#t=… */
export function linkIn(mail: Mail, path: string): string {
  const match = new RegExp(`${ORIGIN}/${path}#t=[A-Za-z0-9_-]+`).exec(mail.text);
  if (!match) throw new Error(`no /${path} link in "${mail.subject}"`);
  return match[0];
}

/** "YYYY-MM-DDTHH:mm" in ZONE, `ms` from now (the value a datetime-local input takes). */
export function localIn(ms: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(Date.now() + ms))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Organizer sign-in through the UI and the emailed link (passwordless). */
export async function signIn(page: Page, email: string): Promise<void> {
  const before = mailFor(email, 'Your sign-in link').length;
  await page.goto('/organizer');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  await expect(page.getByText('Check your email for a sign-in link')).toBeVisible();
  const mails = await waitForMail(email, 'Your sign-in link', before + 1);
  await page.goto(linkIn(mails[mails.length - 1]!, 'sign-in'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The global dashboard of all the organizer's events (K-507).
  await expect(page.getByRole('heading', { level: 1, name: 'Good things happen together.' })).toBeVisible();
}

/** Creates an event through the form, which opens the new event's workspace. */
export async function createEvent(
  page: Page,
  input: { title: string; capacity: number; startsInMs: number },
): Promise<{ eventId: string; publicUrl: string }> {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Create event' })
    .click();
  const [date, time] = localIn(input.startsInMs).split('T');
  await page.getByLabel('Event title').fill(input.title);
  await page.getByLabel('Description').fill('Created by the end-to-end test.');
  await page.getByLabel('Date', { exact: true }).fill(date!);
  await page.getByLabel('Start time').fill(time!);
  await page.getByLabel('Capacity').fill(String(input.capacity));
  await page.getByRole('button', { name: 'Create event' }).click();
  await page.waitForURL(/\/organizer\/events\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: input.title })).toBeVisible();
  const eventId = /\/organizer\/events\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  const publicUrl = await page.getByLabel('Public registration link').inputValue();
  return { eventId, publicUrl };
}

/** Registers on the public page and opens the emailed verification link, up to the confirm button. */
export async function openVerification(page: Page, publicUrl: string, email: string): Promise<void> {
  await page.goto(publicUrl);
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText('Check your email.')).toBeVisible();
  const [mail] = await waitForMail(email, 'Confirm your registration');
  await page.goto(linkIn(mail!, 'verify'));
  await expect(page.getByRole('button', { name: 'Confirm my registration' })).toBeVisible();
}

const RESULT_HEADING = /You are (registered|on the waiting list)/;

export async function readResult(
  page: Page,
): Promise<{ result: 'confirmed' | 'waitlisted'; ticketCode?: string }> {
  const heading = page.getByRole('heading', { name: RESULT_HEADING });
  await expect(heading).toBeVisible();
  if ((await heading.textContent()) !== 'You are registered') return { result: 'waitlisted' };
  return { result: 'confirmed', ticketCode: (await page.locator('.ticket-code').textContent()) ?? undefined };
}

/** A full participant registration in its own browser context (its own cookies and storage). */
export async function registerParticipant(browser: Browser, publicUrl: string, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openVerification(page, publicUrl, email);
  await page.getByRole('button', { name: 'Confirm my registration' }).click();
  const result = await readResult(page);
  await context.close();
  return result;
}

/** Opens a section of the event workspace (Overview, Participants, Waiting list, Check-in, Staff, Settings). */
export async function openSection(page: Page, name: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Event sections' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
  await expect(
    page
      .getByRole('navigation', { name: 'Event sections' })
      .getByRole('link', { name: new RegExp(`^${name}`) }),
  ).toHaveAttribute('aria-current', 'page');
}

/** The heading of the latest check-in result ("Checked in", "Already checked in", …). */
export function checkInResult(page: Page) {
  return page.getByRole('status', { name: 'Check-in result' }).getByRole('heading');
}

/** The number shown on a dashboard statistic tile. */
export function stat(page: Page, label: string) {
  return page.locator('.stat', { hasText: label }).locator('strong');
}
