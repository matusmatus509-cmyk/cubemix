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
   const container = document.createElement('div'); container.className='canvas-wrap'; container.style.cssText='position:fixed;left:0;top:0;z-index:99999;width:390px;height:650px'; document.body.append(container);
   const scene = new CubeScene(container);
   scene.onResize();
   const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
   const check=(condition,msg)=>{if(!condition)throw Error(msg)};
   const pause=ms=>new Promise(r=>setTimeout(r,ms));
   const canvas=scene.renderer.domElement;
   const mouse=(type,p,target=canvas)=>target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:p.x,clientY:p.y}));
   const orbit=()=>{
     const rect=canvas.getBoundingClientRect(), from={x:rect.left+4,y:rect.top+4}, to={x:from.x+35,y:from.y+20};
     mouse('mousedown',from); mouse('mousemove',to,window); mouse('mouseup',to,window);
   };
   check(scene.isRotationLocked(),'solved start must lock orbit without a force');
   let q=scene.cubeGroup.quaternion.clone(); orbit();
   check(scene.cubeGroup.quaternion.equals(q),'actual orbit gesture blocked at zero moves');
   await scene.runMoves(['R','U','F','M']);
   check(scene.isRotationLocked(),'four completed moves still locked');
   orbit(); check(scene.cubeGroup.quaternion.equals(q),'actual orbit gesture blocked after four');
   await scene.runMoves(['E']);
   check(!scene.isRotationLocked(),'fifth completed move unlocks');
   orbit(); check(!scene.cubeGroup.quaternion.equals(q),'orbit gesture works after fifth');
   scene.reset(); check(scene.isRotationLocked(),'reset relocks solved start');
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
   const findPoint=(nonzero,except=null)=>{
     scene.cubeGroup.updateMatrixWorld(true); scene.camera.updateMatrixWorld(true);
     const rect=canvas.getBoundingClientRect();
     for(const cubie of scene.cube.cubies) for(const sticker of cubie.mesh.children) {
       if(!sticker.userData.isSticker)continue;
       const screen=sticker.getWorldPosition(new THREE.Vector3()).project(scene.camera);
       const point={x:rect.left+(screen.x+1)*rect.width/2,y:rect.top+(1-screen.y)*rect.height/2};
       const hit=scene.interaction.raycast(point.x,point.y);
       const pos=hit && scene.interaction.getCubieLogicalPos(hit);
       if(!pos)continue;
       const key=[pos.x,pos.y,pos.z].join(',');
       if([pos.x,pos.y,pos.z].filter(v=>Math.abs(v)===1).length===nonzero && key!==except) return {...point,key};
     }
     throw Error('No hittable cubie with '+nonzero+' nonzero coordinates');
   };
   const tap=p=>{mouse('mousedown',p);mouse('mouseup',p,window);};
   let corner=findPoint(3), other=findPoint(3,corner.key);
   // Centres, edges, different corners and a single tap must not end force.
   for(const count of [1,2]) {const p=findPoint(count);tap(p);tap(p);check(scene.hasForce(),'non-corner double tap ignored');}
   scene.interaction.cancel(); tap(corner);
   check(scene.hasForce(),'one corner tap does not finish force');
   tap(other); check(scene.hasForce(),'different corners are not a double tap');
   scene.interaction.cancel(); tap(corner); await pause(400); tap(corner);
   check(scene.hasForce(),'two slow taps do not finish force');
   scene.interaction.cancel(); tap(corner); mouse('mousedown',corner);
   mouse('mousemove',{x:corner.x+15,y:corner.y+10},window); scene.interaction.cancel();
   mouse('mouseup',corner,window); await pause(250);
   check(scene.hasForce(),'drag and cancellation never finish force');
   scene.interaction.cancel(); tap(corner); tap(corner);
   check(!scene.hasForce() && !scene.isForceLive(),'mouse double corner tap clears force configuration');
   check(equal(scene.getState(),target),'finishing adopts exact force');
   check(!scene.isRotationLocked(),'finished force can be freely inspected');
   let ordinary=target;
   const ordinaryMoves=['R','U','M'];
   for(const move of ordinaryMoves)ordinary=applyMove(ordinary,move);
   await scene.runMoves(ordinaryMoves);
   orbit(); await pause(150);
   check(equal(scene.getState(),ordinary) && !scene.hasForce(),'mixing and orbit never re-arm finished force');
   await scene.solve();
   check(equal(scene.getState(),createSolvedState()) && !scene.hasForce(),'ordinary Solve works after finishing');
   check(!scene.isRotationLocked(),'ordinary solved cube remains freely inspectable after finishing');
   scene.reset(); check(!scene.hasForce(),'Reset cannot restore a finished force');
   // Native touch events use the same recogniser, including cancellation of multi-touch.
   const savedTarget=target;
   target=createSolvedState();
   scene.setForceSnapshotFromData(cubeStateToSnapshot(target));
   corner=findPoint(3);
   const touch=(id=1)=>new Touch({identifier:id,target:canvas,clientX:corner.x,clientY:corner.y});
   const touchTap=()=>{
     const t=touch();
     canvas.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,cancelable:true,touches:[t],changedTouches:[t]}));
     window.dispatchEvent(new TouchEvent('touchend',{bubbles:true,cancelable:true,touches:[],changedTouches:[t]}));
   };
   touchTap();
   canvas.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,cancelable:true,touches:[touch(1),touch(2)],changedTouches:[touch(2)]}));
   touchTap(); check(scene.hasForce(),'multi-touch cancels the double tap');
   scene.interaction.cancel();touchTap();touchTap();
   check(!scene.hasForce() && equal(scene.getState(),target),'touch double tap finishes even a solved force');
   check(!scene.isRotationLocked(),'finishing a solved force unlocks orbit');
   check(commits===6,'four automatic reveals and two explicit finishes');
   target=savedTarget;
   scene.setForceSnapshotFromData(cubeStateToSnapshot(target));
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
 console.log('Browser/WebGL: five-turn orbit gate, mouse/touch corner finish, gesture rejection, ordinary post-force play, repeat cycles, Solve and Reset passed.',result);
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
