import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import type { Account, AppData } from '../src/lib/types';

const account: Account = {id:'account-a',name:'Test Traveler',email:'traveler@example.com',picture:'https://lh3.googleusercontent.com/a/test-avatar'};
const emptyData = (sleepHours = 8): AppData => ({schemaVersion:1,preferences:{...DEFAULT_PREFERENCES,sleepHours},trips:[],selectedTripId:null});
const googleSdk = `
(() => {
  let options;
  window.google = {accounts:{id:{
    initialize(value) { options = value; },
    renderButton(container, buttonOptions) {
      const button = document.createElement('button');
      button.setAttribute('aria-label', 'Continue with Google');
      button.textContent = buttonOptions.type === 'icon' ? 'G' : 'Continue with Google';
      button.style.width = buttonOptions.type === 'icon' ? '40px' : buttonOptions.width + 'px';
      button.style.height = '40px';
      button.addEventListener('click', () => {
        buttonOptions.click_listener?.();
        options.callback({credential:'test-google-credential'});
      });
      container.append(button);
    },
    disableAutoSelect() {}
  }}};
})();`;

class AccountApi {
  identity = account;
  authenticated = true;
  available = true;
  offlinePages = new Set<Page>();
  data: AppData | null = emptyData();
  revision = 1;
  writes: AppData[] = [];
  challengeRequests = 0;
  googleRequests = 0;
  logoutRequests = 0;
  stateReads = 0;
  rejectNextWrite = false;

  async install(context: BrowserContext) {
    await context.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'application/javascript',body:googleSdk}));
    await context.route(account.picture!,route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#bda6ef"/></svg>'}));
    await context.route('**/api/config',route=>route.fulfill({json:{googleClientId:'test-client',syncAvailable:true,flightLookupAvailable:false}}));
    await context.route('**/api/me',route=> {
      if(!this.available || this.offlinePages.has(route.request().frame().page()))return route.abort('internetdisconnected');
      return this.authenticated ? route.fulfill({json:this.identity}) : route.fulfill({status:401,json:{error:'Sign in required'}});
    });
    await context.route('**/api/auth/challenge',route=> {
      this.challengeRequests++;
      return route.fulfill({json:{nonce:'test-nonce'}});
    });
    await context.route('**/api/auth/google',route=> {
      this.googleRequests++;
      expect(route.request().postDataJSON()).toEqual({credential:'test-google-credential'});
      this.authenticated=true;
      return route.fulfill({json:this.identity});
    });
    await context.route('**/api/auth/logout',route=> {
      this.logoutRequests++;
      this.authenticated=false;
      return route.fulfill({json:{ok:true}});
    });
    await context.route('**/api/state',route=> {
      if(!this.available || this.offlinePages.has(route.request().frame().page()))return route.abort('internetdisconnected');
      expect(route.request().headers()['x-rephase-account']).toBe(this.identity.id);
      if(!this.authenticated)return route.fulfill({status:401,json:{error:'Session expired. Sign in again.'}});
      if(route.request().method()==='GET') {
        this.stateReads++;
        return route.fulfill({json:{data:this.data,revision:this.revision}});
      }
      const body=route.request().postDataJSON() as {data:AppData;revision:number};
      if(this.rejectNextWrite) {
        this.rejectNextWrite=false;
        this.data=emptyData(7.5);
        this.revision++;
      }
      if(body.revision!==this.revision)return route.fulfill({status:409,json:{error:'Changed on another device'}});
      this.data=body.data;
      this.writes.push(structuredClone(body.data));
      this.revision++;
      return route.fulfill({json:{revision:this.revision}});
    });
  }
}

async function seedState(page: Page, records: Record<string, unknown>) {
  await page.goto('/science.html');
  await page.evaluate(async values=> {
    const database=await new Promise<IDBDatabase>((resolve,reject)=> {
      const request=indexedDB.open('rephase',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('state');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    const transaction=database.transaction('state','readwrite');
    for(const [key,value] of Object.entries(values))transaction.objectStore('state').put(value,key);
    await new Promise<void>((resolve,reject)=> {transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);});
    database.close();
  },records);
}

async function profile(page: Page) {
  await page.getByRole('button',{name:'Profile',exact:true}).first().click();
  await expect(page.getByLabel('Hours of sleep you need')).toBeVisible();
}

async function changeSleep(page: Page, value: string) {
  await page.getByLabel('Hours of sleep you need').fill(value);
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
}

test('an existing account opens server preferences instead of a stale device copy',async({page,context})=> {
  const api=new AccountApi();api.data=emptyData(7.5);api.revision=4;
  await api.install(context);
  await seedState(page,{
    lastAccount:account,
    [`account:${account.id}`]:emptyData(9),
    [`snapshot:account:${account.id}`]:{data:emptyData(9),revision:1},
  });
  await page.goto('/');await profile(page);
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('7.5');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/sync my data|sign in with google again/i})).toHaveCount(0);
  await expect(page.getByText('Signed in',{exact:true})).toHaveCount(0);
  expect(api.writes).toEqual([]);
});

