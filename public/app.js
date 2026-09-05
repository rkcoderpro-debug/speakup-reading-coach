import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const placementSamples=[
 {difficulty:"Warm-up",text:"I usually start my morning with a glass of water and a short walk outside."},
 {difficulty:"Everyday reading",text:"Learning something new becomes easier when you practice regularly. A few focused minutes each day can be more useful than one long session at the end of the week."},
 {difficulty:"Intermediate",text:"Technology has changed the way students find information, but reading carefully is still important. When people slow down and pay attention to each idea, they often understand complex topics more clearly."},
 {difficulty:"Challenge",text:"Although scientific discoveries can appear sudden, most of them are built on years of careful observation, repeated experiments, and collaboration. Reading a complex explanation aloud requires clear pronunciation, sensible pauses, and enough confidence to keep the sentence flowing naturally."}
];
const availableTopics=["Technology","Science","Daily Life","University","History","Travel","Gaming","Business","Nature","Space"];
const state={config:null,supabase:null,session:null,user:null,profile:null,plan:null,dailyLesson:null,dailyPassages:[],dailyAttemptPassageIds:new Set(),mediaRecorder:null,mediaStream:null,chunks:[],blob:null,blobUrl:null,mimeType:"audio/webm",recording:false,timerId:null,timerStart:0,recordedDuration:0,placementIndex:0,practicePassage:null,practiceMode:"daily",lastAssessment:null,theme:"dark"};
const $=id=>document.getElementById(id); const show=el=>el?.classList.remove("hidden"); const hide=el=>el?.classList.add("hidden");
function localDate(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function dayBounds(){const s=new Date();s.setHours(0,0,0,0);const e=new Date(s);e.setDate(e.getDate()+1);return [s.toISOString(),e.toISOString()]}
function niceDate(){return new Intl.DateTimeFormat("en-US",{weekday:"long",month:"short",day:"numeric"}).format(new Date())}
function greeting(){const h=new Date().getHours();return h<12?"Good morning":h<18?"Good afternoon":"Good evening"}
function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function notice(msg,ok=false){const el=$("globalNotice");el.textContent=msg;el.className=`notice${ok?" success":""}`;show(el);clearTimeout(notice.t);notice.t=setTimeout(()=>hide(el),5200)}
function status(id,msg,ok=false){const el=$(id);if(!msg){hide(el);el.textContent="";return}el.textContent=msg;el.className=id==="practiceStatus"?`notice${ok?" success":""}`:`error${ok?" success":""}`;show(el)}
const THEMES=["light","dark","glass"];
function themeLabel(name){return name==="glass"?"LIQUID GLASS":name.toUpperCase()}
function applyTheme(theme){const safe=THEMES.includes(theme)?theme:"dark";state.theme=safe;document.body.dataset.theme=safe;localStorage.setItem("speakup-theme",safe);document.querySelectorAll("[data-theme-choice]").forEach(btn=>{const on=btn.dataset.themeChoice===safe;btn.classList.toggle("active",on);btn.setAttribute("aria-pressed",on?"true":"false")})}
function initTheme(){const stored=localStorage.getItem("speakup-theme");const system=window.matchMedia?.("(prefers-color-scheme: dark)").matches?"dark":"light";applyTheme(stored||system)}
function emptyCard(image,title,text){return `<div class="empty-card"><img src="${image}" alt="${esc(title)}"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`}
function closeUserMenuIfOutside(e){const menu=$("userMenu"),btn=$("userMenuBtn");if(!menu||menu.classList.contains("hidden"))return;if(!menu.contains(e.target)&&!btn.contains(e.target)){hide(menu);btn.setAttribute("aria-expanded","false")}}

async function api(path,opt={}){const session=(await state.supabase.auth.getSession()).data.session;if(!session?.access_token)throw new Error("Bạn chưa đăng nhập.");const headers={...(opt.headers||{}),Authorization:`Bearer ${session.access_token}`};if(opt.body)headers["Content-Type"]="application/json";const r=await fetch(path,{...opt,headers});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||d.detail||`HTTP ${r.status}`);return d}

