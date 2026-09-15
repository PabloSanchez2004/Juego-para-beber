const signalR = require('../frontend/node_modules/@microsoft/signalr');
const assert = require('node:assert/strict');
const url = process.env.API_URL || 'http://localhost:5000';
const clients = [];
async function client() {
 const hub = new signalR.HubConnectionBuilder().withUrl(`${url}/gamehub`).configureLogging(signalR.LogLevel.None).build();
 const c = { hub, errors: [], state: null, token: null, playerId: null, code: null };
 hub.on('Error', e=>c.errors.push(e));
 hub.on('RoomCreated',(code,id,state,token)=>Object.assign(c,{code,playerId:id,state,token}));
 hub.on('JoinedRoom',(id,state,token)=>Object.assign(c,{code:state.roomCode,playerId:id,state,token}));
 hub.on('GameStateUpdated',state=>c.state=state);
 hub.on('ReconnectedRoom',state=>c.state=state);
 for(const event of ['PlayerDisconnected','PlayerReconnected','PlayerKicked','Kicked','RoomClosed'])hub.on(event,()=>{});
 clients.push(c);await hub.start();return c;
}
(async()=>{
 try{
  const a=await client(), b=await client(), attacker=await client();
  await a.hub.invoke('CreateRoom','Host security',false,3,'host-test');
  await b.hub.invoke('JoinRoom',a.code,'Guest security',false,'guest-test');
  assert.ok(!JSON.stringify(b.state).includes(a.token));
  await attacker.hub.invoke('RejoinRoom',a.code,a.playerId,'wrong-secret');
  assert.match(attacker.errors.at(-1),/sesión expiró/);
  await attacker.hub.invoke('StartGame',3);
  assert.match(attacker.errors.at(-1),/ninguna sala/);
  console.log('PASS public player ID cannot impersonate host');
  await a.hub.invoke('NextRound');
  assert.match(a.errors.at(-1),/resultados/);
  assert.equal(await a.hub.invoke('RoomExists',a.code),true);
  await b.hub.invoke('NextRound');
  assert.match(b.errors.at(-1),/anfitrión/);
  console.log('PASS wrong-phase NextRound preserves room; non-host rejected');
  const replacement=await client();
  await replacement.hub.invoke('RejoinRoom',a.code,a.playerId,a.token);
  assert.equal(replacement.state.roomCode,a.code);
  await a.hub.invoke('StartGame',3);
  assert.match(a.errors.at(-1),/perfil/);
  await a.hub.invoke('LeaveRoom');
  await replacement.hub.invoke('StartGame',3);
  assert.equal(replacement.state.phase,'WritingQuestion');
  console.log('PASS real secret restores seat; old connection cannot act or remove it');
  const origin=await fetch(`${url}/gamehub/negotiate?negotiateVersion=1`,{method:'POST',headers:{Origin:'https://untrusted.vercel.app'}});
  assert.equal(origin.status,403);
  console.log('PASS foreign Vercel origin rejected');
  const limiter=await client();let limited=false;
  for(let i=0;i<65;i++){try{await limiter.hub.invoke('RoomExists','ZZZZ')}catch(e){limited=/Demasiadas/.test(e.message);break}}
  assert.ok(limited);console.log('PASS per-connection rate limit');
  await replacement.hub.invoke('LeaveRoom');await b.hub.invoke('LeaveRoom');
 }finally{await Promise.all(clients.map(c=>c.hub.stop()))}
})().catch(e=>{console.error(e);process.exitCode=1});
