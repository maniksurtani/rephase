import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import schema from '../data/lounges/schema.json';
import { LOUNGE_DATA } from '../src/lib/lounge-data';
import sfo from '../data/lounges/SFO.json';
import { LOUNGE_MEMBERSHIPS, type AirportLoungeData } from '../src/lib/lounge-types';

const files = LOUNGE_DATA;

const validate = new Ajv({ allErrors: true }).compile(schema);
const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));

function validDate(date: string): boolean {
  try { return Temporal.PlainDate.from(date, { overflow: 'reject' }).toString() === date; }
  catch { return false; }
}
function httpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

/** Cross-record checks that JSON Schema cannot express. Error paths help offline editing. */
function semanticErrors(data: AirportLoungeData): string[] {
  const errors: string[] = [];
  const check = (condition: boolean, message: string) => { if (!condition) errors.push(message); };
  check(validDate(data.updatedAt), 'updatedAt must be a real ISO date');
  try { new Intl.DateTimeFormat('en', { timeZone: data.timeZone }); }
  catch { errors.push('timeZone must name a real timezone'); }
  const loungeIds = new Set<string>();

  for (const lounge of data.lounges) {
    const at = lounge.id;
    check(!loungeIds.has(lounge.id), `${at}: duplicate lounge ID`);
    loungeIds.add(lounge.id);
    check(lounge.id.startsWith(`${data.airport.toLowerCase()}-`), `${at}: lounge ID must start with the airport code`);
    const sourceIds = new Set<string>();
    for (const source of lounge.sources) {
      check(!sourceIds.has(source.id), `${at}: duplicate source ID ${source.id}`);
      sourceIds.add(source.id);
      check(httpsUrl(source.url), `${at}/${source.id}: source needs a public HTTPS URL without credentials`);
      check(validDate(source.checkedOn), `${at}/${source.id}: checkedOn must be a real ISO date`);
      check(source.checkedOn <= data.updatedAt, `${at}/${source.id}: source review is later than the airport review date`);
    }
    const ruleIds = new Set<string>();
    for (const rule of lounge.accessRules) {
      check(!ruleIds.has(rule.id), `${at}: duplicate access rule ID ${rule.id}`);
      ruleIds.add(rule.id);
      check(Boolean(rule.sourceIds?.length), `${at}/${rule.id}: access needs cited official research`);
      for (const sourceId of rule.sourceIds ?? []) {
        check(sourceIds.has(sourceId), `${at}/${rule.id}: unresolved source ID ${sourceId}`);
      }
      check(!rule.cabinsAnyOf || Boolean(rule.operatingCarriersAnyOf?.length || rule.operatingAlliance),
        `${at}/${rule.id}: cabin access also needs an operating carrier or alliance`);
      if (rule.maxMinutesBeforeDeparture !== undefined && rule.minMinutesBeforeDeparture !== undefined) {
        check(rule.minMinutesBeforeDeparture < rule.maxMinutesBeforeDeparture, `${at}/${rule.id}: entry window must have positive duration`);
      }
      check(!(rule.destinationCountriesAnyOf ?? []).some(country => rule.excludedDestinationCountries?.includes(country)),
        `${at}/${rule.id}: destination country cannot be both required and excluded`);
    }
    const exceptionDates = new Set<string>();
    if (lounge.recommendation) {
      check(Boolean(lounge.recommendation.summary.trim()) && lounge.recommendation.summary.length <= 500,
        `${at}: recommendation summary must be concise and nonempty`);
      const priorities = lounge.recommendation.bestFor ?? [];
      check(new Set(priorities).size === priorities.length && priorities.every(priority => ['balanced', 'showers', 'dining', 'quiet'].includes(priority)),
        `${at}: recommendation priorities must be unique supported values`);
    }
    for (const exception of lounge.hours.exceptions ?? []) {
      check(validDate(exception.date), `${at}: opening exception must use a real ISO date`);
      check(!exceptionDates.has(exception.date), `${at}: duplicate opening exception ${exception.date}`);
      exceptionDates.add(exception.date);
    }
    const photoPaths = new Set<string>();
    for (const photo of lounge.photos) {
      check(!photoPaths.has(photo.path), `${at}: duplicate photo path ${photo.path}`);
      photoPaths.add(photo.path);
      check(httpsUrl(photo.sourceUrl), `${at}: photo needs public HTTPS source/license evidence`);
      check([photo.alt, photo.credit, photo.license].every(value => Boolean(value.trim())), `${at}: photo alt text, credit and license are required`);
      const safePath = photo.path.startsWith(`/lounges/${lounge.id}/`)
        && !photo.path.includes('\\') && !photo.path.includes('%')
        && !photo.path.split('/').some(part => part === '.' || part === '..');
      check(safePath, `${at}: photo path must stay under /lounges/${lounge.id}/`);
      if (!safePath) continue;
      const path = resolve(publicRoot, `.${photo.path}`);
      const photoFolder = resolve(publicRoot, 'lounges', lounge.id);
      const rel = relative(photoFolder, path);
      check(!isAbsolute(rel) && !rel.startsWith(`..${sep}`) && rel !== '..', `${at}: photo path leaves its lounge folder`);
      if (!existsSync(path)) { errors.push(`${at}: missing photo file ${photo.path}`); continue; }
      check(statSync(path).isFile(), `${at}: photo must reference a file`);
      const realFolder = realpathSync(photoFolder);
      const realFile = realpathSync(path);
      check(realFile.startsWith(`${realFolder}${sep}`) && realFolder.startsWith(`${realpathSync(publicRoot)}${sep}`),
        `${at}: photo symlink leaves its public lounge folder`);
    }
  }
  return errors;
}