test('Google sign-in is direct and a new account does not overwrite itself with guest data',async({page,context})=> {
  const api=new AccountApi();api.authenticated=false;api.data=null;api.revision=0;
  await api.install(context);
  await seedState(page,{guest:emptyData(9.5)});
  await page.goto('/');
  const google=page.getByRole('button',{name:'Continue with Google',exact:true});
  await expect(google).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({width:1120,height:900});await profile(page);
  await google.last().scrollIntoViewIfNeeded();
  await page.screenshot({path:'artifacts/account-guest-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await google.last().scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/account-guest-mobile.png'});
  await google.last().click();
  await expect(page.getByRole('button',{name:`${account.name}'s account menu`})).toBeVisible();
  await profile(page);
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('8');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Choose your starting data',{exact:true})).toHaveCount(0);
  expect(api.googleRequests).toBe(1);
  expect(api.writes.every(data=>data.preferences.sleepHours!==9.5)).toBe(true);
  await page.getByRole('button',{name:`${account.name}'s account menu`}).click();
  await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('9.5');
});

test('saved preferences appear after reload and on another device without a sync action',async({page,context,browser})=> {
  const api=new AccountApi();await api.install(context);
  await page.goto('/');await expect.poll(()=>api.stateReads).toBeGreaterThan(0);await profile(page);
  await changeSleep(page,'9');
  await expect.poll(()=>api.data?.preferences.sleepHours).toBe(9);
  await page.reload();await profile(page);
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('9');
  const secondContext=await browser.newContext({baseURL:'http://127.0.0.1:4173',serviceWorkers:'block'});
  try {
    await api.install(secondContext);
    const secondPage=await secondContext.newPage();
    await secondPage.goto('/');await profile(secondPage);
    await expect(secondPage.getByLabel('Hours of sleep you need')).toHaveValue('9');
    await expect(secondPage.getByRole('dialog')).toHaveCount(0);
  } finally {await secondContext.close();}
});

