// Run from the repository root with a local dev server and a production build.
// Result snapshots below are controlled UI fixtures, not answers from Gemini.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const built = path.join(root, 'frontend/dist/aproximados/browser');
const config = require('../frontend/vercel.json');
const policy = config.headers.find(x => x.source === '/(.*)').headers.find(x => x.key === 'Content-Security-Policy').value;
const appUrl = process.env.APP_URL || 'http://localhost:4300';
const widths = [320, 360, 390, 430, 768, 1440];
const output = path.join(root, 'docs');
const staticServer = http.createServer((req, res) => {
  let file = path.join(built, new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(built) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(built, 'index.html');
  res.setHeader('Content-Security-Policy', policy);
  res.setHeader('Content-Type', ({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.ico':'image/x-icon'})[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
async function checkLayout(page, label) {
  for (const width of widths) {
    await page.setViewportSize({width, height:844});
    const info = await page.evaluate(() => {
      const violations = [...document.querySelectorAll('input,textarea,button,.card,.rank-card,.player-chip,.podium-row')].filter(e => {
        const r=e.getBoundingClientRect();return r.width > 0 && (r.left < -1 || r.right > innerWidth+1);
      }).map(e => `${e.tagName}.${e.className}`);
      return {overflow: document.documentElement.scrollWidth>innerWidth, violations};
    });
    assert.equal(info.overflow, false, `${label}: document overflows at ${width}`);
    assert.deepEqual(info.violations, [], `${label}: controls clipped at ${width}`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(output,`mobile-${label}.png`),fullPage:true});
}
(async()=>{
  await new Promise(resolve=>staticServer.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true});
  try {
    // The exact deployed CSP must not suppress styles on any entry screen.
    const prod=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'});
    const policyErrors=[];
    prod.on('console', msg => {if(/Content Security Policy|inline event handler/i.test(msg.text()))policyErrors.push(msg.text());});
    await prod.goto(`http://127.0.0.1:${staticServer.address().port}`,{waitUntil:'domcontentloaded'});
    await prod.getByRole('button',{name:/Crear sala/}).waitFor();
    assert.equal(await prod.locator('.btn-primary').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(216, 243, 106)');
    assert.equal(await prod.locator('link[rel="stylesheet"][media="print"]').count(),0,'CSS must load without inline onload handler');
    await checkLayout(prod,'inicio');
    await prod.getByRole('button',{name:/Crear sala/}).click();
    await prod.getByLabel('Tu nombre',{exact:true}).fill('Lucía');
    assert.ok(await prod.locator('#create-name').evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft)>=14));
    await checkLayout(prod,'crear');
    await prod.getByRole('button',{name:/Volver/}).click();
    await prod.getByRole('button',{name:/Tengo un código/}).click();
    await checkLayout(prod,'codigo');
    assert.deepEqual(policyErrors,[],'Production CSP errors');
    console.log('PASS production CSS under deployed CSP; entry screens at 320–1440px');
    await prod.close();

    // Use a local Angular dev instance for isolated UI states without external AI calls.
    const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    const jsErrors=[];page.on('pageerror',e=>jsErrors.push(e.message));
    await page.goto(appUrl);
    await page.getByRole('button',{name:/Crear sala/}).waitFor();
    const players=Array.from({length:12},(_,i)=>({playerId:`p${i+1}`,name:i===0?'Lucía':i===1?'Nombre bastante largo':'Colega '+(i+1),role:i===11?'Redactor':'Estimator',score:12-i,drinksOwed:i,isConnected:true,alcoholFree:false,guess:null,isAdmin:i===0}));
    const base={roomCode:'DEMO',phase:'Lobby',roundNumber:0,currentQuestion:null,redactorPlayerId:null,adminPlayerId:'p1',players,lastResult:null,maxRounds:3,isAlcoholFreeRoom:false,redactorCanGuess:true,guessesExpected:0,guessesSubmitted:0};
    await page.evaluate(state=>{
      const service=window.ng.getComponent(document.querySelector('app-home')).roomService;
      window.__qaService=service;
      service._localPlayer={playerId:'p1',roomCode:state.roomCode,name:'Lucía',alcoholFree:false};
      service._gameState$.next(state);
    },base);
    await page.waitForURL('**/lobby');
    await checkLayout(page,'sala');
    await page.getByRole('button',{name:'Expulsar a Nombre bastante largo'}).click();
    await checkLayout(page,'expulsar');
    await page.getByRole('button',{name:'Cancelar expulsión'}).click();
    const writing={...base,roundNumber:1,phase:'WritingQuestion',redactorPlayerId:'p1'};
    await page.evaluate(s=>window.__qaService._gameState$.next(s),writing);
    await page.waitForURL('**/game');
    await page.locator('#question-input').fill('¿Cuántos huesos tiene el cuerpo de un adulto?');
    await checkLayout(page,'pregunta');
    await page.setViewportSize({width:390,height:420});
    await page.locator('#question-input').focus();
    await page.getByRole('button',{name:'Enviar pregunta'}).scrollIntoViewIfNeeded();
    assert.ok(await page.getByRole('button',{name:'Enviar pregunta'}).isVisible());
    console.log('PASS question controls remain reachable at a reduced keyboard-height viewport');
    const collecting={...writing,phase:'CollectingGuesses',currentQuestion:'¿Cuántos huesos tiene el cuerpo de un adulto?',guessesExpected:12};
    await page.evaluate(s=>window.__qaService._gameState$.next(s),collecting);
    await page.locator('#guess-input').fill('1000000000000000');
    await checkLayout(page,'estimacion');
    await page.getByRole('button',{name:'Cambiar entre número positivo y negativo'}).click();
    await page.waitForFunction(() => document.querySelector('#guess-input').value.startsWith('-'));
    await page.evaluate(s=>window.__qaService._gameState$.next({...s,guessesSubmitted:12,players:s.players.map(p=>({...p,guess:p.playerId==='p1'?206:null}))}),collecting);
    await page.getByRole('heading',{name:'Estimación enviada'}).waitFor();
    await checkLayout(page,'enviada');
    const result={roundNumber:3,question:collecting.currentQuestion,correctAnswer:206,answerSource:'https://example.com/anatomia',ranking:players.map((p,i)=>({playerId:p.playerId,playerName:p.name,guess:i===1?1e15:206+i*30,correctAnswer:206,relativeErrorPercent:i===1?4.8e14:i*14.5,rank:i+1,pointsEarned:i===1?0:Math.max(0,Math.round(100-i*14.5)),drinksThisRound:i===11?2:0,penaltyDescription:''})),sarcasticComment:'Tu cifra necesita un telescopio para ver la respuesta.',winnerName:'Lucía',loserName:'Colega 12',drinksToDistribute:1,loserPenalty:2,redactorPenalty:1,redactorPenaltyDescription:'Todos se acercaron: un trago para el redactor.',drinksDistributedByWinner:{},drinkAssignments:[]};
    const results={...collecting,phase:'ShowingResults',roundNumber:3,lastResult:result};
    await page.evaluate(s=>{
      const service=window.__qaService;
      service.distributeDrinks=async (toPlayerId,amount)=>{
        const current=service.currentState;
        service._gameState$.next({...current,lastResult:{...current.lastResult,drinksDistributedByWinner:{p1:amount},drinkAssignments:[{fromPlayerId:'p1',toPlayerId,amount}]}});
      };
      service._gameState$.next(s);
    },results);
    await page.waitForURL('**/results');
    await checkLayout(page,'resultados');
    await page.getByRole('button',{name:'Dar un trago a Nombre bastante largo'}).click();
    await page.getByRole('button',{name:/Ver clasificación final/}).click();
    await page.getByRole('dialog').waitFor();
    await checkLayout(page,'final');
    await page.getByRole('button',{name:/Volver a la última ronda/}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'mobile-final-bottom.png')});
    await page.getByRole('button',{name:/Volver a la última ronda/}).click();
    await page.getByRole('heading',{name:'Resultados',exact:true}).waitFor();
    assert.deepEqual(jsErrors,[]);
    console.log('PASS mobile room, author, guess, waiting, results, distribution, final with 12 players and large numbers');
    console.log('PASS zero browser JS errors; screenshots saved in docs/mobile-*.png');
  } finally {await browser.close();staticServer.close();}
})().catch(e=>{console.error(e);staticServer.close();process.exitCode=1});
