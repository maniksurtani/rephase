import { test, expect } from '@playwright/test';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';

test.beforeEach(async({page})=> {
  await page.route('**/api/config',route=>route.fulfill({json:{googleClientId:null,syncAvailable:false}}));
});

test('desktop example produces a dated plan and calendar export',async({page})=> {
  await page.setViewportSize({width:1440,height:1000});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'New time zone. Same you.'})).toBeVisible();
  await expect(page.getByText('Example trip',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Explore your plan'}).click();
  await expect(page.getByRole('heading',{name:'Your travel plan'})).toBeVisible();
  await expect(page.getByText('All times in',{exact:false})).toBeVisible();
  const downloadEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'Calendar',exact:true}).click();
  const download=await downloadEvent;
  expect(download.suggestedFilename()).toBe('rephase-plan.ics');
  expect(errors).toEqual([]);
});

test('mobile preferences persist after reload without overflow',async({page})=> {
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:'Profile',exact:true}).click();
  await page.getByLabel('Hours of sleep you need').fill('9');
  await page.getByRole('button',{name:'Save preferences'}).click();
  await page.reload();
  await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:'Profile',exact:true}).click();
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('9');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await expect(page.getByText('Google sign-in needs a client ID',{exact:false})).toBeVisible();
});

test('editing the example preserves keyboard focus and creates a personal itinerary',async({page})=> {
  await page.goto('/');await page.getByRole('button',{name:'Explore your plan'}).click();
  await page.getByRole('button',{name:'Edit trip',exact:true}).click();
  const name=page.getByLabel('Trip name');await name.fill('My personal itinerary');
  await name.press('End');await name.pressSequentially('!');
  await expect(name).toBeFocused();
  await page.getByLabel('Travel class').first().selectOption('business');
  await page.getByLabel('Lie-flat bed available?').first().selectOption('no');
  await page.getByRole('button',{name:'Save & regenerate plan'}).click();
  await expect(page.getByRole('heading',{name:'My personal itinerary!',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit trip',exact:true}).click();
  await expect(page.getByLabel('Travel class').first()).toHaveValue('business');
  await expect(page.getByLabel('Lie-flat bed available?').first()).toHaveValue('no');
  await expect(page.getByText('Example trip',{exact:true})).toHaveCount(0);
  await page.reload();await page.getByRole('button',{name:'Explore your plan'}).click();
  await expect(page.getByRole('heading',{name:'My personal itinerary!',exact:true})).toBeVisible();
});

test('invalid arrival ordering is rejected and the draft remains editable',async({page})=> {
  await page.goto('/');await page.getByRole('button',{name:'Explore your plan'}).click();
  await page.getByRole('button',{name:'Edit trip',exact:true}).click();
  await page.getByLabel('Local arrival date & time').first().fill('2020-01-01T01:00');
  await page.getByRole('button',{name:'Save & regenerate plan'}).click();
  await expect(page.getByText('Flight 1: arrival must follow departure in real time.')).toBeVisible();
  await expect(page.getByLabel('Trip name')).toBeVisible();
});

test('production shell and a saved account namespace reopen offline',async({page,context})=> {
  await page.goto('/');await expect(page.getByText('Example trip',{exact:true})).toBeVisible();
  await page.evaluate(async()=> {await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  await page.evaluate(async preferences=> {
    const database=await new Promise<IDBDatabase>((resolve,reject)=> {const request=indexedDB.open('rephase',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const transaction=database.transaction('state','readwrite');
    transaction.objectStore('state').put({id:'offline-account',name:'Offline traveler',email:'traveler@example.com'},'lastAccount');
    transaction.objectStore('state').put({schemaVersion:1,preferences:{...preferences,sleepHours:9.5},trips:[],selectedTripId:null},'account:offline-account');
    await new Promise<void>((resolve,reject)=> {transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);});database.close();
  },DEFAULT_PREFERENCES);
  await context.setOffline(true);await page.reload();
  await page.getByRole('button',{name:'Profile',exact:true}).first().click();
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('9.5');
  await expect(page.getByText('Offline account copy',{exact:false})).toBeVisible();
  const cached=await page.evaluate(async()=> {const names=await caches.keys();const all=await Promise.all(names.map(async name=>(await (await caches.open(name)).keys()).map(request=>new URL(request.url).pathname)));return all.flat();});
  expect(cached.some(path=>path.startsWith('/api/'))).toBe(false);
});

test('stale cloud revisions preserve local edits across reload until a choice is made',async({page})=> {
  let revision=1;
  let cloud={schemaVersion:1,preferences:{...DEFAULT_PREFERENCES},trips:[],selectedTripId:null};
  await page.route('**/api/config',route=>route.fulfill({json:{googleClientId:'test-client',syncAvailable:true}}));
  await page.route('**/api/me',route=>route.fulfill({json:{id:'account-a',name:'Traveler',email:'traveler@example.com'}}));
  await page.route('**/api/state',async route=> {
    expect(route.request().headers()['x-rephase-account']).toBe('account-a');
    if(route.request().method()==='GET')return route.fulfill({json:{data:cloud,revision}});
    const body=route.request().postDataJSON();
    if(body.revision!==revision)return route.fulfill({status:409,json:{error:'Changed on another device'}});
    cloud=body.data;revision+=1;return route.fulfill({json:{revision}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Profile',exact:true}).first().click();
  await page.getByLabel('Hours of sleep you need').fill('9');await page.getByRole('button',{name:'Save preferences'}).click();
  revision=2;cloud={...cloud,preferences:{...cloud.preferences,sleepHours:7.5}};
  await page.getByRole('button',{name:'Sync my data'}).click();
  await expect(page.getByRole('dialog',{name:'Two copies, one choice'})).toBeVisible();
  await page.getByRole('button',{name:'Keep working locally'}).click();
  await page.reload();await page.getByRole('button',{name:'Profile',exact:true}).first().click();
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('9');
  await page.getByRole('button',{name:'Sync my data'}).click();
  await expect(page.getByRole('dialog',{name:'Two copies, one choice'})).toBeVisible();
  await page.getByRole('button',{name:'Use cloud copy',exact:true}).click();
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('7.5');
});
