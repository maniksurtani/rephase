import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import type { AppData, Trip } from '../src/lib/types';

const account={id:'preferences-account',name:'Preference traveler',email:'preferences@example.com'};
const emptyData=(): AppData=>({schemaVersion:1,preferences:{...DEFAULT_PREFERENCES},trips:[],selectedTripId:null});
const eastbound: Trip={
  id:'preferences-eastbound',name:'London sleep plan',createdAt:'2026-10-01T12:00:00Z',updatedAt:'2026-10-01T12:00:00Z',
  legs:[{
    id:'preferences-flight',flightNumber:'BA178',departureAirport:'JFK',arrivalAirport:'LHR',
    departureDateTime:'2026-10-14T18:00',arrivalDateTime:'2026-10-15T06:00',
    departureTimeZone:'America/New_York',arrivalTimeZone:'Europe/London',
    stayAfter:'destination',strategy:'adapt',travelClass:'economy',lieFlat:false,
  }],
};

class PreferencesApi {
  data=emptyData();
  revision=1;
  writes: AppData[]=[];
  async install(page: Page) {
    await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'application/javascript',body:'window.google={accounts:{id:{initialize(){},renderButton(){},disableAutoSelect(){}}}};'}));
    await page.route('**/api/auth/challenge',route=>route.fulfill({json:{nonce:'preferences-test-nonce'}}));
    await page.route('**/api/config',route=>route.fulfill({json:{googleClientId:'test-client',syncAvailable:true,flightLookupAvailable:false}}));
    await page.route('**/api/me',route=>route.fulfill({json:account}));
    await page.route('**/api/state',route=> {
      expect(route.request().headers()['x-rephase-account']).toBe(account.id);
      if(route.request().method()==='GET')return route.fulfill({json:{data:this.data,revision:this.revision}});
      const body=route.request().postDataJSON() as {data:AppData;revision:number};
      if(body.revision!==this.revision)return route.fulfill({status:409,json:{error:'Changed on another device'}});
      this.data=structuredClone(body.data);this.writes.push(this.data);this.revision++;
      return route.fulfill({json:{revision:this.revision}});
    });
  }
}