async function boot(){try{initTheme();state.config=await(await fetch("/api/config")).json();if(!state.config.supabaseConfigured)throw new Error("Supabase chưa được cấu hình trong .env.");state.supabase=createClient(state.config.supabaseUrl,state.config.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});state.supabase.auth.onAuthStateChange((_e,s)=>{setTimeout(()=>handleSession(s),0)});const {data:{session}}=await state.supabase.auth.getSession();await handleSession(session)}catch(e){console.error(e);hide($("loadingScreen"));show($("authScreen"));status("authError",`${e.message} Xem SETUP_SUPABASE.md.`);$("googleLoginBtn").disabled=true}}
async function handleSession(session){state.session=session;state.user=session?.user||null;if(!state.user){hide($("loadingScreen"));hide($("appShell"));hide($("placementOverlay"));show($("authScreen"));return}try{await ensureProfile();renderUser();renderMetrics();hide($("loadingScreen"));hide($("authScreen"));if(!state.profile.onboarding_completed){hide($("appShell"));show($("placementOverlay"));show($("placementIntro"));hide($("placementTest"));hide($("placementFinish"));return}hide($("placementOverlay"));show($("appShell"));await loadPlan();await showPage("today")}catch(e){console.error(e);hide($("loadingScreen"));show($("authScreen"));status("authError",e.message)}}
async function signInGoogle(){status("authError","");const {error}=await state.supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:window.location.origin}});if(error)status("authError",error.message)}
async function ensureProfile(){let {data,error}=await state.supabase.from("profiles").select("*").eq("user_id",state.user.id).maybeSingle();if(error)throw error;if(!data){const row={user_id:state.user.id,display_name:state.user.user_metadata?.full_name||state.user.user_metadata?.name||state.user.email?.split("@")[0]||"Reader",avatar_url:state.user.user_metadata?.avatar_url||state.user.user_metadata?.picture||""};const r=await state.supabase.from("profiles").insert(row).select().single();if(r.error)throw r.error;data=r.data}state.profile=data}
async function refreshProfile(){const {data,error}=await state.supabase.from("profiles").select("*").eq("user_id",state.user.id).single();if(error)throw error;state.profile=data;renderMetrics();renderUser()}
function renderUser(){const n=state.profile?.display_name||state.user?.user_metadata?.full_name||"Reader",email=state.user?.email||"",av=state.profile?.avatar_url||state.user?.user_metadata?.avatar_url||state.user?.user_metadata?.picture||"";$("headerName").textContent=n.split(" ")[0];$("menuEmail").textContent=email;$("profileName").textContent=n;$("profileEmail").textContent=email;for(const id of ["headerAvatar","profileAvatar"]){$(id).src=av||"/assets/ai-coach.png"}$("welcomeTitle").textContent=`${greeting()}, ${n.split(" ")[0]}`;$("welcomeSub").textContent=`You're in ${themeLabel(state.theme)} mode. Keep your streak moving today.`}
function renderMetrics(){const p=state.profile||{};$("sideStreak").textContent=p.current_streak||0;$("sideLevel").textContent=(p.reading_level||"-").replace("Upper Intermediate","Upper-Int.");$("todayLevel").textContent=p.reading_level||"-";for(const [a,b,c] of [["homePron","homePronBar","pronunciation_score"],["homeFlu","homeFluBar","fluency_score"],["homeInt","homeIntBar","intonation_score"]]){$(a).textContent=p[c]||0;$(b).style.width=`${p[c]||0}%`}$("profileLevel").textContent=p.reading_level||"-";$("profileStreak").textContent=`${p.current_streak||0} days`;$("profileWords").textContent=Number(p.total_words_read||0).toLocaleString();$("dailyGoalSelect").value=String(p.daily_goal||3)}
async function loadPlan(){const {data,error}=await state.supabase.from("reading_plans").select("*").eq("user_id",state.user.id).eq("active",true).order("created_at",{ascending:false}).limit(1).maybeSingle();if(error)throw error;state.plan=data||null;renderRoadmap()}
function renderRoadmap(){const plan=state.plan,summary=plan?.summary_vi||plan?.plan_json?.summary_vi||"Your personalized roadmap will appear here.";$("roadmapSummary").textContent=summary;const days=Array.isArray(plan?.plan_json?.days)?plan.plan_json.days:[],box=$("roadmapDays");box.innerHTML="";let idx=-1;if(plan?.start_date){const a=new Date(`${plan.start_date}T12:00:00`),b=new Date(`${localDate()}T12:00:00`);idx=Math.max(0,Math.round((b-a)/86400000))%14}days.forEach((d,i)=>{const el=document.createElement("div");el.className=`roadmap-day${i===idx?" today":""}`;el.innerHTML=`<b>${esc(d.day??i+1)}</b><div><strong>${esc(d.focus||"Reading practice")}</strong><p>${esc(d.goal_vi||"")}</p></div>`;box.appendChild(el)});const cur=days[idx]||days[0];$("roadmapTodayTitle").textContent=cur?.focus||"Your plan";$("roadmapTodayText").textContent=cur?.goal_vi||summary}
async function showPage(name){document.querySelectorAll(".page").forEach(hide);document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.page===name));show($(`page-${name}`));const titles={today:["TODAY","Daily Reading"],read:["READ","Reading Library"],words:["REVIEW","Difficult Words"],progress:["PROGRESS","Reading Progress"],profile:["PROFILE","Your Reading Profile"]};$("pageEyebrow").textContent=titles[name][0];$("pageTitle").textContent=titles[name][1];if(name==="today")await loadToday();if(name==="read")await loadLibrary();if(name==="words")await loadWords();if(name==="progress")await loadProgress();if(name==="profile")renderProfilePage()}

