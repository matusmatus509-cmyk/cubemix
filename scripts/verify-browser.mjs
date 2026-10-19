import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const production = process.env.CUBEMIX_TEST_PRODUCTION === '1';
const args = [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), ...(production ? ['preview'] : []), '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
const server = spawn(process.execPath, args, {cwd: root, stdio: 'pipe'});
let startupLog = ''; server.stderr.on('data', c => { startupLog += c; });
const base = `http://127.0.0.1:${port}`;
let browser;
try {
  for (let i = 0; ; i++) {
    try { const r = await fetch(base); if (r.ok) break; } catch {}
    if (i > 200 || server.exitCode !== null) throw new Error('Vite startup failed: ' + startupLog);
    await new Promise(r => setTimeout(r, 100));
  }
 browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page = await browser.newPage({viewport:{width:390,height:844}});
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 await page.goto(base);
 await page.locator('canvas').waitFor();
 await page.locator('.topbar-icon').click();
 await page.getByRole('button',{name:'Scramble',exact:true}).click();
 await page.waitForTimeout(3500);
 await page.locator('.topbar-icon').click();
 await page.getByRole('button',{name:'Solve',exact:true}).click();
 await page.locator('.topbar-icon').click();
 await page.waitForFunction(() => {
   const button = [...document.querySelectorAll('.drawer button')].find(b => b.textContent.trim() === 'Solve');
   return button?.disabled;
 }, {}, {timeout: 30000});
 await page.locator('.drawer-close').click();
 console.log('Mobile UI: scramble and Solve completed.');
 if (!production) {
 const result = await page.evaluate(async()=>{
   const {CubeScene} = await import('/src/cube/CubeScene.ts');
   const {createSolvedState} = await import('/src/cube/CubeState.ts');
   const {cubeStateToSnapshot} = await import('/src/cube/RubiksCube.ts');
   const {assertCubeState} = await import('/src/cube/CubeValidity.ts');
   const {applyMove} = await import('/src/cube/CubeState.ts');
   const THREE = await import('/node_modules/.vite/deps/three.js');
   const container = document.createElement('div'); container.style.cssText='width:390px;height:650px'; document.body.append(container);
   const scene = new CubeScene(container);
   const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
   const check=(condition,msg)=>{if(!condition)throw Error(msg)};
   const pause=ms=>new Promise(r=>setTimeout(r,ms));
   let target=createSolvedState();
   for(const move of ['R','U','M','E','S','B']) target=applyMove(target,move);
   check(scene.setForceSnapshotFromData(cubeStateToSnapshot(target)),'arm arbitrary legal preset');
   let commits=0;
   const original=scene.cube.commitForceBaseline.bind(scene.cube);
   scene.cube.commitForceBaseline=(next)=>{
     assertCubeState(next);
     check(equal(next,target),'commit must adopt the full exact preset');
     commits++; original(next);
   };
   for(let cycle=0;cycle<4;cycle++) {
     const baseline=scene.getState();
     const moves=['R','U',"F'",'M','E'];
     let expected=baseline;
     for(const move of moves) expected=applyMove(expected,move);
     await scene.runMoves(moves);
     await pause(150);
     check(equal(scene.getState(),expected),'mixing must act only on the legal real state');
     check(scene.isForceLive(),'mixing re-arms force');
     const initialDots=scene.computeFaceDots();
     for(const [f,d] of Object.entries(initialDots)) {
       if(d<0)check(scene.cube.force.modeOf(f)==='real','visible faces show real layer while mixing');
       if(d>.04)check(scene.cube.force.modeOf(f)==='force','all hidden faces carry force');
     }
     // Turn the whole cube to the opposite corner. No layer moves are executed.
     scene.cubeGroup.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI));
     await pause(250);
     check(equal(scene.getState(),target),'whole cube orbit reveals exact preset');
     check(!scene.isForceLive(),'target becomes new real baseline');
   }
   check(commits===4,'one atomic baseline per reveal');
   await scene.solve(); check(equal(scene.getState(),createSolvedState()),'Solve after force');
   check(scene.hasForce(),'Solve retains configured preset');
   scene.setForceSnapshotFromData(cubeStateToSnapshot(target));
   await scene.runMoves(['R','U','M','E','S','B']);
   await scene.solve(); await pause(300);
   check(equal(scene.getState(),createSolvedState()),'Solve must remain solved while force is configured');
   check(!scene.isForceLive(),'Solve pauses force until new mixing');
   const promise=scene.runMoves(['R','U','F','L','B']); await pause(30); scene.reset(); await promise; await pause(300);
   check(equal(scene.getState(),createSolvedState()),'cancel running sequence');
   scene.executeMove('R'); await pause(30); scene.reset(); await pause(300);
   check(equal(scene.getState(),createSolvedState()),'reset single animation');
   scene.destroy(); container.remove();
   return {commits};
 });
 console.log('Browser/WebGL: four two-layer mix/reveal cycles, exact new baselines, legal real state, worker Solve and reset cancellation passed.',result);
 }
 await page.reload();
 await page.locator('canvas').waitFor();
 await page.locator('.topbar-icon').dispatchEvent('pointerdown'); await page.waitForTimeout(3100); await page.locator('.topbar-icon').dispatchEvent('pointerup');
 await page.getByRole('heading',{name:'Tajné nastavenia'}).waitFor();
 await page.getByRole('button',{name:'Uložiť aktuálny stav kocky',exact:true}).click();
 await page.getByPlaceholder('Názov presetu...').fill('Test preset');
 await page.getByRole('button',{name:'Uložiť',exact:true}).click();
 await page.getByRole('button',{name:'Test preset',exact:true}).click();
 console.log('Mobile preset save/load passed.');
 const disabled = await browser.newPage();
 disabled.on('pageerror',e=>errors.push(e.message));
 await disabled.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Disabled','SecurityError')}}));
 await disabled.goto(base); await disabled.locator('canvas').waitFor();
 console.log('Storage disabled: app still starts.');
 assert.deepEqual(errors,[]);
 console.log('Browser checks passed' + (production ? ' (production build).' : '.'));
} finally {
 await browser?.close();
 server.kill('SIGTERM');
}
