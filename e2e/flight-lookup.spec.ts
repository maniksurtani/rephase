import { test, expect, type Locator, type Page } from '@playwright/test';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import type { AppData, FlightCandidate, FlightLookupResult } from '../src/lib/types';

const account = {id:'lookup-account',name:'Flight traveler',email:'flight@example.com'};
const firstCandidate: FlightCandidate = {
  id:'ba286',flightNumber:'BA286',airline:'British Airways',departureAirport:'SFO',arrivalAirport:'LHR',
  departureDateTime:'2026-12-01T20:00',arrivalDateTime:'2026-12-02T14:00',
  departureTimeZone:'America/Los_Angeles',arrivalTimeZone:'Europe/London',
  departureUtc:'2026-12-02T04:00:00Z',arrivalUtc:'2026-12-02T14:00:00Z',durationMinutes:600,
};

function lookupResult(candidate: FlightCandidate = firstCandidate): FlightLookupResult {
  return {
    provider:'aerodatabox',candidates:[candidate],fetchedAt:'2026-10-14T12:00:00Z',
    expiresAt:'2026-10-15T12:00:00Z',stale:false,attribution:'Flight data by AeroDataBox',warnings:[],
  };
}

async function installAccount(page: Page, lookupAvailable = true) {
  let data: AppData = {schemaVersion:1,preferences:DEFAULT_PREFERENCES,trips:[],selectedTripId:null};
  let revision = 0;
  await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'application/javascript',body:'window.google={accounts:{id:{initialize(){},renderButton(){},disableAutoSelect(){}}}};'}));
  await page.route('**/api/auth/challenge',route=>route.fulfill({json:{nonce:'flight-test-nonce'}}));
  await page.route('**/api/config',route=>route.fulfill({json:{googleClientId:'test-client',syncAvailable:true,flightLookupAvailable:lookupAvailable,flightProvider:'aerodatabox'}}));
  await page.route('**/api/me',route=>route.fulfill({json:account}));
  await page.route('**/api/state',route=> {
    expect(route.request().headers()['x-rephase-account']).toBe(account.id);
    if(route.request().method()==='GET')return route.fulfill({json:{data,revision}});
    const body=route.request().postDataJSON();
    if(body.revision!==revision)return route.fulfill({status:409,json:{error:'Changed on another device'}});
    data=body.data;revision++;
    return route.fulfill({json:{revision}});
  });
}

async function newTrip(page: Page, signedIn = false) {
  await page.goto('/');
  if(signedIn)await expect(page.getByRole('button',{name:`${account.name}'s account menu`})).toBeVisible();
  await page.getByRole('button',{name:'Trips',exact:true}).first().click();
  await page.getByRole('button',{name:'New trip',exact:true}).click();
  const editor = page.getByRole('dialog',{name:'Plan a new journey',exact:true});
  await expect(editor).toBeVisible();
  return editor;
}

async function selectCandidate(editor: Locator) {
  const use=editor.getByRole('button',{name:'Use this flight',exact:true});
  await expect(editor.getByRole('checkbox')).toHaveCount(0);
  await expect(use).toBeEnabled();
  await use.click();
}