async function loadToday(){try{$("welcomeDate").textContent=niceDate().toUpperCase();await refreshProfile();const d=await api(`/api/daily?date=${localDate()}`);state.dailyLesson=d.lesson;state.dailyPassages=d.passages||[];await loadTodayAttempts();if(!state.dailyLesson){hide($("dailyContent"));hide($("dailyLoading"));show($("dailyEmpty"))}else{hide($("dailyEmpty"));hide($("dailyLoading"));show($("dailyContent"));renderDaily()}}catch(e){notice(e.message)}}
async function loadTodayAttempts(){state.dailyAttemptPassageIds=new Set();if(state.dailyPassages.length){const [s,e]=dayBounds();const ids=state.dailyPassages.map(p=>p.id);const {data}=await state.supabase.from("reading_attempts").select("passage_id").eq("user_id",state.user.id).in("passage_id",ids).gte("created_at",s).lt("created_at",e);state.dailyAttemptPassageIds=new Set((data||[]).map(x=>x.passage_id))}const goal=Number(state.profile?.daily_goal||3),done=Math.min(goal,state.dailyAttemptPassageIds.size);$("goalCount").textContent=`${done} / ${goal}`;$("goalBar").style.width=`${Math.min(100,(done/goal)*100)}%`;$("goalHint").textContent=done>=goal?"Daily goal complete ✓":`${goal-done} passage(s) remaining`}
async function generateDaily(){hide($("dailyEmpty"));show($("dailyLoading"));try{const d=await api("/api/daily/generate",{method:"POST",body:JSON.stringify({localDate:localDate()})});state.dailyLesson=d.lesson;state.dailyPassages=d.passages||[];await loadTodayAttempts();hide($("dailyLoading"));show($("dailyContent"));renderDaily();notice(d.reused?"Đã tải Daily Reading đã lưu.":`Đã tạo bài hôm nay bằng ${d.used_model}.`,true)}catch(e){hide($("dailyLoading"));show($("dailyEmpty"));notice(e.message)}}
function renderDaily(){$("dailyFocus").textContent=state.dailyLesson?.focus_title||"Daily Reading";$("dailyFocusNote").textContent=state.dailyLesson?.focus_note||"";const c=$("dailyPassages");c.innerHTML="";state.dailyPassages.forEach((p,i)=>{const done=state.dailyAttemptPassageIds.has(p.id),el=document.createElement("div");el.className="passage-card";el.innerHTML=`<div class="passage-top"><span class="passage-num">${i===0?"WARM-UP":i===1?"MAIN":"CHALLENGE"}</span>${done?'<span class="done">Completed</span>':""}</div><h3>${esc(p.title)}</h3><p class="passage-preview">${esc(p.content)}</p><div class="passage-info"><span>${esc(p.topic)}</span><span>${p.word_count} words</span><span>~${Math.max(1,Math.round(p.estimated_seconds/60))} min</span></div><button class="primary">${done?"Read again":"Start reading"} </button>`;el.querySelector("button").onclick=()=>openPractice(p,"daily");c.appendChild(el)})}
function passageHtml(p){return `<div class="passage-card"><div class="passage-top"><span class="passage-num">${esc((p.source||"generated").toUpperCase())}</span></div><h3>${esc(p.title)}</h3><p class="passage-preview">${esc(p.content)}</p><div class="passage-info"><span>${esc(p.topic)}</span><span>${p.word_count} words</span><span>${esc(p.level)}</span></div><button class="primary">Start reading </button></div>`}
async function generateCustom(focusWords=[]){const btn=$("generateCustomBtn"),old=btn.textContent;btn.disabled=true;btn.textContent="Generating...";try{const d=await api("/api/passage/generate",{method:"POST",body:JSON.stringify({topic:$("customTopic").value,length:$("customLength").value,focusWords})});show($("customResult"));$("customPassageCard").innerHTML=passageHtml(d.passage);$("customPassageCard").querySelector("button").onclick=()=>openPractice(d.passage,focusWords.length?"review":"custom");notice(`Đã tạo bài bằng ${d.used_model}.`,true);await loadLibrary()}catch(e){notice(e.message)}finally{btn.disabled=false;btn.textContent=old}}
async function loadLibrary(){const {data,error}=await state.supabase.from("reading_passages").select("*").eq("user_id",state.user.id).order("created_at",{ascending:false}).limit(12);if(error){notice(error.message);return}const c=$("recentLibrary");c.innerHTML="";(data||[]).forEach(p=>{const row=document.createElement("div");row.className="library-row";row.innerHTML=`<div><h4>${esc(p.title)}</h4><p>${esc(p.topic)} / ${p.word_count} words / ${esc(p.level)}</p></div><button>Read again</button>`;row.querySelector("button").onclick=()=>openPractice(p,p.source==="review"?"review":"custom");c.appendChild(row)});if(!(data||[]).length)c.innerHTML='<div class="card empty"><p>Chưa có bài trong library.</p></div>'}
async function loadWords(){const {data,error}=await state.supabase.from("word_progress").select("*").eq("user_id",state.user.id).order("average_score",{ascending:true}).limit(80);if(error){notice(error.message);return}const rows=data||[];$("weakCount").textContent=rows.filter(x=>x.status==="weak").length;$("improvingCount").textContent=rows.filter(x=>x.status==="improving").length;$("strongCount").textContent=rows.filter(x=>x.status==="strong").length;const c=$("wordBank");c.innerHTML="";const list=rows.filter(x=>x.status!=="strong"||x.attempts>=2).slice(0,36);list.forEach(r=>{const el=document.createElement("div");el.className=`word-card ${r.status}`;el.innerHTML=`<div><h3>${esc(r.word)}</h3><span class="score">${Math.round(r.average_score)} / 100</span></div><div class="word-meta">${r.attempts} sessions / best ${r.best_score} / review ${r.next_review||"-"}</div><button>Generate a reading with this word</button>`;el.querySelector("button").onclick=async()=>{await showPage("read");$("customLength").value="quick";await generateCustom([r.word])};c.appendChild(el)});if(!list.length)c.innerHTML=emptyCard('/assets/empty-words.png','Chưa có Difficult Words','Đọc vài bài trước. Các từ cần luyện sẽ tự xuất hiện ở đây.')}
async function loadProgress(){
  await refreshProfile();
  const p=state.profile;
  $("progressOverall").textContent=p.overall_score||0;
  $("progressPron").textContent=p.pronunciation_score||0;
  $("progressFlu").textContent=p.fluency_score||0;
  $("progressInt").textContent=p.intonation_score||0;
  $("progressWpm").textContent=Math.round(Number(p.avg_wpm||0));
  const {data,error}=await state.supabase.from("reading_attempts").select("*").eq("user_id",state.user.id).neq("mode","placement").order("created_at",{ascending:false}).limit(40);
  if(error){notice(error.message);return}
  const rows=data||[],c=$("attemptHistory");
  c.innerHTML="";
  rows.slice(0,12).forEach(r=>{
    const el=document.createElement("button");
    el.type="button";
    el.className="history-item";
    const t=(r.reference_text||"").slice(0,75);
    el.innerHTML=`<div><b>${esc(t)}${(r.reference_text||"").length>75?"...":""}</b><p>${new Date(r.created_at).toLocaleString()} / ${Math.round(Number(r.wpm||0))} WPM / ${esc(r.mode)} · click để xem</p></div><span>${Number(r.overall_score||0)}</span>`;
    el.onclick=()=>openHistoryAttempt(r);
    c.appendChild(el)
  });
  if(!rows.length){c.innerHTML=emptyCard('/assets/empty-history.png','Chưa có Reading History','Đọc vài bài sau placement để xem lịch sử, điểm số và xem lại từng lần luyện.');}
  const week=rows.filter(r=>Date.now()-new Date(r.created_at).getTime()<=7*86400000);
  $("weekAttempts").textContent=week.length;
  $("weekWords").textContent=week.reduce((s,r)=>s+String(r.reference_text||"").trim().split(/\s+/).filter(Boolean).length,0).toLocaleString();
  $("weekMinutes").textContent=Math.round(week.reduce((s,r)=>s+Number(r.audio_duration_seconds||0),0)/60);
  $("weekAvg").textContent=week.length?Math.round(week.reduce((s,r)=>s+Number(r.overall_score||0),0)/week.length):0;
}

