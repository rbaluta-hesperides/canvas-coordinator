import { expect } from '@playwright/test';

export async function openWeeklyCustomization(page) {
  const details = page.locator('#weekly-customization');
  await expect(details).toBeAttached();
  if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
  await expect(details).toHaveJSProperty('open', true);
}

export async function openWeekRangeOptions(page) {
  const details = page.locator('#week-range-options');
  await expect(details).toBeAttached();
  if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
  await expect(details).toHaveJSProperty('open', true);
}

export async function openWeekSources(page) {
  await openWeekRangeOptions(page);
  const details = page.locator('.week-sources');
  if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
  await expect(details).toHaveJSProperty('open', true);
}
