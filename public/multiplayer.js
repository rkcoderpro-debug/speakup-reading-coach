export function createMultiplayer({ state, api, esc, notice, openPractice, refreshProfile }) {
  const $ = id => document.getElementById(id);
  let globalChannel, roomChannel, activeId, snapshot, userId, poll, ticker, offset = 0, loading = false;
  let identities = [], connected = new Set();
  const storageKey = () => `speakup-room:${state.user?.id}`;
  const command = (action, payload = {}) => api('/api/rooms', { method:'POST', body:JSON.stringify({ action, roomId:activeId, ...payload }) });
  const safe = fn => async (...args) => { try { await fn(...args); } catch (e) { notice(e.message); } };
  const avatar = value => { try { return new URL(value, location.origin).protocol === 'https:' || String(value).startsWith('/assets/') ? value : '/assets/ai-coach.png'; } catch { return '/assets/ai-coach.png'; } };
  const person = p => `<img class="mp-avatar" src="${esc(avatar(p.avatar_url || '/assets/ai-coach.png'))}" alt=""><span><b>${esc(p.display_name || 'Reader')}</b><small>${esc(p.bio || '')}</small></span>`;
  document.querySelector('nav[aria-label="Main navigation"]').insertAdjacentHTML('beforeend', '<button class="nav" data-page="multiplayer" aria-label="Multiplayer"><b class="nav-key">M</b><span>Multiplayer</span></button>');
  $('page-profile').insertAdjacentHTML('beforebegin', `<section id="page-multiplayer" class="page hidden">
    <div class="section-head"><div><h2>Read together</h2><p>Cùng một bài đọc. Rõ ràng, tự nhiên, cùng tiến bộ.</p></div><button id="mpRefresh" class="soft">Refresh rooms</button></div>
    <div class="mp-panel"><h3>Online readers</h3><p id="mpConnection" role="status">Connecting…</p><div id="mpOnline" class="mp-people"></div></div>
    <div id="mpDiscovery" class="mp-panel"><h3>Create a room</h3><form id="mpCreate" class="mp-form">
      <label>Room title<input id="mpTitle" maxlength="140" required placeholder="Evening reading club"></label>
      <label>Shared passage<textarea id="mpPassage" minlength="10" maxlength="5000" required rows="6" placeholder="Paste the English passage everyone will read"></textarea></label>
      <label>Target WPM<input id="mpTarget" type="number" min="60" max="220" value="130" required></label>
      <label><input id="mpTie" type="checkbox" checked> Prefer WPM closest to the target when all five scores tie</label>
      <button class="primary">Create room</button></form>
      <form id="mpJoin" class="mp-actions"><label>Room ID<input id="mpCode" required placeholder="Paste room ID"></label><button class="soft">Join / rejoin</button></form>
      <h3>Open & recent rooms</h3><div id="mpRooms"></div></div>
    <div id="mpRoom" class="mp-panel hidden"><div id="mpRoomInfo"></div><p id="mpClock" role="status"></p><div id="mpPlayers" class="mp-people"></div>
      <div class="mp-actions"><button id="mpReady" class="soft">Ready</button><button id="mpStart" class="primary">Start countdown</button><button id="mpRead" class="primary">Read & submit</button><button id="mpFinish" class="soft">End room</button><button id="mpLeave" class="soft">Leave lobby</button><button id="mpBack" class="soft">Browse rooms</button></div>
      <h3 id="mpBoardTitle">Leaderboard</h3><p>Overall → pronunciation → fluency → completeness → intonation → target WPM distance (if enabled) → earliest submission.</p>
      <p>WPM uses audio duration estimated by Gemini; it is a learning estimate.</p>
      <div class="mp-table-wrap"><table><thead><tr><th>Rank</th><th>Reader</th><th>Overall</th><th>Pron.</th><th>Flu.</th><th>Comp.</th><th>Int.</th><th>WPM</th><th>Δ target</th><th>Submitted</th></tr></thead><tbody id="mpResults"></tbody></table></div>
    </div></section>`);
  $('page-profile').querySelector('.profile-panel').insertAdjacentHTML('beforeend', `<form id="mpProfile" class="mp-form">
    <label>Display name<input id="mpName" maxlength="60" required></label><label>Bio<textarea id="mpBio" maxlength="300" rows="3"></textarea></label>
    <label>Avatar (PNG, JPEG or WebP, max 2 MB)<input id="mpAvatar" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <label><input id="mpDefault" type="checkbox"> Use default SpeakUp avatar</label><button class="primary">Save profile</button></form>`);
  document.addEventListener('error', e => { if (e.target.matches?.('.mp-avatar,#headerAvatar,#profileAvatar') && !e.target.src.endsWith('/assets/ai-coach.png')) e.target.src='/assets/ai-coach.png'; }, true);
  function profile() { $('mpName').value=state.profile?.display_name || ''; $('mpBio').value=state.profile?.bio || ''; }
  $('mpProfile').onsubmit=safe(async e => {
    e.preventDefault(); const btn=e.target.querySelector('button'); btn.disabled=true;
    let uploaded;
    try {
      const display_name=$('mpName').value.trim(), bio=$('mpBio').value.trim();
      if (!display_name) throw new Error('Hãy nhập tên hiển thị.');
      let avatar_url=state.profile.avatar_url || ''; const file=$('mpAvatar').files[0];
      if ($('mpDefault').checked) avatar_url='';
      else if(file) {
        const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type];
        if (!ext || file.size>2097152) throw new Error('Avatar cần PNG/JPEG/WebP, tối đa 2 MB.');
        uploaded=`${state.user.id}/${crypto.randomUUID()}.${ext}`;
        const {error}=await state.supabase.storage.from('speakup-avatars').upload(uploaded,file,{contentType:file.type}); if(error)throw error;
        avatar_url=state.supabase.storage.from('speakup-avatars').getPublicUrl(uploaded).data.publicUrl;
      }
      const {error}=await state.supabase.from('profiles').update({display_name,bio,avatar_url,updated_at:new Date().toISOString()}).eq('user_id',state.user.id); if(error)throw error;
      uploaded=null; $('mpAvatar').value=''; $('mpDefault').checked=false; await refreshProfile(); notice('Đã lưu profile.',true);
    } catch(e) { if(uploaded)await state.supabase.storage.from('speakup-avatars').remove([uploaded]); throw e; }
    finally { btn.disabled=false; }
  });
  async function list() {
    const data=await command('list'); $('mpRooms').innerHTML=(data.rooms||[]).map(r=>`<button class="history-item" data-room="${esc(r.id)}"><b>${esc(r.title)}</b><small>${esc(r.state)} · Join / rejoin</small></button>`).join('') || '<p>No rooms yet.</p>';
    $('mpRooms').querySelectorAll('[data-room]').forEach(b=>b.onclick=safe(()=>join(b.dataset.room)));
  }
  async function join(id) {
    await command('join',{roomId:id}); activeId=id; localStorage.setItem(storageKey(),id);
    if(roomChannel)await state.supabase.removeChannel(roomChannel);
    roomChannel=state.supabase.channel(`speakup-room-${id}`,{config:{private:true,presence:{key:state.user.id}}});
    roomChannel.on('presence',{event:'sync'},()=>{connected=new Set(Object.keys(roomChannel.presenceState()));render();});
    for(const table of ['speakup_rooms','speakup_players','speakup_results']) roomChannel.on('postgres_changes',{event:'*',schema:'public',table,filter:`${table==='speakup_rooms'?'id':'room_id'}=eq.${id}`},()=>refresh().catch(e=>notice(e.message)));
    roomChannel.subscribe(async status=>{if(status==='SUBSCRIBED'){await roomChannel.track({online:true});await refresh().catch(e=>notice(e.message));}});
    $('mpRoom').classList.remove('hidden'); $('mpDiscovery').classList.add('hidden'); await refresh();
  }
  async function refresh() {
    if(!activeId || loading)return; loading=true;
    try { const id=activeId; const data=await command('snapshot'); if(id!==activeId)return; snapshot=data; offset=Date.parse(data.serverTime)-Date.now();render(); }
    finally {loading=false;}
  }
  function clock() {
    if(!snapshot)return;
    const r=snapshot.room, now=Date.now()+offset, left=Math.ceil((Date.parse(r.starts_at)-now)/1000);
    $('mpClock').textContent=r.state==='lobby'?'Mark ready when you are prepared.':r.state==='finished'?'Round complete.':left>0?`Starting in ${left}…`:`Submission window: ${Math.max(0,Math.ceil((Date.parse(r.ends_at)-now)/1000))} seconds remaining`;
    const me=snapshot.players.find(p=>p.user_id===state.user.id);
    $('mpRead').disabled=r.state!=='running'||left>0||now>Date.parse(r.ends_at)||!me||['submitted','left'].includes(me.status)||(me.status==='assessing'&&Date.parse(me.lease_until)>now);
  }
  function render() {
    if(!snapshot)return; const r=snapshot.room, me=snapshot.players.find(p=>p.user_id===state.user.id),host=r.host_id===state.user.id;
    $('mpRoomInfo').innerHTML=`<h2>${esc(r.title)}</h2><p>Room ID: <code>${esc(r.id)}</code></p><p>Target: ${r.target_wpm} WPM · Tie-break ${r.wpm_tiebreak?'on':'off'} · ${esc(r.state)}</p><div class="mp-passage">${esc(r.passage)}</div>`;
    $('mpPlayers').innerHTML=snapshot.players.map(p=>`<div class="mp-person">${person(p)}<small>${connected.has(p.user_id)?'Online':'Offline'} · ${p.user_id===r.host_id?'Host · ':''}${p.ready?'Ready · ':''}${esc(p.status)}</small></div>`).join('');
    $('mpReady').disabled=r.state!=='lobby'||me?.status==='left';$('mpReady').textContent=me?.ready?'Not ready':'Ready';
    $('mpStart').hidden=!host;$('mpStart').disabled=r.state!=='lobby'||snapshot.players.filter(p=>p.status!=='left').length<2||snapshot.players.some(p=>p.status!=='left'&&!p.ready);
    $('mpFinish').hidden=!host;$('mpFinish').disabled=r.state==='finished';$('mpLeave').disabled=r.state!=='lobby';
    $('mpBoardTitle').textContent=r.state==='finished'?'Final leaderboard':'Live leaderboard';
    $('mpResults').innerHTML=snapshot.results.map(s=>{const p=snapshot.players.find(p=>p.user_id===s.user_id)||{};return `<tr><td>${s.rank}</td><td>${esc(p.display_name||'Reader')}</td>${['overall_score','pronunciation_score','fluency_score','completeness_score','intonation_score','wpm'].map(k=>`<td>${Number(s[k])}</td>`).join('')}<td>${r.wpm_tiebreak?Math.abs(s.wpm-r.target_wpm).toFixed(1):'—'}</td><td>${esc(new Date(s.submitted_at).toLocaleTimeString())}</td></tr>`;}).join('')||'<tr><td colspan="10">Waiting for submissions.</td></tr>';clock();
  }
  $('mpCreate').onsubmit=safe(async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try { const r=await command('create',{title:$('mpTitle').value,passage:$('mpPassage').value,target_wpm:Number($('mpTarget').value),wpm_tiebreak:$('mpTie').checked});await join(r.roomId); } finally {b.disabled=false;}});
  $('mpJoin').onsubmit=safe(async e=>{e.preventDefault();await join($('mpCode').value.trim());});
  $('mpRefresh').onclick=safe(list);
  $('mpReady').onclick=safe(async()=>{await command('ready',{ready:!snapshot.players.find(p=>p.user_id===state.user.id)?.ready});await refresh();});
  for(const [id,action] of [['mpStart','start'],['mpFinish','finish']])$(id).onclick=safe(async()=>{await command(action);await refresh();});
  $('mpLeave').onclick=safe(async()=>{await command('leave');localStorage.removeItem(storageKey());activeId=null;snapshot=null;if(roomChannel)await state.supabase.removeChannel(roomChannel);$('mpRoom').classList.add('hidden');$('mpDiscovery').classList.remove('hidden');await list();});
  $('mpBack').onclick=safe(async()=>{$('mpDiscovery').classList.remove('hidden');await list();});
  $('mpRead').onclick=()=>{if($('mpRead').disabled)return;openPractice({title:snapshot.room.title,content:snapshot.room.passage,roomId:activeId},'multiplayer');};
  return {
    profile, refresh, async page() { await list(); if(activeId)await refresh(); },
    async start() {
      if(userId===state.user?.id)return; await this.stop(); userId=state.user.id;profile();
      await state.supabase.realtime.setAuth(state.session.access_token);
      globalChannel=state.supabase.channel('speakup-online',{config:{private:true,presence:{key:userId}}});
      globalChannel.on('presence',{event:'sync'},safe(async()=>{
        const ids=Object.keys(globalChannel.presenceState()).filter(id=>/^[0-9a-f-]{36}$/i.test(id)).slice(0,100);
        if(!ids.length){$('mpOnline').innerHTML='';return;}
        const {data,error}=await state.supabase.rpc('speakup_identities',{ids});if(error)throw error;identities=data||[];
        $('mpOnline').innerHTML=identities.map(p=>`<div class="mp-person">${person(p)}</div>`).join('');
      }));
      globalChannel.subscribe(status=>{ $('mpConnection').textContent=status==='SUBSCRIBED'?'Live presence connected':'Presence reconnecting; room status refreshes automatically.';if(status==='SUBSCRIBED')globalChannel.track({online:true}); });
      poll=setInterval(()=>{if(activeId)refresh().catch(()=>{});},5000);ticker=setInterval(clock,250);
      const remembered=localStorage.getItem(storageKey());if(remembered)await join(remembered).catch(e=>notice(e.message));
    },
    async stop() { clearInterval(poll);clearInterval(ticker);if(globalChannel)await state.supabase.removeChannel(globalChannel);if(roomChannel)await state.supabase.removeChannel(roomChannel);globalChannel=null;roomChannel=null;activeId=null;snapshot=null;userId=null;connected.clear();$('mpRoom').classList.add('hidden');$('mpDiscovery').classList.remove('hidden');$('mpOnline').innerHTML='';$('mpRooms').innerHTML=''; }
  };
}
