import { AccountStateApi } from './support/fixtures';
import { captureDesign } from './support/screenshots';
import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import type { AppData, Trip } from '../src/lib/types';
import { validateAppData } from '../src/lib/validation';
import octoberItinerary from '../tests/fixtures/itineraries/oct2026.json' with { type: 'json' };

test.use({ actionTimeout: 30_000 });

const account = { id: 'lounge-traveler', name: 'Lounge traveler', email: 'lounges@example.com' };
const emptyData = (): AppData => ({
  schemaVersion: 1,
  preferences: { ...DEFAULT_PREFERENCES, planningMode: 'rules' },
  trips: [],
  selectedTripId: null,
});

/** Validate persisted lounge settings through the same boundary as the Worker. */
class LoungeAccountApi extends AccountStateApi {
  constructor() {
    super(account, { validate: (data) => expect(validateAppData(data)).toBeNull() });
    this.data = emptyData();
  }
}

async function openLounges(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: `${account.name}'s account menu` })).toBeVisible();
  await page.getByRole('button', { name: 'Lounges', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Lounge Explorer', exact: true })).toBeVisible();
}

function noHorizontalOverflow(page: Page) {
  return page.evaluate(
    () => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth,
  );
}

async function expectPreflightLoungeEntry(page: Page, flightId: string, departure: string) {
  const link = page.locator(`.flight-lounge-link[data-flight-id="${flightId}"]`);
  const lounge = page.locator('.journey-flight-marker[data-kind="lounge"]').filter({ has: link });
  const flight = page.locator(
    `.journey-flight-marker[data-flight-id="${flightId}"][data-phase="departure"]`,
  );
  await expect(lounge).toHaveCount(1);
  await expect(flight).toHaveCount(1);
  const start = Number(await lounge.getAttribute('data-start'));
  expect(start).toBeLessThan(Date.parse(departure));
  expect(start).toBeLessThan(Number(await flight.getAttribute('data-start')));
  // Read both rectangles in one frame, including while a date jump is animating.
  const positions = await page.locator('.journey-canvas').evaluate((canvas, id) => {
    const lounge = canvas
      .querySelector(`.flight-lounge-link[data-flight-id="${id}"]`)!
      .closest('.journey-flight-marker')!;
    const flight = canvas.querySelector(
      `.journey-flight-marker[data-flight-id="${id}"][data-phase="departure"]`,
    )!;
    return {
      loungeEnd: lounge.getBoundingClientRect().bottom,
      flightStart: flight.getBoundingClientRect().top,
    };
  }, flightId);
  expect(positions.loungeEnd).toBeLessThanOrEqual(positions.flightStart);
  return start;
}

async function expectScreenReaderTextHidden(page: Page) {
  const bounds = await page.locator('.lounge-membership-settings .sr-only').evaluateAll((labels) =>
    labels.map((label) => {
      const { width, height } = label.getBoundingClientRect();
      return { width, height };
    }),
  );
  expect(bounds.length).toBeGreaterThan(0);
  for (const { width, height } of bounds) {
    expect(width).toBeLessThanOrEqual(1);
    expect(height).toBeLessThanOrEqual(1);
  }
}

test('searched airline tiers and paid memberships save from Profile without duplicates or lost programs, and survive account reload', async ({
  page,
}) => {
  const api = new LoungeAccountApi();
  await api.install(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
  await openLounges(page);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit memberships', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Lounge memberships & airline status', exact: true }),
  ).toBeVisible();
  const priorityPass = page.getByRole('checkbox', { name: 'Priority Pass', exact: true });
  await priorityPass.check();

  const addStatus = page.getByRole('button', { name: 'Add airline status', exact: true });
  const search = page.getByRole('searchbox', { name: 'Search airline programs', exact: true });
  await addStatus.click();
  // Editing a paid membership while the picker is open must not unexpectedly
  // move keyboard focus back into the program search.
  await priorityPass.uncheck();
  await expect(priorityPass).toBeFocused();
  await priorityPass.check();
  await expect(priorityPass).toBeFocused();
  await search.fill('Qantas');
  await expect(page.locator('.loyalty-program-picker [role="status"]')).toHaveText(
    '1 matching program',
  );
  await expectScreenReaderTextHidden(page);
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page
    .locator('.lounge-membership-settings')
    .evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await captureDesign(page, 'artifacts/loyalty-settings-desktop-picker.png');
  await page.getByRole('button', { name: 'Add Qantas Frequent Flyer', exact: true }).click();
  const qantasStatus = page.getByRole('combobox', {
    name: 'Qantas Frequent Flyer status',
    exact: true,
  });
  await expect(qantasStatus).toBeFocused();
  await qantasStatus.selectOption('qantas-gold');
  await qantasStatus.selectOption('qantas-platinum');
  await expect(qantasStatus).toHaveValue('qantas-platinum');

  // A selected program gets an editable tier, rather than another checkbox
  // per tier or an opportunity to save conflicting statuses for one airline.
  await addStatus.click();
  await search.fill('Qantas');
  await expect(
    page.getByRole('button', { name: 'Add Qantas Frequent Flyer', exact: true }),
  ).toHaveCount(0);
  await search.press('Escape');
  await expect(addStatus).toBeFocused();
  await addStatus.click();
  await search.fill('United');
  const addUnited = page.getByRole('button', { name: 'Add United MileagePlus', exact: true });
  await search.press('ArrowDown');
  await expect(addUnited).toBeFocused();
  await addUnited.press('Enter');
  const unitedStatus = page.getByRole('combobox', {
    name: 'United MileagePlus status',
    exact: true,
  });
  await expect(unitedStatus).toBeFocused();
  await unitedStatus.selectOption('united-premier-1k');
  await expect(page.locator('.loyalty-status-row')).toHaveCount(2);
  await expect(qantasStatus).toHaveValue('qantas-platinum');
  await expect(priorityPass).toBeChecked();
  await expectScreenReaderTextHidden(page);
  await page
    .locator('.lounge-membership-settings')
    .evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await captureDesign(page, 'artifacts/loyalty-settings-desktop-selected.png');
  await expect(page.getByRole('button', { name: 'Save preferences', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect
    .poll(() => [...(api.data.preferences.loungeMemberships ?? [])].sort())
    .toEqual(['priority-pass', 'qantas-platinum', 'united-premier-1k']);
  await page.getByRole('button', { name: 'Lounges', exact: true }).first().click();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add airline status', exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('.lounge-membership-summary')).toContainText('Priority Pass');
  await expect(page.locator('.lounge-membership-summary')).toContainText('Qantas Platinum');
  await expect(page.locator('.lounge-membership-summary')).toContainText('Premier 1K');
  await page.getByRole('combobox', { name: 'Prioritise', exact: true }).selectOption('showers');
  await expect.poll(() => api.data.preferences.loungePriority).toBe('showers');
  expect(api.writes.length).toBeGreaterThan(0);
  expect(validateAppData(api.data)).toBeNull();
  await page.reload();
  await page.getByRole('button', { name: 'Lounges', exact: true }).first().click();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('.lounge-membership-summary')).toContainText('Priority Pass');
  await expect(page.locator('.lounge-membership-summary')).toContainText('Qantas Platinum');
  await expect(page.locator('.lounge-membership-summary')).toContainText('Premier 1K');
  await expect(page.getByRole('combobox', { name: 'Prioritise', exact: true })).toHaveValue(
    'showers',
  );
  await expect(page.locator('.lounge-card').first()).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Edit memberships', exact: true }).click();
  await expect(priorityPass).toBeChecked();
  await expect(qantasStatus).toHaveValue('qantas-platinum');
  await expect(unitedStatus).toHaveValue('united-premier-1k');
  await expectScreenReaderTextHidden(page);
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page
    .locator('.lounge-membership-settings')
    .evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await captureDesign(page, 'artifacts/loyalty-settings-mobile-selected.png');
  await addStatus.click();
  await search.fill('British');
  await expect(page.locator('.loyalty-program-results')).toBeVisible();
  await expectScreenReaderTextHidden(page);
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page
    .locator('.loyalty-program-picker')
    .evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await captureDesign(page, 'artifacts/loyalty-settings-mobile-picker.png');
  await search.press('Escape');
  await page.getByRole('button', { name: 'Remove United MileagePlus', exact: true }).click();
  await expect(unitedStatus).toHaveCount(0);
  await expect(qantasStatus).toHaveValue('qantas-platinum');
  await expect(priorityPass).toBeChecked();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect
    .poll(() => [...(api.data.preferences.loungeMemberships ?? [])].sort())
    .toEqual(['priority-pass', 'qantas-platinum']);
  await page.reload();
  await page.getByRole('button', { name: 'Lounges', exact: true }).first().click();
  await expect(page.locator('.lounge-membership-summary')).toContainText('Priority Pass');
  await expect(page.locator('.lounge-membership-summary')).toContainText('Qantas Platinum');
  await expect(page.locator('.lounge-membership-summary')).not.toContainText('Premier 1K');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  expect(validateAppData(api.data)).toBeNull();
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('airline defaults follow marketing until overridden, with sourced ratings and availability checks', async ({
  page,
}) => {
  const api = new LoungeAccountApi();
  api.data.preferences.loungeMemberships = ['qantas-platinum'];
  api.data.preferences.loungePriority = 'showers';
  await api.install(page);
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
  await openLounges(page);
  await page.getByRole('combobox', { name: 'Airport', exact: true }).fill('SYD');
  await page.getByLabel('Visit date', { exact: true }).fill('2026-10-17');
  await page.getByLabel('From', { exact: true }).fill('10:00');
  await page.getByLabel('Until', { exact: true }).fill('12:00');
  await page.getByLabel('Departure time', { exact: true }).fill('13:00');
  await page.getByRole('combobox', { name: 'Marketing airline', exact: true }).selectOption('QF');
  await page.getByRole('combobox', { name: 'Departure terminal', exact: true }).selectOption('T1');
  const firstLounge = page.locator('.lounge-card[data-lounge-id="syd-qantas-first"]');
  await expect(firstLounge).toBeVisible();
  const operator = page.getByRole('combobox', { name: 'Operating airline', exact: true });
  const marketer = page.getByRole('combobox', { name: 'Marketing airline', exact: true });
  await expect(operator).toHaveValue('QF');
  await marketer.selectOption('BA');
  await expect(operator).toHaveValue('BA');
  await operator.selectOption('EK');
  await marketer.selectOption('QF');
  await expect(operator).toHaveValue('EK');
  await operator.selectOption('');
  await expect(firstLounge.locator('.lounge-access')).toHaveText('Check access');
  await expect(firstLounge.locator('.lounge-recommended')).toHaveCount(0);
  await operator.selectOption('QF');
  await expect(firstLounge.locator('.lounge-access')).toHaveText('Access matches');
  await expect(firstLounge.locator('.lounge-opening')).toHaveText('Open during your visit');
  await expect(firstLounge.locator('.lounge-recommended')).toHaveText('Recommended');
  await expect(firstLounge.locator('.lounge-amenities')).toContainText('Showers');
  await expect(firstLounge.locator('.lounge-amenities')).toContainText('Restaurant');
  await expect(firstLounge.locator('.lounge-quality')).toContainText('Rephase rating');
  await expect(firstLounge.locator('.lounge-rating-detail')).not.toBeVisible();
  await firstLounge.locator('summary').filter({ hasText: 'Details & sources' }).click();
  await expect(firstLounge.locator('.lounge-rating-detail')).toContainText('published reviews');
  await expect(firstLounge.locator('.lounge-rating-detail a').first()).toHaveAttribute('href', /https:\/\//);
  await expect(
    firstLounge.getByRole('link', { name: 'Qantas lounge access and eligibility' }),
  ).toHaveAttribute('href', 'https://www.qantas.com/en-au/at-the-airport/lounges/access');
  await expect(
    firstLounge.getByText('Sources checked 2026-10-15.', { exact: false }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await firstLounge.scrollIntoViewIfNeeded();
  await captureDesign(page, 'artifacts/lounge-explorer-desktop.png');

  await page.getByLabel('From', { exact: true }).fill('04:00');
  await page.getByLabel('Until', { exact: true }).fill('04:45');
  await page.getByLabel('Departure time', { exact: true }).fill('06:00');
  await expect(firstLounge.locator('.lounge-opening')).toHaveText('Closed during your visit');
  await expect(firstLounge.locator('.lounge-recommended')).toHaveCount(0);
});

test('new airport guides work on a narrow screen with saved card and airline memberships', async ({
  page,
}) => {
  const api = new LoungeAccountApi();
  api.data.preferences.loungeMemberships = [
    'qantas-platinum',
    'priority-pass',
    'amex-platinum',
    'united-premier-1k',
  ];
  await api.install(page);
  await page.clock.setFixedTime(new Date('2026-11-08T12:00:00Z'));
  await page.setViewportSize({ width: 390, height: 844 });
  await openLounges(page);
  await page.getByLabel('Visit date', { exact: true }).fill('2026-11-10');
  await page.getByLabel('From', { exact: true }).fill('16:00');
  await page.getByLabel('Until', { exact: true }).fill('17:30');
  await page.getByLabel('Departure time', { exact: true }).fill('18:00');
  for (const [airport, lounge] of [
    ['CNS', 'cns-qantas-club'],
    ['SIN', 'sin-qantas-first'],
    ['LHR', 'lhr-qantas'],
    ['MUC', 'muc-lufthansa-senator-h24'],
    ['SLC', 'slc-centurion'],
  ]) {
    await page.getByRole('combobox', { name: 'Airport', exact: true }).fill(airport);
    await expect(page.locator(`.lounge-card[data-lounge-id="${lounge}"]`)).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
  }
  await page
    .getByRole('combobox', { name: 'Departure terminal', exact: true })
    .selectOption('Concourse B');
  const centurion = page.locator('.lounge-card[data-lounge-id="slc-centurion"]');
  await expect(centurion.locator('.lounge-access')).toHaveText('Access matches');
  await expect(centurion.locator('.lounge-recommended')).toBeVisible();
  await centurion.scrollIntoViewIfNeeded();
  await captureDesign(page, 'artifacts/lounges-expanded-slc-mobile.png');
  await page.getByRole('button', { name: 'Edit memberships', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'American Express Platinum Card', exact: true }),
  ).toBeChecked();
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('compact mobile lounge links precede departures and preserve flight context for useful, short and uncovered visits', async ({
  page,
}) => {
  const api = new LoungeAccountApi();
  const itinerary = structuredClone(octoberItinerary.trip) as Trip;
  itinerary.legs.find((leg) => leg.id === 'qf94')!.travelClass = 'business';
  api.data = { ...emptyData(), trips: [itinerary], selectedTripId: itinerary.id };
  await api.install(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date('2026-10-24T15:00:00Z'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: itinerary.name, exact: true })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  await navigation.getByRole('button', { name: 'Your plan', exact: true }).click();
  // Representative researched connection and uncovered departure; the full
  // five-leg journey is covered once in travel-feedback.spec.ts.
  for (const leg of itinerary.legs.filter((leg) => ['qf94', 'qf490'].includes(leg.id))) {
    await page.locator(`.day-button[data-date="${leg.departureDateTime.slice(0, 10)}"]`).click();
    const button = page.getByRole('button', {
      name: `Explore lounges in ${leg.departureAirport}`,
      exact: true,
    });
    await expect(button).toBeVisible();
    await expect(
      page.locator(`.journey-flight-marker[data-flight-id="${leg.id}"][data-phase="departure"]`),
    ).toBeVisible();
    await expectPreflightLoungeEntry(
      page,
      leg.id,
      leg.id === 'qf94' ? '2026-10-25T06:40:00Z' : '2026-10-27T09:10:00Z',
    );
    expect(
      await button.evaluate((node, flightId) => {
        const card = document.querySelector(
          `.journey-flight-marker[data-flight-id="${flightId}"][data-phase="departure"]`,
        );
        return (
          card !== null &&
          Boolean(node.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
      }, leg.id),
    ).toBe(true);
    const bounds = await button.boundingBox();
    expect(bounds?.height).toBeLessThanOrEqual(72);
    expect(await noHorizontalOverflow(page)).toBe(true);
  }
  await page.getByRole('button', { name: 'Explore lounges in MEL', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lounge Explorer', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Airport', exact: true })).toHaveValue('MEL');
  await expect(page.locator('.lounge-context')).toContainText('QF490');
  await expect(page.locator('.lounge-empty')).toContainText(
    'We haven’t researched lounges here yet.',
  );
  await expect(page.locator('.lounge-card, .lounge-recommended')).toHaveCount(0);
  await navigation.getByRole('button', { name: 'Your plan', exact: true }).click();
  // One uninterrupted flight and one earlier lounge shortcut survive scrolling across all three dates.
  await expect(page.locator('.journey-flight-span[data-flight-id="qf94"]')).toHaveCount(1);
  await expect(page.locator('.flight-lounge-link[data-flight-id="qf94"]')).toHaveCount(1);
  await page.locator('.day-button[data-date="2026-10-24"]').click();
  const connection = page.locator(
    '.journey-flight-marker[data-flight-id="qf94"][data-phase="departure"]',
  );
  await expect(connection).toBeVisible();
  await page.getByRole('button', { name: 'Explore lounges in LAX', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lounge Explorer', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Airport', exact: true })).toHaveValue('LAX');
  await expect(page.getByLabel('Visit date', { exact: true })).toHaveValue('2026-10-24');
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('18:14');
  await expect(page.getByLabel('Until', { exact: true })).toHaveValue('22:55');
  await expect(page.getByLabel('Departure time', { exact: true })).toHaveValue('23:40');
  await expect(page.getByRole('combobox', { name: 'Cabin', exact: true })).toHaveValue('business');
  // The flight number prefills both airlines, with an editable codeshare override.
  await expect(page.getByRole('combobox', { name: 'Operating airline', exact: true })).toHaveValue(
    'QF',
  );
  await expect(page.getByRole('combobox', { name: 'Marketing airline', exact: true })).toHaveValue(
    'QF',
  );
  expect(await noHorizontalOverflow(page)).toBe(true);
  await captureDesign(page, 'artifacts/lounge-explorer-mobile.png');
  await page.getByRole('combobox', { name: 'Operating airline', exact: true }).selectOption('QF');
  await page
    .getByRole('combobox', { name: 'Departure terminal', exact: true })
    .selectOption('Tom Bradley International Terminal');
  const qantasBusiness = page.locator('.lounge-card[data-lounge-id="lax-qantas-business"]');
  await expect(
    qantasBusiness.getByRole('heading', { name: 'Qantas / oneworld Business Lounge', exact: true }),
  ).toBeVisible();
  await expect(qantasBusiness.locator('.lounge-access')).toHaveText('Access matches');
  await expect(qantasBusiness.locator('.lounge-opening')).toHaveText('Open during your visit');
  await page.getByRole('combobox', { name: 'Airport', exact: true }).fill('SYD');
  await expect(page.locator('.lounge-context')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Operating airline', exact: true })).toHaveValue(
    '',
  );
  await expect(page.getByRole('combobox', { name: 'Marketing airline', exact: true })).toHaveValue(
    '',
  );
  await expect(page.getByRole('combobox', { name: 'Departure terminal', exact: true })).toHaveValue(
    '',
  );
  await expect(page.getByRole('combobox', { name: 'Cabin', exact: true })).toHaveValue('economy');

  // The preceding domestic arrival at 17:44 leaves only six minutes after
  // arrival and boarding buffers. The link still explores this airport, but
  // must retain the real interval and never recommend a fabricated visit.
  const shorterTrip = structuredClone(itinerary);
  shorterTrip.legs.find((leg) => leg.id === 'qf94')!.departureDateTime = '2026-10-24T19:05';
  api.data = { ...api.data, trips: [shorterTrip] };
  api.revision++;
  await page.reload();
  await expect(page.getByRole('heading', { name: itinerary.name, exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Your plan', exact: true }).click();
  await page.locator('.day-button[data-date="2026-10-24"]').click();
  await expect(
    page.locator('.journey-flight-marker[data-flight-id="qf94"][data-phase="departure"]'),
  ).toBeVisible();
  await expectPreflightLoungeEntry(page, 'qf94', '2026-10-25T02:05:00Z');
  await expect(
    page.getByRole('button', { name: 'Explore lounges in SFO', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Explore lounges in LAX', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Airport', exact: true })).toHaveValue('LAX');
  await expect(page.locator('.lounge-context')).toContainText('QF94');
  await expect(page.getByLabel('Visit date', { exact: true })).toHaveValue('2026-10-24');
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('18:14');
  await expect(page.getByLabel('Until', { exact: true })).toHaveValue('18:20');
  await expect(page.getByLabel('Departure time', { exact: true })).toHaveValue('19:05');
  await expect(page.getByRole('combobox', { name: 'Cabin', exact: true })).toHaveValue('business');
  await page.getByRole('combobox', { name: 'Operating airline', exact: true }).selectOption('QF');
  await page
    .getByRole('combobox', { name: 'Departure terminal', exact: true })
    .selectOption('Tom Bradley International Terminal');
  await expect(page.locator('.lounge-count')).toHaveText('0 match this visit');
  await expect(page.locator('.lounge-recommended')).toHaveCount(0);
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('an after-midnight connection keeps its lounge visit before departure on the previous local evening', async ({
  page,
}) => {
  const api = new LoungeAccountApi();
  const trip: Trip = {
    id: 'midnight-lounge-connection',
    name: 'After-midnight connection',
    createdAt: '2026-10-15T12:00:00Z',
    updatedAt: '2026-10-15T12:00:00Z',
    legs: [
      {
        id: 'evening-arrival',
        flightNumber: 'AA101',
        departureAirport: 'SFO',
        arrivalAirport: 'LAX',
        departureDateTime: '2026-10-24T21:00',
        arrivalDateTime: '2026-10-24T22:10',
        departureTimeZone: 'America/Los_Angeles',
        arrivalTimeZone: 'America/Los_Angeles',
        stayAfter: 'connection',
        strategy: 'adapt',
        travelClass: 'economy',
      },
      {
        id: 'after-midnight-departure',
        flightNumber: 'QF94',
        departureAirport: 'LAX',
        arrivalAirport: 'MEL',
        departureDateTime: '2026-10-25T01:00',
        arrivalDateTime: '2026-10-26T10:30',
        departureTimeZone: 'America/Los_Angeles',
        arrivalTimeZone: 'Australia/Melbourne',
        stayAfter: 'destination',
        strategy: 'adapt',
        travelClass: 'business',
      },
    ],
  };
  api.data = { ...emptyData(), trips: [trip], selectedTripId: trip.id };
  await api.install(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date('2026-10-25T04:00:00Z'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: trip.name, exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'Your plan', exact: true })
    .click();
  await page.locator('.day-button[data-date="2026-10-24"]').click();
  const link = page.locator('.flight-lounge-link[data-flight-id="after-midnight-departure"]');
  const lounge = page.locator('.journey-flight-marker[data-kind="lounge"]').filter({ has: link });
  await expect(lounge).toHaveCount(1);
  const at = Number(await lounge.getAttribute('data-start'));
  expect(at).toBe(Date.parse('2026-10-25T05:40:00Z')); // 24 October, 22:40 PDT
  const localClock = page.locator(`.journey-tick time[datetime="${new Date(at).toISOString()}"]`);
  await expect(localClock).toContainText('22:40');
  await page.locator('.day-button[data-date="2026-10-25"]').click();
  await expect(link).toHaveCount(1);
  const departure = page.locator(
    '.journey-flight-marker[data-flight-id="after-midnight-departure"][data-phase="departure"]',
  );
  expect(Number(await departure.getAttribute('data-start'))).toBe(
    Date.parse('2026-10-25T08:00:00Z'),
  );
  await departure.click();
  const details = page.getByRole('dialog', { name: 'Your flight', exact: true });
  await details.locator('.flight-details > summary').click();
  await expect(details.locator('[aria-label="Departure"] .flight-clock-origin')).toContainText(
    '01:00',
  );
  await details.getByRole('button', { name: 'Close dialog' }).click();

  await page.locator('.day-button[data-date="2026-10-24"]').click();
  await lounge.scrollIntoViewIfNeeded();
  await captureDesign(page, 'artifacts/lounge-preflight-point-mobile.png');
  await lounge.getByRole('button', { name: 'Explore lounges in LAX', exact: true }).click();
  await expect(page.getByLabel('Visit date', { exact: true })).toHaveValue('2026-10-24');
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('22:40');
  await expect(page.getByLabel('Until', { exact: true })).toHaveValue('00:15');
  await expect(page.getByLabel('Departure time', { exact: true })).toHaveValue('01:00');
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('a lounge visit across the autumn clock change preserves the later departure and visit-end occurrences', async ({
  page,
}) => {
  const api = new LoungeAccountApi();
  const trip: Trip = {
    id: 'lounge-fall-back',
    name: 'Autumn clock-change journey',
    createdAt: '2026-10-15T12:00:00Z',
    updatedAt: '2026-10-15T12:00:00Z',
    legs: [
      {
        id: 'lounge-fall-back-flight',
        flightNumber: 'AS123',
        departureAirport: 'SFO',
        arrivalAirport: 'LAX',
        departureDateTime: '2026-11-01T01:30',
        arrivalDateTime: '2026-11-01T03:00',
        departureTimeZone: 'America/Los_Angeles',
        arrivalTimeZone: 'America/Los_Angeles',
        departureDisambiguation: 'later',
        stayAfter: 'destination',
        strategy: 'adapt',
        travelClass: 'economy',
      },
    ],
  };
  api.data = { ...emptyData(), trips: [trip], selectedTripId: trip.id };
  await api.install(page);
  await page.clock.setFixedTime(new Date('2026-10-31T21:00:00Z'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: trip.name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Your plan', exact: true }).first().click();
  await page.locator('.day-button[data-date="2026-11-01"]').click();
  await page.getByRole('button', { name: 'Explore lounges in SFO', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lounge Explorer', exact: true })).toBeVisible();
  await expect(page.getByLabel('Visit date', { exact: true })).toHaveValue('2026-11-01');
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('00:30');
  await expect(page.getByLabel('Until', { exact: true })).toHaveValue('01:00');
  await expect(page.getByLabel('Departure time', { exact: true })).toHaveValue('01:30');
  const endOccurrence = page.getByRole('combobox', {
    name: 'Visit end: this clock time occurs twice',
    exact: true,
  });
  const departureOccurrence = page.getByRole('combobox', {
    name: 'Flight departure: this clock time occurs twice',
    exact: true,
  });
  await expect(endOccurrence).toHaveValue('later');
  await expect(departureOccurrence).toHaveValue('later');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.lounge-card').first()).toBeVisible();
  // Moving the departure to the first 01:30 is earlier than the chosen visit
  // end. The invalid window must be explained instead of silently changing it.
  await departureOccurrence.selectOption('earlier');
  await expect(page.getByRole('alert')).toContainText(
    'Finish your lounge visit at least 30 minutes before departure.',
  );
  await departureOccurrence.selectOption('later');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