describe('curated lounge research data', () => {
  it('keeps schema membership IDs aligned with the app contract', () => {
    expect(schema.definitions.membership.enum).toEqual(LOUNGE_MEMBERSHIPS.map(program => program.id));
  });

  it.each(files)('$airport conforms to the editor schema and provenance/photo checks', data => {
    expect(validate(data), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(semanticErrors(data as AirportLoungeData)).toEqual([]);
  });

  it('keeps airport files and lounge identifiers globally unique', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(new Set(files.map(data => data.airport)).size).toBe(files.length);
    const ids = files.flatMap(data => data.lounges.map(lounge => lounge.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects misspelled fields, unknown memberships and rules without eligibility predicates', () => {
    const misspelled = structuredClone(sfo);
    Object.assign(misspelled.lounges[0].amenities, { shower: 'yes' });
    expect(validate(misspelled)).toBe(false);
    const unsupported = structuredClone(sfo);
    unsupported.lounges[0].accessRules[0].membershipsAnyOf = ['made-up-program'];
    expect(validate(unsupported)).toBe(false);
    const unconditional = structuredClone(sfo);
    unconditional.lounges[0].accessRules = [{ id: 'anyone', label: 'Anyone', sourceIds: ['policy'] }] as typeof unconditional.lounges[0].accessRules;
    expect(validate(unconditional)).toBe(false);
  });

  it('accepts concise researched recommendations and rejects empty, oversized or unsupported priorities', () => {
    const data = structuredClone(sfo) as AirportLoungeData;
    data.lounges[0].recommendation = { summary: 'A useful stop when a shower is the priority.', bestFor: ['showers'] };
    expect(validate(data)).toBe(true);
    expect(semanticErrors(data)).toEqual([]);
    data.lounges[0].recommendation.summary = ' ';
    expect(validate(data)).toBe(false);
    data.lounges[0].recommendation.summary = 'x'.repeat(501);
    expect(validate(data)).toBe(false);
    data.lounges[0].recommendation.summary = 'A concise researched summary.';
    data.lounges[0].recommendation.bestFor = ['showers', 'showers'];
    expect(validate(data)).toBe(false);
    Object.assign(data.lounges[0].recommendation, { bestFor: ['spa'] });
    expect(validate(data)).toBe(false);
    expect(semanticErrors(data).some(error => error.includes('unique supported values'))).toBe(true);
  });

  it('requires finite nonnegative extra entry fees with an uppercase ISO currency code', () => {
    const data = structuredClone(sfo);
    const rule = data.lounges[0].accessRules[0];
    Object.assign(rule, { additionalFee: { amount: 25, currency: 'USD' } });
    expect(validate(data)).toBe(true);
    for (const additionalFee of [
      { amount: -1, currency: 'USD' }, { amount: Infinity, currency: 'USD' },
      { amount: 25, currency: 'usd' }, { amount: 25, currency: 'US' },
      { amount: 25, currency: 'USD', extra: true },
    ]) {
      Object.assign(rule, { additionalFee });
      expect(validate(data)).toBe(false);
    }
  });

  it('detects broken references, impossible review dates and cabin-only blanket access', () => {
    const data = structuredClone(sfo) as AirportLoungeData;
    data.lounges[0].accessRules = [{ id: 'broad', label: 'All First tickets', cabinsAnyOf: ['first'], sourceIds: ['missing'] }];
    data.lounges[0].sources[0].checkedOn = '2026-02-30';
    data.timeZone = 'Imaginary/Zone';
    const errors = semanticErrors(data);
    expect(errors.some(error => error.includes('unresolved source'))).toBe(true);
    expect(errors.some(error => error.includes('operating carrier or alliance'))).toBe(true);
    expect(errors.some(error => error.includes('real ISO date'))).toBe(true);
    expect(errors.some(error => error.includes('real timezone'))).toBe(true);
  });

  it('rejects remote/traversing photos and images without credit or licensing metadata', () => {
    const data = structuredClone(sfo) as AirportLoungeData;
    const photo = { path: '/lounges/../private.webp', alt: 'A lounge', credit: 'Photographer', license: 'CC BY 4.0', sourceUrl: 'https://example.org/photo' };
    data.lounges[0].photos = [photo];
    expect(validate(data)).toBe(false);
    expect(semanticErrors(data).some(error => error.includes('photo path'))).toBe(true);
    photo.path = 'https://example.org/hotlink.webp';
    expect(validate(data)).toBe(false);
    photo.path = `/lounges/${data.lounges[0].id}/room.webp`;
    photo.credit = ''; photo.license = '';
    expect(validate(data)).toBe(false);
    const errors = semanticErrors(data);
    expect(errors.some(error => error.includes('credit and license'))).toBe(true);
    expect(errors.some(error => error.includes('missing photo file'))).toBe(true);
  });
});
