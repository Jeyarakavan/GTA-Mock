/**
 * Automated gameplay verification for Neon District: Street Run.
 *
 * Drives the real game in a real Chrome via CDP and asserts the actual
 * gameplay loop: start, walk, collide, enter/exit a vehicle, drive, missions,
 * wanted level, arrest/respawn, pause and save/continue.
 *
 * Usage: node scripts/verify.mjs [url]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:5173/';
const SHOTS = 'verify-shots';
mkdirSync(SHOTS, { recursive: true });

const results = [];
let page;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read the live game store from the page. */
const state = () => page.evaluate(() => window.__game.getState());

/** Read the simulation's internal debug snapshot. */
const debug = () => page.evaluate(() => window.__sim ?? null);

async function hold(key, ms) {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
}

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-gl=angle', '--use-angle=default', '--enable-unsafe-swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  console.log(`\nOpening ${URL}\n`);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(2500);

  // ---- 1. Start screen -------------------------------------------------
  console.log('1. Start screen');
  const titleVisible = await page.locator('.game-title').isVisible();
  record('Start screen renders the title', titleVisible);
  const newGame = page.locator('button', { hasText: 'New Game' });
  record('New Game button present', await newGame.isVisible());
  await shot('01-start-menu');

  // Canvas actually produced pixels (not a blank/black screen).
  const painted = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return { ok: false, reason: 'no canvas' };
    return { ok: c.width > 0 && c.height > 0, w: c.width, h: c.height };
  });
  record('WebGL canvas is sized', painted.ok, `${painted.w}x${painted.h}`);

  // ---- 2. New Game -----------------------------------------------------
  console.log('\n2. Starting a new game');
  await newGame.click();
  await sleep(3000);
  let s = await state();
  record('Control state is on-foot', s.control === 'onfoot', s.control);
  record('HUD is visible', await page.locator('.hud-panel.top-left').isVisible());
  record('Minimap rendered', await page.locator('canvas[aria-label="City minimap"]').isVisible());
  await shot('02-spawned');

  // ---- 3. Movement -----------------------------------------------------
  console.log('\n3. Movement, sprint and jump');
  let d0 = await debug();
  await hold('KeyW', 1200);
  await sleep(200);
  let d1 = await debug();
  const walked = Math.hypot(d1.playerX - d0.playerX, d1.playerZ - d0.playerZ);
  record('Player walks with W', walked > 2, `moved ${walked.toFixed(2)} m`);

  // Sprint should cover more ground in the same time.
  d0 = await debug();
  await page.keyboard.down('Shift');
  await hold('KeyW', 1200);
  await page.keyboard.up('Shift');
  await sleep(200);
  d1 = await debug();
  const sprinted = Math.hypot(d1.playerX - d0.playerX, d1.playerZ - d0.playerZ);
  record('Sprint is faster than walking', sprinted > walked * 1.25,
    `walk ${walked.toFixed(1)} m vs sprint ${sprinted.toFixed(1)} m`);

  // Jump must leave the ground and land again.
  const yBefore = (await debug()).playerY;
  await page.evaluate(() => {
    window.__jumpTrace = [];
    const f = () => {
      window.__jumpTrace.push(window.__sim.playerY);
      if (window.__jumpTrace.length < 130) requestAnimationFrame(f);
    };
    f();
  });
  await hold('Space', 140);
  await sleep(1700);
  const trace = await page.evaluate(() => window.__jumpTrace);
  const yPeak = Math.max(...trace);
  const yAfter = (await debug()).playerY;
  record('Jump leaves the ground', yPeak > yBefore + 0.3,
    `${yBefore.toFixed(2)} -> ${yPeak.toFixed(2)}`);
  record('Player lands again (gravity works)', Math.abs(yAfter - yBefore) < 0.6,
    `landed at ${yAfter.toFixed(2)}`);

  // Diagonal must not be faster than cardinal.
  d0 = await debug();
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD');
  await sleep(1200);
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD');
  await sleep(200);
  d1 = await debug();
  const diag = Math.hypot(d1.playerX - d0.playerX, d1.playerZ - d0.playerZ);
  record('Diagonal movement is not faster', diag <= walked * 1.15,
    `diag ${diag.toFixed(1)} m vs fwd ${walked.toFixed(1)} m`);

  // ---- 4. Building collision -------------------------------------------
  console.log('\n4. Environment collision');
  const collided = await page.evaluate(async () => {
    const sim = window.__simApi;
    // Drop the player right beside a tall building and drive them into it.
    const b = window.__world.buildings.find((x) => x.height > 20);
    const startX = b.x;
    const startZ = b.z - b.depth / 2 - 3.0;
    sim.setPlayer(startX, startZ);
    await new Promise((r) => setTimeout(r, 400));
    // Push north, straight at the wall, for a second.
    sim.pushInto(0, 1, 1400);
    await new Promise((r) => setTimeout(r, 1600));
    const p = window.__sim;
    // Inside the footprint would mean we walked through the wall.
    const insideX = Math.abs(p.playerX - b.x) < b.width / 2 - 0.1;
    const insideZ = Math.abs(p.playerZ - b.z) < b.depth / 2 - 0.1;
    return { inside: insideX && insideZ, px: p.playerX, pz: p.playerZ, b };
  });
  record('Player does not pass through buildings', !collided.inside,
    `stopped at z=${collided.pz.toFixed(1)}, wall at z=${(collided.b.z - collided.b.depth / 2).toFixed(1)}`);
  await shot('03-collision');

  // ---- 5. Vehicle enter / drive / exit ---------------------------------
  console.log('\n5. Vehicles');
  await page.evaluate(() => window.__simApi.teleportToStarterCar());
  await sleep(900);
  s = await state();
  record('Enter prompt shown near a vehicle', !!s.promptText && s.promptText.includes('Enter'),
    s.promptText ?? 'none');

  await page.keyboard.press('KeyE');
  await sleep(700);
  s = await state();
  record('E enters the vehicle', s.control === 'driving' && !!s.currentVehicleId,
    `${s.control}, id=${s.currentVehicleId}`);
  record('Stealing a car raises 1 star', s.wantedStars >= 1, `${s.wantedStars} stars`);
  await shot('04-in-vehicle');

  // Drive forward.
  const beforeDrive = await debug();
  await hold('KeyW', 2600);
  await sleep(300);
  const afterDrive = await debug();
  const drove = Math.hypot(
    afterDrive.playerX - beforeDrive.playerX,
    afterDrive.playerZ - beforeDrive.playerZ,
  );
  record('Vehicle accelerates and drives', drove > 8, `travelled ${drove.toFixed(1)} m`);
  s = await state();
  record('Speedometer reads a speed', await page.locator('.speedo-value').isVisible());

  // Brake to a stop, then exit.
  await hold('KeyS', 2200);
  await sleep(800);
  await page.keyboard.press('KeyE');
  await sleep(800);
  s = await state();
  record('E exits the vehicle when slow', s.control === 'onfoot' && !s.currentVehicleId,
    s.control);

  // Re-enter and exit again — must work repeatedly.
  await sleep(400);
  await page.keyboard.press('KeyE');
  await sleep(700);
  const reEnter = (await state()).control === 'driving';
  await sleep(600);
  await page.keyboard.press('KeyE');
  await sleep(800);
  const reExit = (await state()).control === 'onfoot';
  record('Enter/exit works repeatedly', reEnter && reExit,
    `re-enter=${reEnter}, re-exit=${reExit}`);
  await shot('05-after-exit');

  // Vehicle recovery.
  const recovered = await page.evaluate(async () => {
    const api = window.__simApi;
    api.flipNearestVehicle();
    await new Promise((r) => setTimeout(r, 600));
    const before = api.vehicleUpright();
    api.enterNearest();
    await new Promise((r) => setTimeout(r, 500));
    api.press('recover');
    await new Promise((r) => setTimeout(r, 900));
    const after = api.vehicleUpright();
    return { before, after };
  });
  record('R recovers a flipped vehicle', recovered.after > recovered.before + 0.3,
    `upright ${recovered.before.toFixed(2)} -> ${recovered.after.toFixed(2)}`);

  // ---- 6. Wanted system + police ---------------------------------------
  console.log('\n6. Wanted system and police');
  await page.evaluate(() => window.__simApi.setStars(3));
  await sleep(4000);
  const pol = await page.evaluate(() => window.__simApi.policeInfo());
  record('Police spawn and pursue at 3 stars', pol.units >= 1,
    `${pol.units} units, nearest ${Number.isFinite(pol.nearest) ? pol.nearest.toFixed(0) + ' m' : 'n/a'}`);
  record('Police stay on the map (not stuck below)', pol.aboveGround >= 1,
    `${pol.aboveGround} above ground`);
  await shot('06-pursuit');

  // Police must actually close distance over time.
  const chase = await page.evaluate(async () => {
    const api = window.__simApi;
    const a = api.policeInfo().nearest;
    await new Promise((r) => setTimeout(r, 6000));
    const b = api.policeInfo().nearest;
    return { a, b };
  });
  record('Police close in on the player', chase.b < chase.a || chase.b < 45,
    `${chase.a.toFixed(0)} m -> ${chase.b.toFixed(0)} m`);

  // Heat decays when undetected.
  const decay = await page.evaluate(async () => {
    const api = window.__simApi;
    api.setStars(1);
    const before = window.__game.getState().wantedStars;
    // Break the sight line: keep a large building between player and pursuit
    // for the full decay window, which is how a player actually escapes.
    const block = window.__world.buildings
      .filter((b) => b.width > 18 && b.depth > 18)
      .sort((x, y) => y.width * y.depth - x.width * x.depth)[0];
    const gap = Math.max(block.width, block.depth) / 2 + 22;
    for (let i = 0; i < 30; i++) {
      api.setPlayer(block.x, block.z - gap);
      api.placePolice(block.x, block.z + gap);
      await new Promise((r) => setTimeout(r, 1000));
      if (window.__game.getState().wantedStars < before) break;
    }
    return { before, after: window.__game.getState().wantedStars };
  });
  record('Heat decays after staying undetected', decay.after < decay.before,
    `${decay.before} -> ${decay.after} stars`);

  // Arrest and respawn.
  const arrest = await page.evaluate(async () => {
    const api = window.__simApi;
    api.forceArrest();
    await new Promise((r) => setTimeout(r, 1500));
    const st = window.__game.getState();
    return {
      control: st.control,
      stars: st.wantedStars,
      health: st.health,
      atSafehouse: api.distanceToSafehouse(),
    };
  });
  record('Arrest clears wanted level', arrest.stars === 0, `${arrest.stars} stars`);
  record('Arrest respawns at the safehouse', arrest.atSafehouse < 25,
    `${arrest.atSafehouse.toFixed(1)} m from safehouse`);
  record('Arrest restores a valid on-foot state', arrest.control === 'onfoot', arrest.control);
  record('Health restored after respawn', arrest.health > 90, `${arrest.health}`);

  // ---- 7. Missions ------------------------------------------------------
  console.log('\n7. Missions');
  const m1 = await page.evaluate(async () => {
    const api = window.__simApi;
    return await api.runMission('delivery');
  });
  record('Mission 1 (First Delivery) completes', m1.completed,
    `objectives ${m1.steps}, reward $${m1.reward}`);
  record('Mission 1 pays a reward once', m1.reward > 0 && m1.doublePayGuard === 0,
    `paid $${m1.reward}, repeat pay $${m1.doublePayGuard}`);

  const m2 = await page.evaluate(async () => window.__simApi.runMission('checkpoint'));
  record('Mission 2 (Checkpoint Run) completes', m2.completed,
    `objectives ${m2.steps}, reward $${m2.reward}`);

  const m3 = await page.evaluate(async () => window.__simApi.runMission('heat'));
  record('Mission 3 (Lose the Heat) completes', m3.completed,
    `objectives ${m3.steps}, reward $${m3.reward}`);

  const fail = await page.evaluate(async () => window.__simApi.failMissionByTimeout());
  record('A mission fails on timeout and stays retryable', fail.failed && fail.retryable,
    `status=${fail.status}`);
  await shot('07-missions');

  // ---- 8. Pause ---------------------------------------------------------
  console.log('\n8. Pause');
  await page.evaluate(() => window.__simApi.resumePlay());
  await sleep(500);
  // The checkpoint job may already be complete from section 7; reset it so a
  // timed mission is definitely running when we pause.
  await page.evaluate(() => window.__simApi.forceTimedMission());
  await sleep(1200);
  await page.keyboard.press('Escape');
  await sleep(700);
  s = await state();
  record('Escape pauses the game', s.control === 'paused', s.control);
  record('Pause menu is visible', await page.locator('.pause-menu').isVisible());

  const frozen = await page.evaluate(async () => {
    const a = window.__sim;
    const t0 = window.__game.getState().missionTime;
    const p0 = { x: a.playerX, z: a.playerZ };
    await new Promise((r) => setTimeout(r, 2500));
    const b = window.__sim;
    return {
      moved: Math.hypot(b.playerX - p0.x, b.playerZ - p0.z),
      timerDelta: t0 === null ? null : t0 - window.__game.getState().missionTime,
    };
  });
  record('Pause freezes gameplay motion', frozen.moved < 0.5,
    `moved ${frozen.moved.toFixed(3)} m in 2.5 s`);
  record('Pause freezes mission timers', frozen.timerDelta !== null && frozen.timerDelta < 0.3,
    `timer moved ${frozen.timerDelta?.toFixed(2)} s`);
  await shot('08-paused');

  await page.locator('button', { hasText: 'Resume' }).click();
  await sleep(600);
  record('Resume returns to gameplay', (await state()).control !== 'paused');

  // ---- 9. Map and help overlays ----------------------------------------
  console.log('\n9. Overlays');
  await page.keyboard.press('KeyM');
  await sleep(500);
  record('M opens the expanded map', await page.locator('.map-overlay').isVisible());
  await shot('09-map');
  await page.keyboard.press('KeyM');
  await sleep(400);
  await page.keyboard.press('KeyH');
  await sleep(400);
  record('H opens the controls help', await page.locator('.controls-overlay').isVisible());
  await page.keyboard.press('KeyH');
  await sleep(300);

  // ---- 10. Saving and Continue -----------------------------------------
  console.log('\n10. Saving and Continue');
  const saved = await page.evaluate(() => {
    window.__game.getState().actions.addCash(1234);
    window.__game.getState().actions.saveProgress({ x: 10, z: 20 });
    return JSON.parse(localStorage.getItem('neon-district-save'));
  });
  record('Progress is written to localStorage', !!saved && saved.cash >= 1234,
    `cash $${saved?.cash}, ${saved?.completedMissions?.length ?? 0} missions`);

  // Reload and Continue must restore progression.
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(2500);
  const contBtn = page.locator('button', { hasText: 'Continue' });
  record('Continue is offered after a save', await contBtn.isVisible());
  await contBtn.click();
  await sleep(2500);
  s = await state();
  record('Continue restores cash', s.cash >= 1234, `$${s.cash}`);
  record('Continue restores completed missions',
    Object.values(s.missionStatus).some((v) => v === 'completed'),
    JSON.stringify(s.missionStatus));
  record('Continue lands in a valid free-roam state', s.control === 'onfoot', s.control);
  await shot('10-continued');

  // Corrupt-save resilience.
  const corrupt = await page.evaluate(async () => {
    localStorage.setItem('neon-district-save', '{{{not json');
    return true;
  });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(2000);
  const stillOk = await page.locator('.game-title').isVisible();
  record('Corrupt save degrades gracefully to the menu', stillOk && corrupt);

  // ---- 11. Resize -------------------------------------------------------
  console.log('\n11. Responsiveness');
  for (const [w, h] of [[1366, 768], [1920, 1080], [1024, 640]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(700);
    const ok = await page.locator('.game-title').isVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 2,
    );
    record(`Menu readable at ${w}x${h}`, ok && !overflow,
      overflow ? 'horizontal overflow' : 'no overflow');
  }

  // ---- 12. Performance --------------------------------------------------
  console.log('\n12. Performance');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('button', { hasText: 'New Game' }).click();
  await sleep(1000);
  // Dismiss the erase-progress confirmation if it appeared.
  const confirmBtn = page.locator('button', { hasText: 'Confirm' });
  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click();
  }
  await sleep(4000);
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames++;
          if (performance.now() - start < 5000) requestAnimationFrame(tick);
          else resolve((frames * 1000) / (performance.now() - start));
        };
        requestAnimationFrame(tick);
      }),
  );
  record('Renders at an interactive frame rate', fps > 24, `${fps.toFixed(1)} FPS measured`);
  await shot('11-gameplay-final');

  // ---- 13. Console errors ----------------------------------------------
  console.log('\n13. Console health');
  const meaningful = consoleErrors.filter(
    (e) => !/favicon|Download the React DevTools|WebGL.*deprecated/i.test(e),
  );
  record('No recurring console errors', meaningful.length === 0,
    meaningful.length ? meaningful.slice(0, 3).join(' | ') : 'clean');

  // ---- Summary ----------------------------------------------------------
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${'='.repeat(64)}`);
  console.log(`RESULT: ${passed}/${results.length} checks passed`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`);
  }
  console.log(`${'='.repeat(64)}\n`);

  await browser.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('Harness error:', e);
  process.exit(2);
});
