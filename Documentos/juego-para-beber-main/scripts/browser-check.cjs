const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true });
  const errors = [];
  const contexts = [];
  const pages = [];
  try {
    for (let i = 0; i < 3; i++) {
      const ctx = await browser.newContext({ viewport: { width: i ? 390 : 1440, height: i ? 844 : 1000 }, reducedMotion: 'reduce' });
      contexts.push(ctx);
      const p = await ctx.newPage(); pages.push(p);
      p.on('pageerror', e => errors.push(e.message));
      await p.goto(process.env.APP_URL || 'http://localhost:4300');
      await p.getByRole('heading', { name: /No hace falta/ }).waitFor();
    }
    const [host, guest, other] = pages;
    for (const width of [320, 390, 768, 1440]) {
      await host.setViewportSize({width, height:1000});
      assert.ok(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Home overflow at ${width}`);
    }
    await host.screenshot({ path: 'docs/home-desktop.png', fullPage: true });
    await guest.screenshot({ path: 'docs/home-mobile.png', fullPage: true });
    for (const p of pages) assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
    await host.getByRole('button', { name: /Crear sala/ }).click();
    await host.getByLabel('Tu nombre', { exact: true }).fill('Ana QA');
    await host.getByRole('button', { name: 'Crear sala', exact: true }).click();
    await host.waitForURL('**/lobby');
    const session = await host.evaluate(() => JSON.parse(sessionStorage.getItem('aproximados_session')));
    assert.equal(session.reconnectToken.length, 64);
    console.log('PASS create room + private recovery token');
    await guest.getByRole('button', { name: /Tengo un código/ }).click();
    await guest.getByRole('textbox', { name: /Código de sala/ }).fill('ZZZZ');
    await guest.getByRole('button', { name: /Comprobar/ }).click();
    await guest.getByRole('alert').filter({ hasText: /No existe/ }).waitFor();
    await guest.getByRole('textbox', { name: /Código de sala/ }).fill(session.roomCode.toLowerCase());
    await guest.getByRole('button', { name: /Comprobar/ }).click();
    await guest.getByLabel('Tu nombre', { exact: true }).fill('Bob QA');
    await guest.getByRole('button', { name: /Unirse a la sala/ }).click();
    await guest.waitForURL('**/lobby');
    console.log('PASS invalid code + join with lowercase code');
    await other.goto(`${process.env.APP_URL || 'http://localhost:4300'}/join/${session.roomCode}`);
    await other.getByLabel('Tu nombre', { exact: true }).fill('Cris QA');
    await other.getByRole('button', { name: /Unirse a la sala/ }).click();
    await other.waitForURL('**/lobby');
    await host.screenshot({ path: 'docs/lobby-desktop.png', fullPage: true });
    await guest.screenshot({ path: 'docs/lobby-mobile.png', fullPage: true });
    console.log('PASS invite URL');
    await guest.reload();
    await guest.getByText('Cris QA', { exact: true }).waitFor();
    assert.equal(await guest.locator('.player-chip').filter({ hasText: 'Bob QA' }).count(), 1);
    console.log('PASS reload restores seat without duplicate');
    await host.getByRole('button', { name: /Todos responden/ }).click();
    await guest.getByRole('button', { name: /Todos responden/ }).filter({ has: guest.locator('small', { hasText: 'Seleccionado' }) }).waitFor();
    assert.equal(await guest.getByRole('button', { name: /Todos responden/ }).isDisabled(), true);
    await host.getByRole('button', { name: /Solo pregunta/ }).click();
    await guest.getByRole('button', { name: /Solo pregunta/ }).filter({ has: guest.locator('small', { hasText: 'Seleccionado' }) }).waitFor();
    console.log('PASS host-only mode selection synchronizes with guests');
    await host.getByRole('button', { name: /Empezar partida/ }).click();
    await Promise.all(pages.map(p => p.waitForURL('**/game')));
    let writer;
    for (const p of pages) if (await p.locator('#question-input').count()) writer = p;
    assert.ok(writer, 'one redactor');
    await writer.locator('#question-input').fill('¿Cuántos huesos tiene un adulto?');
    await writer.getByRole('button', { name: /Enviar pregunta/ }).click();
    const estimators = pages.filter(p => p !== writer);
    assert.equal(await writer.locator('#guess-input').count(), 0);
    console.log('PASS Solo pregunta excludes writer');
    await estimators[0].locator('#guess-input').fill('200');
    await estimators[0].getByRole('button', { name: /Enviar estimación/ }).click();
    await estimators[0].getByRole('heading', { name: 'Estimación enviada' }).waitFor();
    await estimators[1].screenshot({ path: 'docs/game-mobile.png', fullPage: true });
    await estimators[0].reload();
    await estimators[0].getByRole('heading', { name: 'Estimación enviada' }).waitFor();
    console.log('PASS question + guess + private guess survives reload');
    await estimators[1].locator('#guess-input').fill('300');
    await estimators[1].getByRole('button', { name: /Enviar estimación/ }).click();
    // With no local API key, the round returns to writing instead of inventing a result.
    await writer.locator('#question-input').waitFor({ timeout: 30000 });
    console.log('PASS unavailable AI returns to question entry');
    // Leave the first game and verify the inclusive mode in another real room.
    for (const p of pages) {
      await p.evaluate(async () => {
        const component = window.ng.getComponent(document.querySelector('app-game'));
        await component.roomService.leaveRoom();
      });
      await p.waitForURL(url => url.pathname === '/');
    }
    await host.getByRole('button', { name: /Crear sala/ }).click();
    await host.getByLabel('Tu nombre', { exact: true }).fill('Ana modo');
    await host.getByRole('button', { name: 'Crear sala', exact: true }).click();
    await host.waitForURL('**/lobby');
    const inclusiveSession = await host.evaluate(() => JSON.parse(sessionStorage.getItem('aproximados_session')));
    for (let i = 1; i < pages.length; i++) {
      await pages[i].goto(`${process.env.APP_URL || 'http://localhost:4300'}/join/${inclusiveSession.roomCode}`);
      await pages[i].getByLabel('Tu nombre', { exact: true }).fill(['', 'Bob modo', 'Cris modo'][i]);
      await pages[i].getByRole('button', { name: /Unirse a la sala/ }).click();
      await pages[i].waitForURL('**/lobby');
    }
    await host.getByRole('button', { name: /Todos responden/ }).click();
    await host.getByRole('button', { name: /Empezar partida/ }).click();
    await Promise.all(pages.map(p => p.waitForURL('**/game')));
    const inclusiveWriter = (await Promise.all(pages.map(async p => await p.locator('#question-input').count() ? p : null))).find(Boolean);
    assert.ok(inclusiveWriter);
    await inclusiveWriter.locator('#question-input').fill('¿Cuántos huesos tiene un adulto?');
    await inclusiveWriter.getByRole('button', { name: /Enviar pregunta/ }).click();
    await Promise.all(pages.map(p => p.locator('#guess-input').waitFor()));
    for (const p of pages) assert.ok(await p.getByText('0/3', { exact: true }).count());
    await inclusiveWriter.locator('#guess-input').fill('206');
    await inclusiveWriter.getByRole('button', { name: /Enviar estimación/ }).click();
    await inclusiveWriter.getByRole('heading', { name: 'Estimación enviada' }).waitFor();
    await inclusiveWriter.reload();
    await inclusiveWriter.getByRole('heading', { name: 'Estimación enviada' }).waitFor();
    await inclusiveWriter.screenshot({ path: 'docs/redactor-responde-mobile.png', fullPage: true });
    console.log('PASS Todos responden accepts writer guess and preserves it after reload');
    for (const p of pages.filter(p => p !== inclusiveWriter)) {
      await p.locator('#guess-input').fill('210');
      await p.getByRole('button', { name: /Enviar estimación/ }).click();
    }
    await inclusiveWriter.locator('#question-input').waitFor({ timeout: 30000 });
    console.log('PASS inclusive round completes collection without blocking');
    for (const p of pages) assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Game horizontal overflow');
    assert.deepEqual(errors, []);
    console.log('PASS zero JS errors; desktop/mobile no horizontal overflow');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