function renderProfilePage(){renderUser();renderMetrics();renderRoadmap();const selected=new Set(state.profile?.selected_topics||[]),c=$("topicChecks");c.innerHTML="";availableTopics.forEach(t=>{const l=document.createElement("label");l.className="topic";l.innerHTML=`<input type="checkbox" value="${esc(t)}" ${selected.has(t)?"checked":""}> ${esc(t)}`;c.appendChild(l)})}
async function savePreferences(){const topics=[...$("topicChecks").querySelectorAll("input:checked")].map(x=>x.value);if(!topics.length){notice("Hãy chọn ít nhất một topic.");return}const {data,error}=await state.supabase.from("profiles").update({selected_topics:topics,daily_goal:Number($("dailyGoalSelect").value),updated_at:new Date().toISOString()}).eq("user_id",state.user.id).select().single();if(error){notice(error.message);return}state.profile=data;renderMetrics();notice("Đã lưu preferences.",true)}

function speak(text){if(!("speechSynthesis" in window)){notice("Trình duyệt không hỗ trợ đọc mẫu.");return}speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang="en-US";u.rate=.9;const v=speechSynthesis.getVoices();u.voice=v.find(x=>x.lang==="en-US"&&/natural|aria|jenny|samantha|google/i.test(x.name))||v.find(x=>x.lang==="en-US")||v.find(x=>x.lang.startsWith("en"))||null;speechSynthesis.speak(u)}
function supportedMime(){return ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/ogg"].find(t=>MediaRecorder.isTypeSupported(t))||""}
function cleanup(){if(state.mediaStream){state.mediaStream.getTracks().forEach(t=>t.stop());state.mediaStream=null}}
function resetRec(audio,actions,timer){clearInterval(state.timerId);state.timerId=null;if(state.mediaRecorder?.state&&state.mediaRecorder.state!=="inactive"){try{state.mediaRecorder.stop()}catch{}}cleanup();if(state.blobUrl)URL.revokeObjectURL(state.blobUrl);state.blobUrl=null;state.blob=null;state.chunks=[];state.recordedDuration=0;if(audio){audio.pause();audio.removeAttribute("src")}hide(actions);if(timer)timer.textContent="00:00";state.recording=false}
function tt(sec){return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(Math.floor(sec%60)).padStart(2,"0")}`}
async function startRec({button,audio,actions,timer,title,hint}){try{resetRec(audio,actions,timer);const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});state.mediaStream=stream;const pref=supportedMime(),rec=pref?new MediaRecorder(stream,{mimeType:pref}):new MediaRecorder(stream);state.mediaRecorder=rec;state.mimeType=(rec.mimeType||pref||"audio/webm").split(";")[0];state.chunks=[];rec.ondataavailable=e=>{if(e.data?.size)state.chunks.push(e.data)};rec.onstop=()=>{state.blob=new Blob(state.chunks,{type:state.mimeType});state.blobUrl=URL.createObjectURL(state.blob);audio.src=state.blobUrl;show(actions);button.classList.remove("recording");cleanup();if(title)title.textContent="Đã ghi xong";if(hint)hint.textContent="Nghe lại hoặc gửi Gemini chấm."};rec.start(250);state.recording=true;state.timerStart=Date.now();button.classList.add("recording");title.textContent="Đang ghi âm...";hint.textContent="Bấm micro lần nữa để dừng.";state.timerId=setInterval(()=>{const sec=(Date.now()-state.timerStart)/1000;state.recordedDuration=sec;timer.textContent=tt(sec);if(sec>=240)stopRec(button)},200)}catch(e){console.error(e);notice("Không mở được microphone. Hãy cấp quyền Microphone.")}}
function stopRec(button){if(!state.recording)return;state.recording=false;state.recordedDuration=(Date.now()-state.timerStart)/1000;clearInterval(state.timerId);state.timerId=null;button.classList.remove("recording");if(state.mediaRecorder?.state!=="inactive")state.mediaRecorder.stop();else cleanup()}
function b64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onloadend=()=>{const v=String(r.result||"");resolve(v.includes(",")?v.split(",")[1]:v)};r.onerror=reject;r.readAsDataURL(blob)})}

function startPlacement(){state.placementIndex=0;hide($("placementIntro"));show($("placementTest"));renderPlacement()}
function renderPlacement(){const x=placementSamples[state.placementIndex];$("placementProgressText").textContent=`${state.placementIndex+1} / 4`;$("placementProgressBar").style.width=`${(state.placementIndex+1)*25}%`;$("placementDifficulty").textContent=x.difficulty;$("placementText").textContent=x.text;$("placementRecordTitle").textContent="Nhấn để bắt đầu";$("placementRecordHint").textContent="Đọc tự nhiên, không cần thật nhanh.";resetRec($("placementAudio"),$("placementRecordedActions"),$("placementTimer"));hide($("placementResult"));hide($("placementNextBtn"));status("placementStatus","")}
async function submitPlacement(){if(!state.blob){status("placementStatus","Bạn chưa ghi âm.");return}const btn=$("placementSubmitBtn"),old=btn.textContent;btn.disabled=true;btn.textContent="Gemini đang nghe...";try{const d=await api("/api/assess",{method:"POST",body:JSON.stringify({referenceText:placementSamples[state.placementIndex].text,audioBase64:await b64(state.blob),mimeType:state.mimeType,durationSeconds:state.recordedDuration,mode:"placement",placementStep:state.placementIndex+1,localDate:localDate()})});$("placementScore").textContent=d.assessment.overall_score;$("placementVerdict").textContent=d.assessment.overall_score>=80?"Very clear":d.assessment.overall_score>=65?"Good start":"Keep going";$("placementFeedback").textContent=d.assessment.summary_vi;show($("placementResult"));show($("placementNextBtn"));hide($("placementRecordedActions"));status("placementStatus","")}catch(e){status("placementStatus",e.message)}finally{btn.disabled=false;btn.textContent=old}}
async function nextPlacement(){if(state.placementIndex<3){state.placementIndex++;renderPlacement();return}const btn=$("placementNextBtn");btn.disabled=true;btn.textContent="Đang xây lộ trình...";try{const d=await api("/api/placement/finish",{method:"POST",body:JSON.stringify({localDate:localDate()})});state.profile=d.profile;state.plan=d.plan;hide($("placementTest"));show($("placementFinish"));$("finishLevel").textContent=d.level;$("finishSummary").textContent=d.plan?.summary_vi||d.plan?.plan_json?.summary_vi||"Your roadmap is ready.";$("finishPron").textContent=d.scores.pronunciation;$("finishFlu").textContent=d.scores.fluency;$("finishInt").textContent=d.scores.intonation;$("finishComp").textContent=d.scores.completeness}catch(e){status("placementStatus",e.message);btn.disabled=false;btn.textContent="Thử hoàn tất lại"}}
async function enterAfterPlacement(){hide($("placementOverlay"));show($("appShell"));renderUser();renderMetrics();renderRoadmap();await showPage("today")}

function openPractice(p,mode="daily"){
  state.practicePassage=p;
  state.practiceMode=mode;
  $("practiceTitle").textContent=p.title||"Reading practice";
  $("practiceMeta").textContent=`${p.topic||"Reading"} / ${p.word_count||String(p.content||"").split(/\s+/).length} WORDS / ${p.level||state.profile.reading_level}`;
  $("practiceText").textContent=p.content;
  $("practiceRecordTitle").textContent="Nhấn để bắt đầu đọc";
  $("practiceRecordHint").textContent="Đọc toàn bộ đoạn. Bấm lần nữa để dừng.";
  $("retryPracticeBtn").textContent="Đọc lại";
  $("donePracticeBtn").textContent="Hoàn tất";
  resetRec($("practiceAudio"),$("practiceRecordedActions"),$("practiceTimer"));
  hide($("practiceResults"));
  hide($("wordDetail"));
  status("practiceStatus","");
  show($("practiceModal"));
  document.body.style.overflow="hidden";
}

function closePractice(){resetRec($("practiceAudio"),$("practiceRecordedActions"),$("practiceTimer"));hide($("practiceModal"));document.body.style.overflow=""}

function tokens(text) {
  return String(text).match(
    /\s+|[A-Za-zÀ-ÿ0-9]+(?:['’\-][A-Za-zÀ-ÿ0-9]+)*|[^\sA-Za-zÀ-ÿ0-9]+/g
  ) || [];
}

function highlight(text, results) {
  let wi = 0;

  $("practiceText").innerHTML = tokens(text)
    .map((t) => {
      // Một word có thể chứa apostrophe hoặc dấu gạch nối:
      // don't, student's, ultra-pure, fiber-optic, state-of-the-art
      if (/^[A-Za-zÀ-ÿ0-9]+(?:['’\-][A-Za-zÀ-ÿ0-9]+)*$/.test(t)) {
        const r = results[wi++];

        return r
          ? `<span
              class="read-word ${esc(r.status)}"
              data-scored="true"
              data-index="${wi - 1}"
            >${esc(t)}</span>`
          : esc(t);
      }

      return esc(t);
    })
    .join("");

  $("practiceText")
    .querySelectorAll(".read-word")
    .forEach((s) => {
      s.onclick = () => {
        const r = results[Number(s.dataset.index)];

        if (!r) return;

        $("wordDetailWord").textContent = r.word;
        $("wordDetailScore").textContent = `${r.score}/100`;

        $("wordDetailAdvice").textContent = [
          r.heard_as
            ? `Gemini nghe gần giống “${r.heard_as}”.`
            : "",
          r.advice_vi || r.problem
        ]
          .filter(Boolean)
          .join(" ") || "Từ này được đọc khá ổn.";

        show($("wordDetail"));
      };
    });
}
function openHistoryAttempt(r){
  const text=r.reference_text||"";
  const words=Array.isArray(r.words)?r.words:[];
  const wordCount=text.trim().split(/\s+/).filter(Boolean).length;

  state.practicePassage={
    id:r.passage_id||null,
    title:"Reading history",
    topic:r.mode||"Reading",
    word_count:wordCount,
    level:state.profile?.reading_level||"Reading",
    content:text
  };
  state.practiceMode=r.mode||"daily";

  resetRec($("practiceAudio"),$("practiceRecordedActions"),$("practiceTimer"));

  const date=new Date(r.created_at);
  $("practiceTitle").textContent="Reading history";
  $("practiceMeta").textContent=`${date.toLocaleString()} / ${wordCount} WORDS / ${Math.round(Number(r.wpm||0))} WPM / ${String(r.mode||"reading").toUpperCase()}`;

  highlight(text,words);
  hide($("wordDetail"));

  $("resultOverall").textContent=r.overall_score??0;
  $("resultCircle").style.setProperty("--score",r.overall_score??0);
  $("resultPron").textContent=r.pronunciation_score??0;
  $("resultFlu").textContent=r.fluency_score??0;
  $("resultComp").textContent=r.completeness_score??0;
  $("resultInt").textContent=r.intonation_score??0;
  $("resultWpm").textContent=Math.round(Number(r.wpm||0));

  $("resultSummary").textContent=r.summary_vi||"Không có nhận xét.";
  $("resultPriority").textContent=r.main_priority_vi||"-";
  $("resultTip").textContent=r.practice_tip_vi||"-";
  $("resultRecognized").textContent=r.recognized_text||"-";

  $("practiceRecordTitle").textContent="Kết quả lần đọc đã lưu";
  $("practiceRecordHint").textContent="Bấm Đọc lại để luyện lại đúng bài này.";
  $("retryPracticeBtn").textContent="Đọc lại";
  $("donePracticeBtn").textContent="Đóng";

  hide($("practiceRecordedActions"));
  show($("practiceResults"));
  status("practiceStatus","");
  show($("practiceModal"));
  document.body.style.overflow="hidden";
}

async function submitPractice(){if(!state.blob||!state.practicePassage){status("practiceStatus","Bạn chưa có bản ghi âm.");return}const btn=$("practiceSubmitBtn"),old=btn.textContent;btn.disabled=true;btn.textContent="Gemini đang nghe...";status("practiceStatus","Đang phân tích pronunciation, fluency và từng từ...");try{const p=state.practicePassage,d=await api("/api/assess",{method:"POST",body:JSON.stringify({passageId:p.id||null,referenceText:p.content,audioBase64:await b64(state.blob),mimeType:state.mimeType,durationSeconds:state.recordedDuration,mode:state.practiceMode,localDate:localDate()})});state.lastAssessment=d;highlight(p.content,d.assessment.words);$("resultOverall").textContent=d.assessment.overall_score;$("resultCircle").style.setProperty("--score",d.assessment.overall_score);$("resultPron").textContent=d.assessment.pronunciation_score;$("resultFlu").textContent=d.assessment.fluency_score;$("resultComp").textContent=d.assessment.completeness_score;$("resultInt").textContent=d.assessment.intonation_score;$("resultWpm").textContent=Math.round(d.wpm||0);$("resultSummary").textContent=d.assessment.summary_vi;$("resultPriority").textContent=d.assessment.main_priority_vi;$("resultTip").textContent=d.assessment.practice_tip_vi;$("resultRecognized").textContent=d.assessment.recognized_text||"-";hide($("practiceRecordedActions"));show($("practiceResults"));status("practiceStatus",`Chấm thành công bằng ${d.used_model}.`,true);await refreshProfile()}catch(e){status("practiceStatus",e.message)}finally{btn.disabled=false;btn.textContent=old}}
function retryPractice(){
  $("practiceText").textContent=state.practicePassage.content;
  hide($("practiceResults"));
  hide($("wordDetail"));
  status("practiceStatus","");
  resetRec($("practiceAudio"),$("practiceRecordedActions"),$("practiceTimer"));
  $("practiceRecordTitle").textContent="Nhấn để đọc lại";
  $("practiceRecordHint").textContent="Cố gắng cải thiện những phần được đánh dấu.";
  $("retryPracticeBtn").textContent="Đọc lại";
  $("donePracticeBtn").textContent="Hoàn tất";
}

async function finishPractice(){closePractice();await refreshProfile();const name=document.querySelector(".page:not(.hidden)")?.id?.replace("page-","");if(name)await showPage(name)}

$("googleLoginBtn").onclick=signInGoogle;$("userMenuBtn").onclick=()=>{const open=$("userMenu").classList.toggle("hidden");$("userMenuBtn").setAttribute("aria-expanded",String(!open))};$("signOutBtn").onclick=()=>state.supabase.auth.signOut();document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>showPage(b.dataset.page));document.querySelectorAll("[data-go-page]").forEach(b=>b.onclick=()=>showPage(b.dataset.goPage));document.querySelectorAll("[data-theme-choice]").forEach(b=>b.onclick=()=>applyTheme(b.dataset.themeChoice));document.addEventListener("click",closeUserMenuIfOutside);$("generateDailyBtn").onclick=generateDaily;$("generateCustomBtn").onclick=()=>generateCustom();$("saveProfileBtn").onclick=savePreferences;
$("startPlacementBtn").onclick=startPlacement;$("placementListenBtn").onclick=()=>speak(placementSamples[state.placementIndex].text);$("placementRecordBtn").onclick=()=>state.recording?stopRec($("placementRecordBtn")):startRec({button:$("placementRecordBtn"),audio:$("placementAudio"),actions:$("placementRecordedActions"),timer:$("placementTimer"),title:$("placementRecordTitle"),hint:$("placementRecordHint")});$("placementSubmitBtn").onclick=submitPlacement;$("placementNextBtn").onclick=nextPlacement;$("enterAppBtn").onclick=enterAfterPlacement;
$("closePracticeBtn").onclick=closePractice;$("practiceListenBtn").onclick=()=>state.practicePassage&&speak(state.practicePassage.content);$("practiceRecordBtn").onclick=()=>state.recording?stopRec($("practiceRecordBtn")):startRec({button:$("practiceRecordBtn"),audio:$("practiceAudio"),actions:$("practiceRecordedActions"),timer:$("practiceTimer"),title:$("practiceRecordTitle"),hint:$("practiceRecordHint")});$("practiceDiscardBtn").onclick=()=>{resetRec($("practiceAudio"),$("practiceRecordedActions"),$("practiceTimer"));$("practiceRecordTitle").textContent="Nhấn để bắt đầu đọc";$("practiceRecordHint").textContent="Đọc toàn bộ đoạn. Bấm lần nữa để dừng."};$("practiceSubmitBtn").onclick=submitPractice;$("retryPracticeBtn").onclick=retryPractice;$("donePracticeBtn").onclick=finishPractice;window.addEventListener("beforeunload",cleanup);
boot();