async function profile(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button',{name:`${account.name}'s account menu`})).toBeVisible();
  await page.getByRole('button',{name:'Profile',exact:true}).first().click();
  const zone=page.getByRole('combobox',{name:'Home time zone',exact:true});
  await expect(zone).toBeVisible();
  await expect(page.getByLabel('Planning approach',{exact:false})).toHaveCount(0);
  return zone;
}

function zoneOptions(page: Page) {
  return page.getByRole('listbox',{name:'Time zones',exact:true});
}

test('keyboard city search saves its IANA zone and invalid free text survives Escape and blur without saving',async({page})=> {
  const api=new PreferencesApi();await api.install(page);
  await page.setViewportSize({width:1280,height:1000});
  const zone=await profile(page);
  await zone.fill('London');
  await expect(zoneOptions(page).getByRole('option').filter({hasText:'Europe/London'})).toBeVisible();
  await zone.press('ArrowDown');await zone.press('Enter');
  await expect(zone).toHaveValue('Europe/London');
  await expect(zoneOptions(page)).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Save preferences',exact:true})).toBeEnabled();
  expect(api.writes).toEqual([]);
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  await expect.poll(()=>api.data.preferences.homeTimeZone).toBe('Europe/London');
  expect(api.data.preferences.planningMode).toBe('model');
  await profile(page);
  await expect(zone).toHaveValue('Europe/London');

  await zone.fill('Tokyo');
  await zoneOptions(page).getByRole('option').filter({hasText:'Asia/Tokyo'}).click();
  await expect(zone).toHaveValue('Asia/Tokyo');
  await expect(zoneOptions(page)).toHaveCount(0);
  await zone.fill('Tokyo');await expect(zoneOptions(page)).toBeVisible();
  await zone.press('Escape');await expect(zoneOptions(page)).toHaveCount(0);
  await expect(zone).toHaveValue('Tokyo');
  await zone.fill('Mars/Olympus_Mons');await zone.press('Tab');
  await expect(zoneOptions(page)).toHaveCount(0);
  await expect(zone).toHaveValue('Mars/Olympus_Mons');
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Enter a valid home time zone');
  expect(api.data.preferences.homeTimeZone).toBe('Europe/London');
  await profile(page);
  await expect(zone).toHaveValue('Europe/London');
});

test.describe('mobile preferences',()=> {
  test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  test('touch selection and the melatonin toggle save directly and produce guidance on an eligible route',async({page})=> {
    const api=new PreferencesApi();
    api.data={...emptyData(),preferences:{...DEFAULT_PREFERENCES,homeTimeZone:'America/New_York',planningMode:'rules'},trips:[eastbound],selectedTripId:eastbound.id};
    await api.install(page);
    const zone=await profile(page);
    await zone.fill('New York');
    const option=zoneOptions(page).getByRole('option').filter({hasText:'America/New_York'});
    await expect(option).toBeVisible();
    await zone.evaluate(element=>element.scrollIntoView({block:'center'}));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'artifacts/preferences-time-zone-mobile.png'});
    await option.tap();
    await expect(zone).toHaveValue('America/New_York');
    await expect(zoneOptions(page)).toHaveCount(0);
    const melatonin=page.getByRole('checkbox',{name:/^Include melatonin guidance/});
    await expect(melatonin).not.toBeChecked();
    await page.getByText('Include melatonin guidance',{exact:true}).tap();
    await expect(melatonin).toBeChecked();
    await expect(page.getByRole('heading',{name:'Before including melatonin',exact:true})).toHaveCount(0);
    await expect(page.getByRole('checkbox',{name:/I have reviewed/})).toHaveCount(0);
    await page.getByRole('button',{name:'Save preferences',exact:true}).tap();
    await expect.poll(()=>api.data.preferences.melatonin).toBe(true);
    expect(api.data.preferences.melatoninAcknowledged).toBe(false);
    expect(api.data.preferences.planningMode).toBe('rules');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await profile(page);
    await expect(melatonin).toBeChecked();
    await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:'Your plan',exact:true}).tap();
    const days=page.locator('.day-button');await expect(days.first()).toBeVisible();
    let foundGuidance=false;
    for(let index=0;index<await days.count();index++) {
      await days.nth(index).tap();
      const guidance=page.getByRole('heading',{name:/^Optional melatonin/}).first();
      if(await guidance.count()) {
        await expect(guidance).toBeVisible();
        await expect(page.locator('.dose-label').first()).toContainText('0.5–1 mg');
        await guidance.evaluate(element=>element.closest('.action-card')!.scrollIntoView({block:'center'}));
        await page.screenshot({path:'artifacts/preferences-melatonin-guidance-mobile.png'});
        foundGuidance=true;break;
      }
    }
    expect(foundGuidance,'The established eastbound fixture should offer optional bedtime guidance.').toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
});

test('a saved IANA alias and legacy rules mode survive unrelated saves until a new zone is explicitly selected',async({page})=> {
  const api=new PreferencesApi();api.data.preferences={...DEFAULT_PREFERENCES,homeTimeZone:'US/Eastern',planningMode:'rules'};
  await api.install(page);
  const zone=await profile(page);
  await expect(zone).toHaveValue('US/Eastern');
  await zone.focus();await zone.press('Escape');await zone.press('Tab');
  await expect(zone).toHaveValue('US/Eastern');
  await page.getByLabel('Hours of sleep you need').fill('9');
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  await expect.poll(()=>api.data.preferences.sleepHours).toBe(9);
  expect(api.data.preferences.homeTimeZone).toBe('US/Eastern');
  expect(api.data.preferences.planningMode).toBe('rules');
  await profile(page);await expect(zone).toHaveValue('US/Eastern');
  await zone.fill('US/Eastern');
  await expect(zoneOptions(page).getByRole('option').filter({hasText:'America/New_York'})).toBeVisible();
  await zone.press('ArrowDown');await zone.press('Enter');
  await expect(zone).toHaveValue('America/New_York');
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  await expect.poll(()=>api.data.preferences.homeTimeZone).toBe('America/New_York');
  expect(api.data.preferences.planningMode).toBe('rules');
  await profile(page);await expect(zone).toHaveValue('America/New_York');
});