test('flight number and date are the default entry while guests can reveal manual details',async({page})=> {
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/config',route=>route.fulfill({json:{googleClientId:null,syncAvailable:false,flightLookupAvailable:false}}));
  const editor=await newTrip(page);
  await expect(editor.getByLabel('Flight number',{exact:true})).toBeVisible();
  await expect(editor.getByLabel('Departure date at the departure airport')).toBeVisible();
  await expect(editor.getByRole('button',{name:'Look up flight',exact:true})).toBeDisabled();
  await expect(editor.getByText('Sign in with Google to look up a flight, or enter it manually.',{exact:true})).toBeVisible();
  await expect(editor.getByLabel('Airport code').first()).toBeHidden();
  await expect(editor.getByLabel('Local departure date & time')).toBeHidden();
  await expect(editor.getByLabel('Departure time zone')).toBeHidden();
  await expect(editor.getByLabel('Known takeoff time (departure local, optional)')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/flight-lookup-mobile.png'});
  await editor.getByLabel('Flight number',{exact:true}).fill('BA286');
  await editor.getByLabel('Departure date at the departure airport').fill('2026-12-01');
  await editor.getByRole('button',{name:'Enter manually',exact:true}).click();
  await expect(editor.getByLabel('Airport code').first()).toBeVisible();
  await expect(editor.getByLabel('Local departure date & time')).toHaveValue(/^2026-12-01T\d{2}:\d{2}$/);
  await expect(editor.getByLabel('Local arrival date & time')).toHaveValue(/^2026-12-01T\d{2}:\d{2}$/);
  await expect(editor.getByLabel('Departure date at the departure airport')).toHaveValue('2026-12-01');
  await editor.getByLabel('Local departure date & time').scrollIntoViewIfNeeded();
  await page.screenshot({path:'artifacts/flight-manual-mobile.png'});
  await editor.getByLabel('Airport code').first().fill('SFO');
  await editor.getByLabel('Airport code').last().fill('LHR');
  await editor.getByLabel('Local departure date & time').fill('2026-12-01T20:00');
  await editor.getByLabel('Local arrival date & time').fill('2026-12-02T14:00');
  const stopOptions=editor.locator('.stay-editor');
  await stopOptions.evaluate(element=>element.scrollIntoView({block:'center'}));
  await stopOptions.screenshot({path:'artifacts/copy-stop-options-mobile.png'});
  await editor.getByRole('button',{name:'Create my plan',exact:true}).click();
  await expect(page.getByRole('heading',{name:'My next journey',exact:true})).toBeVisible();
  const dismiss=page.getByRole('button',{name:'Dismiss notification',exact:true});
  if(await dismiss.isVisible())await dismiss.click();
  const bedtime=page.getByRole('heading',{name:'Bedtime',exact:true}).first();
  await expect(bedtime).toBeVisible();
  await bedtime.evaluate(element=>element.closest('.action-card')!.scrollIntoView({block:'center'}));
  await page.screenshot({path:'artifacts/copy-bedtime-mobile.png'});
  const footer=page.locator('.page-footer');
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole('link',{name:'Flight data by AeroDataBox',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/copy-footer-mobile.png'});
});

test('manual fallback remains available when the signed-in deployment has no flight API key',async({page})=> {
  await installAccount(page,false);
  const editor=await newTrip(page,true);
  await expect(page.getByRole('button',{name:`${account.name}'s account menu`})).toBeVisible();
  await expect(editor.getByRole('button',{name:'Look up flight',exact:true})).toBeDisabled();
  await expect(editor.getByText(/flight lookup.*(?:not configured|unavailable|API key)/i)).toBeVisible();
  await expect(editor.getByLabel('Local arrival date & time')).toBeHidden();
  await editor.getByRole('button',{name:'Enter manually',exact:true}).click();
  await expect(editor.getByLabel('Local arrival date & time')).toBeVisible();
});

test('a confirmed lookup displays its schedule without exposing manual fields and preserves cabin choices',async({page})=> {
  await installAccount(page);
  await page.route('**/api/flights?*',route=> {
    expect(route.request().headers()['x-rephase-account']).toBe(account.id);
    const query=new URL(route.request().url()).searchParams;
    expect(query.get('flightNumber')).toBe('BA286');expect(query.get('date')).toBe('2026-12-01');
    expect(query.has('departureAirport')).toBe(false);
    return route.fulfill({json:lookupResult()});
  });
  const editor=await newTrip(page,true);
  const attribution=page.locator('.page-footer').getByRole('link',{name:'Flight data by AeroDataBox',exact:true});
  await expect(attribution).toHaveCount(1);
  await expect(attribution).toHaveAttribute('href','https://aerodatabox.com/');
  await expect(attribution).not.toHaveAttribute('rel',/noreferrer/);
  expect(await attribution.evaluate(link=>link.closest('[role=dialog]')===null)).toBe(true);
  await expect(editor.getByRole('link',{name:/AeroDataBox/})).toHaveCount(0);
  await editor.getByLabel('Flight number',{exact:true}).fill('BA286');
  await editor.getByLabel('Departure date at the departure airport').fill('2026-12-01');
  await editor.getByLabel('Travel class').selectOption('business');
  await editor.getByLabel('Lie-flat bed available?').selectOption('yes');
  await editor.getByRole('button',{name:'Look up flight',exact:true}).click();
  await selectCandidate(editor);
  await expect(editor.getByLabel('Local departure date & time')).toBeHidden();
  await expect(editor.getByLabel('Local arrival date & time')).toBeHidden();
  await expect(editor).not.toContainText(/Originally imported|verify the schedule against my booking/);
  await expect(editor.locator('.flight-selection-summary')).toContainText('SFO');
  await expect(editor.locator('.flight-selection-summary')).toContainText('LHR');
  await expect(editor.locator('.flight-selection-summary')).toContainText('20:00');
  await expect(editor.locator('.flight-selection-summary')).toContainText('14:00');
  await expect(editor.getByLabel('Departure date at the departure airport')).toHaveValue('2026-12-01');
  await expect(editor.getByLabel('Travel class')).toHaveValue('business');
  await expect(editor.getByLabel('Lie-flat bed available?')).toHaveValue('yes');
  await editor.getByRole('button',{name:'Enter manually',exact:true}).click();
  await expect(editor.getByLabel('Local departure date & time')).toHaveValue('2026-12-01T20:00');
  await expect(editor.getByLabel('Local arrival date & time')).toHaveValue('2026-12-02T14:00');
  await editor.getByLabel('Local arrival date & time').fill('2026-12-02T14:15');
  await editor.getByRole('button',{name:'Create my plan',exact:true}).click();
  await expect(page.getByRole('heading',{name:'My next journey',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Trips',exact:true}).first().click();
  await expect(page.getByRole('link',{name:'Flight data by AeroDataBox',exact:true})).toHaveCount(1);
  await expect(page.locator('.saved-trip-card')).not.toContainText('Originally imported');
});

test('changing a confirmed query cannot save the old schedule and the replacement lookup has no stale airport filter',async({page})=> {
  await installAccount(page);
  const replacement: FlightCandidate = {
    ...firstCandidate,id:'ba117',flightNumber:'BA117',departureAirport:'JFK',
    departureDateTime:'2026-12-03T20:00',arrivalDateTime:'2026-12-04T08:00',
    departureTimeZone:'America/New_York',departureUtc:'2026-12-04T01:00:00Z',arrivalUtc:'2026-12-04T08:00:00Z',durationMinutes:420,
  };
  const queries: URLSearchParams[]=[];
  await page.route('**/api/flights?*',route=> {
    const query=new URL(route.request().url()).searchParams;queries.push(query);
    expect(query.has('departureAirport')).toBe(false);
    return route.fulfill({json:lookupResult(query.get('flightNumber')==='BA117'?replacement:firstCandidate)});
  });
  const editor=await newTrip(page,true);
  await editor.getByLabel('Flight number',{exact:true}).fill('BA286');
  await editor.getByLabel('Departure date at the departure airport').fill('2026-12-01');
  await editor.getByRole('button',{name:'Look up flight',exact:true}).click();await selectCandidate(editor);
  await editor.getByLabel('Flight number',{exact:true}).fill('BA117');
  await editor.getByLabel('Departure date at the departure airport').fill('2026-12-03');
  await expect(editor.getByRole('button',{name:'Use this flight',exact:true})).toHaveCount(0);
  await editor.getByRole('button',{name:'Create my plan',exact:true}).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('alert')).toContainText(/look up|manually|confirm/i);
  await editor.getByRole('button',{name:'Look up flight',exact:true}).click();await selectCandidate(editor);
  expect(queries).toHaveLength(2);
  expect(queries[1].get('date')).toBe('2026-12-03');
  await expect(editor.locator('.flight-selection-summary')).toContainText('JFK');
  await expect(editor.getByLabel('Departure date at the departure airport')).toHaveValue('2026-12-03');
  await editor.getByRole('button',{name:'Create my plan',exact:true}).click();
  await expect(page.getByRole('heading',{name:'My next journey',exact:true})).toBeVisible();
});

test('existing multi-leg trips reveal manual fields only for the selected flight',async({page})=> {
  await page.route('**/api/config',route=>route.fulfill({json:{googleClientId:null,syncAvailable:false,flightLookupAvailable:false}}));
  await page.goto('/');await page.getByRole('button',{name:'Explore your plan',exact:true}).click();
  await page.getByRole('button',{name:'Edit trip',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Edit your journey',exact:true});
  const cards=editor.locator('.flight-editor-card');
  await expect(cards).toHaveCount(4);
  const stop=cards.first().getByRole('combobox',{name:'After this flight',exact:true});
  await expect(stop.locator('option')).toHaveText(['Final Destination','Transit']);
  await expect(cards.first().getByRole('combobox',{name:/^Adjustment Strategy\b/})).toBeVisible();
  await stop.selectOption('connection');
  await expect(cards.first().getByRole('combobox',{name:/^Adjustment Strategy\b/})).toHaveCount(0);
  await stop.selectOption('destination');
  await expect(cards.first().getByRole('combobox',{name:/^Adjustment Strategy\b/})).toBeVisible();
  for(let index=0;index<4;index++) {
    await expect(cards.nth(index).getByLabel('Departure date at the departure airport')).toBeVisible();
    await expect(cards.nth(index).getByLabel('Local departure date & time')).toBeHidden();
    await expect(cards.nth(index).getByLabel('Airport code').first()).toBeHidden();
  }
  await cards.nth(1).getByRole('button',{name:'Enter manually',exact:true}).click();
  await expect(cards.nth(1).getByLabel('Local departure date & time')).toBeVisible();
  await expect(cards.nth(0).getByLabel('Local departure date & time')).toBeHidden();
  await expect(cards.nth(2).getByLabel('Local departure date & time')).toBeHidden();
  await expect(cards.nth(3).getByLabel('Local departure date & time')).toBeHidden();
});

test('an open flight draft closes when the authenticated account changes and never saves into the new account',async({page})=> {
  await installAccount(page);
  const secondAccount={id:'lookup-account-b',name:'Second traveler',email:'second@example.com'};
  const empty: AppData={schemaVersion:1,preferences:DEFAULT_PREFERENCES,trips:[],selectedTripId:null};
  const saved: AppData={...empty,trips:[{
    id:'account-a-trip',name:'Account A journey',createdAt:'2026-10-15T00:00:00Z',updatedAt:'2026-10-15T00:00:00Z',
    legs:[{
      id:'account-a-leg',flightNumber:firstCandidate.flightNumber,
      departureAirport:firstCandidate.departureAirport,arrivalAirport:firstCandidate.arrivalAirport,
      departureDateTime:firstCandidate.departureDateTime,arrivalDateTime:firstCandidate.arrivalDateTime,
      departureTimeZone:firstCandidate.departureTimeZone,arrivalTimeZone:firstCandidate.arrivalTimeZone,
      stayAfter:'destination',strategy:'adapt',travelClass:'business',lieFlat:true,
    }],
  }],selectedTripId:'account-a-trip'};
  let switched=false, secondReads=0;
  const secondWrites: AppData[]=[];
  await page.route('**/api/state',route=> {
    const expected=switched?secondAccount.id:account.id;
    expect(route.request().headers()['x-rephase-account']).toBe(expected);
    if(route.request().method()==='GET') {
      if(switched)secondReads++;
      return route.fulfill({json:{data:switched?empty:saved,revision:1}});
    }
    if(switched)secondWrites.push(route.request().postDataJSON().data);
    return route.fulfill({json:{revision:2}});
  });
  await page.goto('/');
  await expect(page.getByRole('button',{name:`${account.name}'s account menu`})).toBeVisible();
  await page.getByRole('button',{name:'Trips',exact:true}).first().click();
  await page.getByRole('button',{name:'Edit Account A journey',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Edit your journey',exact:true});
  await editor.getByLabel('Trip name').fill('Account A private draft');
  await editor.getByLabel('Flight number',{exact:true}).fill('BA117');
  switched=true;
  await page.route('**/api/me',route=>route.fulfill({json:secondAccount}));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button',{name:`${secondAccount.name}'s account menu`})).toBeVisible();
  await expect.poll(()=>secondReads).toBeGreaterThan(0);
  await expect(editor).toHaveCount(0);
  await page.getByRole('button',{name:'Trips',exact:true}).first().click();
  await expect(page.locator('.saved-trip-card')).toHaveCount(0);
  await page.getByRole('button',{name:'New trip',exact:true}).click();
  const newEditor=page.getByRole('dialog',{name:'Plan a new journey',exact:true});
  await expect(newEditor.getByLabel('Trip name')).toHaveValue('My next journey');
  await expect(newEditor.getByLabel('Flight number',{exact:true})).toHaveValue('');
  await newEditor.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(secondWrites).toEqual([]);
});
