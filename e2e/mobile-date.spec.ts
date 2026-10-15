import { test, expect, type Locator } from '@playwright/test';

/** Native WebKit controls can overflow a grid item without widening the document. */
async function expectControlInsideFlight(input: Locator) {
  await input.scrollIntoViewIfNeeded();
  await expect(input).toBeVisible();
  await expect(input).toBeEditable();
  const bounds=await input.evaluate(element=> {
    const field=element.closest('.field')!;
    const card=element.closest('.flight-editor-card')!;
    const inputBox=element.getBoundingClientRect();
    const fieldBox=field.getBoundingClientRect();
    const cardBox=card.getBoundingClientRect();
    return {
      left:inputBox.left,right:inputBox.right,width:inputBox.width,
      fieldLeft:fieldBox.left,fieldRight:fieldBox.right,
      cardLeft:cardBox.left,cardRight:cardBox.right,
      viewportWidth:window.innerWidth,
    };
  });
  expect(bounds.width).toBeGreaterThan(0);
  expect(bounds.left).toBeGreaterThanOrEqual(bounds.fieldLeft-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.fieldRight+1);
  expect(bounds.left).toBeGreaterThanOrEqual(bounds.cardLeft-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.cardRight+1);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
}

for(const width of [375,390]) {
  test(`native flight date and time controls fit a ${width}px mobile screen`,async({page})=> {
    await page.setViewportSize({width,height:844});
    await page.route('**/api/config',route=>route.fulfill({json:{googleClientId:null,syncAvailable:false,flightLookupAvailable:false}}));
    await page.goto('/');
    await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:'Trips',exact:true}).click();
    await page.getByRole('button',{name:'New trip',exact:true}).click();
    const editor=page.getByRole('dialog',{name:'Plan a new journey',exact:true});
    const date=editor.getByLabel('Departure date at the departure airport');
    await expect(date).toHaveAttribute('type','date');
    await expectControlInsideFlight(date);
    await date.fill('2026-12-28');
    await date.blur();
    await expect(date).toHaveValue('2026-12-28');
    await expectControlInsideFlight(date);
    await page.screenshot({path:`artifacts/mobile-date-webkit-${width}.png`});

    await editor.getByRole('button',{name:'Enter manually',exact:true}).click();
    const departure=editor.getByLabel('Local departure date & time');
    const arrival=editor.getByLabel('Local arrival date & time');
    await departure.fill('2026-12-28T23:45');
    await arrival.fill('2026-12-30T00:15');
    await expect(date).toHaveValue('2026-12-28');
    await editor.locator('.flight-operations > summary').click();
    const takeoff=editor.getByLabel('Known takeoff time (departure local, optional)');
    const landing=editor.getByLabel('Known landing time (arrival local, optional)');
    for(const [control,value] of [[takeoff,'2026-12-29T00:10'],[landing,'2026-12-29T23:35']] as const) {
      await control.fill(value);
      await control.blur();
      await expect(control).toHaveValue(value);
      await expect(control).toHaveAttribute('type','datetime-local');
      await expect(control).toHaveAttribute('step','60');
      await expectControlInsideFlight(control);
    }
    for(const control of [departure,arrival]) {
      await expect(control).toHaveAttribute('type','datetime-local');
      await expect(control).toHaveAttribute('step','60');
      await expectControlInsideFlight(control);
    }
    await departure.scrollIntoViewIfNeeded();
    await page.screenshot({path:`artifacts/mobile-manual-date-webkit-${width}.png`});

    // Reopening the optional manual panel must retain the minute-resolution booking.
    await editor.getByRole('button',{name:'Hide manual details',exact:true}).click();
    await editor.getByRole('button',{name:'Enter manually',exact:true}).click();
    await expect(departure).toHaveValue('2026-12-28T23:45');
    await expect(arrival).toHaveValue('2026-12-30T00:15');
    await expect(takeoff).toHaveValue('2026-12-29T00:10');
    await expect(landing).toHaveValue('2026-12-29T23:35');
    await expectControlInsideFlight(departure);
    // Changing a gate time invalidates the previously entered airborne times.
    await departure.fill('2026-12-28T22:45');
    await expect(takeoff).toHaveValue('');
    await expect(landing).toHaveValue('');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  });
}