test('Google avatar opens an accessible account menu containing sign out',async({page,context})=> {
  const api=new AccountApi();await api.install(context);
  await page.setViewportSize({width:1120,height:900});await page.goto('/');
  await expect.poll(()=>api.stateReads).toBeGreaterThan(0);await profile(page);
  const trigger=page.getByRole('button',{name:`${account.name}'s account menu`});
  await expect(trigger.locator('img')).toHaveAttribute('src',account.picture!);
  await trigger.press('ArrowDown');
  const menu=page.getByRole('menu',{name:'Your account'});
  await expect(menu).toBeVisible();
  await expect(page.getByRole('menuitem',{name:'Sleep preferences'})).toBeFocused();
  await page.screenshot({path:'artifacts/account-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'artifacts/account-mobile.png'});
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem',{name:'Sign out',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('button',{name:'Continue with Google',exact:true}).first()).toBeVisible();
  expect(api.logoutRequests).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('offline edits save automatically after reconnecting to the same account',async({page,context})=> {
  const api=new AccountApi();await api.install(context);
  await page.goto('/');await expect.poll(()=>api.stateReads).toBeGreaterThan(0);await profile(page);
  api.available=false;
  await context.setOffline(true);
  await changeSleep(page,'9.5');
  await expect(page.getByRole('status').filter({hasText:/offline|connection|reconnect/i}).first()).toBeVisible();
  expect(api.data?.preferences.sleepHours).toBe(8);
  api.available=true;await context.setOffline(false);
  await expect.poll(()=>api.data?.preferences.sleepHours,{timeout:30_000}).toBe(9.5);
  await page.reload();await profile(page);
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('9.5');
});

test('an expired session preserves edits and requests Google only when authentication is needed',async({page,context})=> {
  const api=new AccountApi();await api.install(context);
  await page.goto('/');await expect.poll(()=>api.stateReads).toBeGreaterThan(0);await profile(page);
  await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toHaveCount(0);
  api.authenticated=false;
  await changeSleep(page,'9');
  await expect(page.getByRole('status').filter({hasText:/sign in|session/i}).first()).toBeVisible();
  expect(api.data?.preferences.sleepHours).toBe(8);
  await page.getByRole('button',{name:`${account.name}'s account menu`}).click();
  await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
  await expect.poll(()=>api.data?.preferences.sleepHours,{timeout:30_000}).toBe(9);
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('9');
  expect(api.googleRequests).toBe(1);
});

test('a simultaneous conflicting edit preserves both versions until an explicit choice',async({page,context})=> {
  const api=new AccountApi();await api.install(context);
  await page.goto('/');await expect.poll(()=>api.stateReads).toBeGreaterThan(0);await profile(page);
  api.rejectNextWrite=true;
  await changeSleep(page,'9');
  const conflict=page.getByRole('dialog',{name:'Choose which changes to keep'});
  await expect(conflict).toBeVisible();
  expect(api.data?.preferences.sleepHours).toBe(7.5);
  expect(api.writes).toEqual([]);
  await page.getByRole('button',{name:'Decide later',exact:true}).click();
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('9');
  await page.reload();
  await expect(conflict).toBeVisible();
  await page.getByRole('button',{name:'Use saved account version',exact:true}).click();
  await expect(conflict).toHaveCount(0);await profile(page);
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('7.5');
  expect(api.data?.preferences.sleepHours).toBe(7.5);
  expect(api.writes).toEqual([]);
});

test('a preference draft survives account refresh and resets when the account changes',async({page,context})=> {
  const api=new AccountApi();await api.install(context);
  await page.goto('/');await expect.poll(()=>api.stateReads).toBeGreaterThan(0);await profile(page);
  await page.getByLabel('Hours of sleep you need').fill('9');
  api.data={...api.data!,preferences:{...api.data!.preferences,preparationDays:2,caffeine:false}};api.revision++;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Start preparing before departure')).toHaveValue('2');
  await expect(page.getByRole('checkbox',{name:/Include caffeine windows/})).not.toBeChecked();
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('9');
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  await expect.poll(()=>api.data?.preferences.sleepHours).toBe(9);
  expect(api.data?.preferences.preparationDays).toBe(2);
  expect(api.data?.preferences.caffeine).toBe(false);
  await expect(page.locator('.account-save-status')).toHaveCount(0);
  await page.getByLabel('Hours of sleep you need').fill('9.5');
  api.identity={...account,id:'account-b',name:'Second Traveler',email:'other@example.com'};
  api.data=emptyData(7.5);api.revision=1;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button',{name:"Second Traveler's account menu"})).toBeVisible();
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('7.5');
  expect(api.writes).toHaveLength(1);
});

test('independent offline edits in two tabs survive a clean third tab refresh and reload',async({page,context})=> {
  const api=new AccountApi();await api.install(context);
  await page.goto('/');await expect.poll(()=>api.stateReads).toBeGreaterThan(0);await profile(page);
  const second=await context.newPage(),clean=await context.newPage();
  await second.goto('/');await expect.poll(()=>api.stateReads).toBeGreaterThan(1);await profile(second);
  await clean.goto('/');await expect.poll(()=>api.stateReads).toBeGreaterThan(2);await profile(clean);
  // Only these tabs lose API access; the clean tab can still refresh its older server view.
  api.offlinePages.add(page);api.offlinePages.add(second);
  await changeSleep(page,'9');
  await second.getByLabel('Start preparing before departure').selectOption('2');
  await second.getByRole('button',{name:'Save preferences',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:/offline/i}).first()).toBeVisible();
  await expect(second.getByRole('status').filter({hasText:/offline/i}).first()).toBeVisible();
  expect(api.data?.preferences.sleepHours).toBe(8);
  expect(api.data?.preferences.preparationDays).toBe(3);
  await clean.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(()=>({sleep:api.data?.preferences.sleepHours,preparation:api.data?.preferences.preparationDays}),{timeout:30_000}).toEqual({sleep:9,preparation:2});
  await clean.reload();await profile(clean);
  await expect(clean.getByLabel('Hours of sleep you need')).toHaveValue('9');
  await expect(clean.getByLabel('Start preparing before departure')).toHaveValue('2');
  api.offlinePages.clear();
  await page.reload();await profile(page);
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('9');
  await expect(page.getByLabel('Start preparing before departure')).toHaveValue('2');
  await second.close();await clean.close();
});
