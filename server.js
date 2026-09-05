import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { installMultiplayer, roomCommand } from './multiplayer.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PRIMARY_MODEL = process.env.GEMINI_PRIMARY_MODEL?.trim() || "gemini-3.6-flash";
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash-lite")
  .split(",").map(x => x.trim()).filter(Boolean).filter(x => x !== PRIMARY_MODEL);
const MODEL_CHAIN = [PRIMARY_MODEL, ...FALLBACK_MODELS];

const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || "";
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim() || "";

app.use(express.json({ limit: "25mb" }));
app.use(express.static("public"));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function geminiClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.includes("PASTE_YOUR")) throw new Error("GEMINI_API_KEY chưa được cấu hình.");
  return new GoogleGenAI({ apiKey: key });
}

function configuredSupabase() { return Boolean(SUPABASE_URL && SUPABASE_KEY); }

function userDb(accessToken) {
  if (!configuredSupabase()) throw new Error("Supabase chưa được cấu hình.");
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}

async function requireUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) { const e = new Error("Bạn chưa đăng nhập."); e.status = 401; throw e; }
  const db = userDb(token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) { const e = new Error("Phiên đăng nhập đã hết hạn."); e.status = 401; throw e; }
  return { user: data.user, db, token };
}

function cleanErrorMessage(error) {
  const raw = error?.error?.error?.message || error?.error?.message || error?.message || String(error || "");
  return String(raw).replace(/\s+/g, " ").slice(0, 1600);
}

function getHttpStatus(error) {
  const direct = Number(error?.status);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const nested = Number(error?.error?.error?.code ?? error?.error?.code);
  if (Number.isFinite(nested) && nested > 0) return nested;
  const m = cleanErrorMessage(error).match(/\b(400|401|403|404|408|409|429|500|502|503|504)\b/);
  return m ? Number(m[1]) : 0;
}

function isTemporary(error) { return [408,429,500,502,503,504].includes(getHttpStatus(error)); }
function isUnavailableModel(error) {
  const status = getHttpStatus(error), detail = cleanErrorMessage(error);
  return status === 404 || /NOT_FOUND/i.test(detail) || /model.*(?:not found|no longer available|not available)/i.test(detail);
}
function clampScore(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0; }
function safeDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : new Date().toISOString().slice(0,10); }
function addDays(dateStr, days) { const d = new Date(`${dateStr}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
function daysBetween(a,b) { return Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`))/86400000); }
function countWords(text) { return String(text || "").trim().split(/\s+/).filter(Boolean).length; }
function normalizeWord(word) { return String(word || "").toLowerCase().replace(/[“”"'‘’.,!?;:()[\]{}—–\-]/g, "").trim(); }

function extractJson(text) {
  if (!text || typeof text !== "string") throw new Error("Gemini không trả về nội dung.");
  let s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(s); } catch {}
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(s.slice(start,end+1));
  throw new Error("Gemini trả về dữ liệu không phải JSON.");
}

async function generateContentWithFallback({ prompt, audioBase64=null, mimeType=null, jsonMode=true }) {
  const ai = geminiClient();
  let lastError = null;
  const attempts = [];
  for (let modelIndex=0; modelIndex<MODEL_CHAIN.length; modelIndex++) {
    const model = MODEL_CHAIN[modelIndex];
    for (let attempt=1; attempt<=2; attempt++) {
      if (attempt === 2) await sleep(1600 + Math.floor(Math.random()*900));
      try {
        const contents = [{ text: prompt }];
        if (audioBase64 && mimeType) contents.push({ inlineData: { mimeType, data: audioBase64 } });
        console.log(`[Gemini] ${model} attempt=${attempt}/2 audio=${Boolean(audioBase64)}`);
        const response = await ai.models.generateContent({
          model,
          contents,
          config: jsonMode ? { responseMimeType: "application/json" } : undefined
        });
        attempts.push({ model, attempt, ok:true });
        return { text: response.text, usedModel:model, fallbackUsed:modelIndex>0, attempts };
      } catch (error) {
        lastError = error;
        const status = getHttpStatus(error), detail = cleanErrorMessage(error);
        attempts.push({ model, attempt, ok:false, status, detail });
        console.warn(`[Gemini] ${model} failed status=${status}: ${detail}`);
        if (isUnavailableModel(error)) break;
        if (!isTemporary(error)) { error.attempts = attempts; throw error; }
      }
    }
  }
  if (lastError) { lastError.attempts = attempts; throw lastError; }
  throw new Error("Không có model Gemini khả dụng.");
}

function normalizeAssessment(data) {
  const statuses = new Set(["good","improve","wrong","omitted"]);
  const words = Array.isArray(data?.words) ? data.words.slice(0,220).map(w => ({
    word:String(w?.word ?? "").trim(), score:clampScore(w?.score),
    status:statuses.has(w?.status) ? w.status : "improve",
    heard_as:String(w?.heard_as ?? ""), problem:String(w?.problem ?? ""), advice_vi:String(w?.advice_vi ?? "")
  })).filter(w => w.word) : [];
  return {
    recognized_text:String(data?.recognized_text ?? ""), overall_score:clampScore(data?.overall_score),
    pronunciation_score:clampScore(data?.pronunciation_score), fluency_score:clampScore(data?.fluency_score),
    completeness_score:clampScore(data?.completeness_score), intonation_score:clampScore(data?.intonation_score),
    summary_vi:String(data?.summary_vi ?? ""), main_priority_vi:String(data?.main_priority_vi ?? ""),
    practice_tip_vi:String(data?.practice_tip_vi ?? ""), words
  };
}

function assessmentPrompt(referenceText) {
  return `You are an English READING-ALOUD coach for a Vietnamese learner.\n\nREFERENCE TEXT:\n${JSON.stringify(referenceText)}\n\nListen carefully to the attached audio and evaluate ONLY reading aloud: pronunciation, oral reading fluency, completeness, rhythm/intonation, pauses, and whether words were read incorrectly or omitted. This is NOT a grammar, vocabulary, listening, writing, or conversation test.\n\nIMPORTANT:\n- Scores are heuristic learning estimates from 0 to 100, not official exam scores.\n- pronunciation_score: audible clarity/correctness of sounds and words.\n- fluency_score: smoothness, unnecessary pauses, hesitations, restarts and phrase grouping.\n- completeness_score: omissions, insertions or substantially changed words.\n- intonation_score: sentence stress, rhythm and pitch movement while reading.\n- overall_score: balanced summary of the four metrics.\n- Do not score pronunciation highly only because you can infer the intended text.\n- If audio quality is poor, explicitly say that instead of inventing precise sound errors.\n- Give a result for each reference word, in the SAME ORDER as the reference.\n- Only name a specific phoneme issue when reasonably audible.\n- Vietnamese coaching should be concise and actionable.\n\nReturn ONLY valid JSON:\n{\n  \"recognized_text\": \"best-effort transcript of what was actually read\",\n  \"overall_score\": 0,\n  \"pronunciation_score\": 0,\n  \"fluency_score\": 0,\n  \"completeness_score\": 0,\n  \"intonation_score\": 0,\n  \"summary_vi\": \"nhận xét tổng thể bằng tiếng Việt\",\n  \"main_priority_vi\": \"một ưu tiên quan trọng nhất\",\n  \"practice_tip_vi\": \"một cách luyện cụ thể\",\n  \"words\": [{\"word\":\"reference word\",\"score\":0,\"status\":\"good\",\"heard_as\":\"\",\"problem\":\"\",\"advice_vi\":\"\"}]\n}\nstatus must be exactly one of: good, improve, wrong, omitted.`;
}

async function updateWordProgress(db,userId,words,localDate) {
  const clean = words.map(w => ({...w,key:normalizeWord(w.word)})).filter(w => w.key);
  if (!clean.length) return;
  const uniqueWords = [...new Set(clean.map(w => w.key))];
  const { data: existingRows, error: readError } = await db.from("word_progress").select("*").eq("user_id",userId).in("word",uniqueWords);
  if (readError) throw readError;
  const existing = new Map((existingRows || []).map(row => [row.word,row]));
  const grouped = new Map();
  for (const item of clean) { if (!grouped.has(item.key)) grouped.set(item.key,[]); grouped.get(item.key).push(item.score); }
  const rows = [];
  for (const [word,scores] of grouped.entries()) {
    const newScore = Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
    const old = existing.get(word), oldAttempts=Number(old?.attempts||0), oldAvg=Number(old?.average_score||0), attempts=oldAttempts+1;
    const average = oldAttempts ? (oldAvg*oldAttempts+newScore)/attempts : newScore;
    const best = Math.max(Number(old?.best_score||0),newScore);
    const status = average>=85 ? "strong" : average>=70 ? "improving" : "weak";
    const interval = newScore>=92 ? 14 : newScore>=85 ? 7 : newScore>=75 ? 4 : newScore>=60 ? 2 : 1;
    rows.push({ user_id:userId, word, average_score:Math.round(average*100)/100, best_score:best, last_score:newScore, attempts, status, next_review:addDays(localDate,interval), last_seen:localDate, updated_at:new Date().toISOString() });
  }
  const { error } = await db.from("word_progress").upsert(rows,{onConflict:"user_id,word"});
  if (error) throw error;
}

async function refreshProfileMetrics(db,userId,localDate,referenceWords,durationSeconds) {
  const { data: recent, error } = await db.from("reading_attempts").select("overall_score,pronunciation_score,fluency_score,completeness_score,intonation_score,wpm").eq("user_id",userId).neq("mode","placement").order("created_at",{ascending:false}).limit(30);
  if (error) throw error;
  const rows = recent || [];
  const avg = key => rows.length ? Math.round(rows.reduce((s,r)=>s+Number(r[key]||0),0)/rows.length) : 0;
  const avgWpm = rows.length ? Math.round((rows.reduce((s,r)=>s+Number(r.wpm||0),0)/rows.length)*10)/10 : 0;
  const { data: profile, error: profileError } = await db.from("profiles").select("current_streak,last_practice_date,total_words_read,total_reading_seconds").eq("user_id",userId).single();
  if (profileError) throw profileError;
  let streak = Number(profile.current_streak||0), last=profile.last_practice_date;
  if (!last) streak=1; else if (last===localDate) {} else if (daysBetween(last,localDate)===1) streak+=1; else streak=1;
  const { error:updateError } = await db.from("profiles").update({
    overall_score:avg("overall_score"), pronunciation_score:avg("pronunciation_score"), fluency_score:avg("fluency_score"),
    completeness_score:avg("completeness_score"), intonation_score:avg("intonation_score"), avg_wpm:avgWpm,
    current_streak:streak, last_practice_date:localDate, total_words_read:Number(profile.total_words_read||0)+referenceWords,
    total_reading_seconds:Number(profile.total_reading_seconds||0)+Math.round(durationSeconds), updated_at:new Date().toISOString()
  }).eq("user_id",userId);
  if (updateError) throw updateError;
}

function readingLevelFromScores(scores) {
  const weighted = scores.pronunciation*.35 + scores.fluency*.30 + scores.completeness*.20 + scores.intonation*.15;
  if (weighted<55) return "Beginner"; if (weighted<66) return "Elementary"; if (weighted<78) return "Intermediate"; if (weighted<88) return "Upper Intermediate"; return "Advanced";
}

function passageLengthRange(length) { return length==="quick" ? {min:35,max:60} : length==="long" ? {min:220,max:320} : {min:90,max:140}; }
function normalizeGeneratedPassage(item,fallbackTopic,fallbackLevel,source) {
  const content=String(item?.content||"").trim(), words=countWords(content);
  return { title:String(item?.title||"Reading practice").trim().slice(0,140), content, topic:String(item?.topic||fallbackTopic||"Daily Life").trim().slice(0,80), level:String(item?.level||fallbackLevel||"Intermediate").trim().slice(0,80), source, word_count:words, estimated_seconds:Math.max(20,Math.round((words/110)*60)), focus_words:Array.isArray(item?.focus_words)?item.focus_words.map(x=>String(x).trim()).filter(Boolean).slice(0,10):[], focus_note:String(item?.focus_note||"").trim().slice(0,500) };
}
async function insertPassages(db,userId,passages) { const {data,error}=await db.from("reading_passages").insert(passages.map(p=>({user_id:userId,...p}))).select(); if(error)throw error; return data||[]; }
async function currentReadingPlan(db,userId) { const {data}=await db.from("reading_plans").select("*").eq("user_id",userId).eq("active",true).order("created_at",{ascending:false}).limit(1).maybeSingle(); return data||null; }
function planFocusForDate(plan,date) { if(!Array.isArray(plan?.plan_json?.days))return null; const offset=Math.max(0,daysBetween(plan.start_date,date)); return plan.plan_json.days[offset%plan.plan_json.days.length]||null; }

function sendApiError(res,error) {
  const status=getHttpStatus(error)||Number(error?.status)||500, detail=cleanErrorMessage(error);
  console.error(error);
  if ([400,403,409,413].includes(status)) return res.status(status).json({error:detail});
  if(status===401)return res.status(401).json({error:"Phiên đăng nhập không hợp lệ hoặc đã hết hạn.",detail});
  if(status===429)return res.status(429).json({error:"Gemini Free Tier đang chạm giới hạn. Hãy thử lại sau.",detail});
  if(status===503||/high demand|UNAVAILABLE/i.test(detail))return res.status(503).json({error:"Gemini đang quá tải. App đã retry và thử model dự phòng.",detail});
  if(isUnavailableModel(error))return res.status(404).json({error:"Model Gemini hiện không khả dụng cho API key này.",detail});
  return res.status(500).json({error:"Có lỗi khi xử lý yêu cầu.",detail});
}

app.get("/api/config",(_req,res)=>res.json({supabaseUrl:SUPABASE_URL,supabaseKey:SUPABASE_KEY,supabaseConfigured:configuredSupabase(),geminiConfigured:Boolean(process.env.GEMINI_API_KEY&&!process.env.GEMINI_API_KEY.includes("PASTE_YOUR")),primaryModel:PRIMARY_MODEL,fallbackModels:FALLBACK_MODELS}));
app.get("/api/health",(_req,res)=>res.json({ok:true,supabaseConfigured:configuredSupabase(),geminiConfigured:Boolean(process.env.GEMINI_API_KEY),primaryModel:PRIMARY_MODEL,fallbackModels:FALLBACK_MODELS,api:"GenerateContent"}));

app.post("/api/assess",async(req,res)=>{
  let roomClaim = null;
  try {
    const {user,db}=await requireUser(req);
    let {passageId=null,referenceText,audioBase64,mimeType="audio/webm",durationSeconds=0,mode="daily",placementStep=null,localDate,roomId=null}=req.body||{};
    const allowedModes=new Set(["placement","daily","custom","review","multiplayer"]);
    if (mode === 'multiplayer') referenceText = 'Shared room passage';
    if(!referenceText||typeof referenceText!=="string"||referenceText.length>5000)return res.status(400).json({error:"Bài đọc không hợp lệ."});
    if(!audioBase64||typeof audioBase64!=="string")return res.status(400).json({error:"Không có dữ liệu ghi âm."});
    if(!allowedModes.has(mode))return res.status(400).json({error:"Reading mode không hợp lệ."});
    const safeMime=String(mimeType).split(";")[0].trim().toLowerCase();
    const allowedMime=new Set(["audio/webm","audio/wav","audio/mp3","audio/mpeg","audio/ogg","audio/opus","audio/aac","audio/m4a","audio/flac"]);
    if(!allowedMime.has(safeMime))return res.status(400).json({error:`Định dạng audio chưa hỗ trợ: ${safeMime}`});
    if(audioBase64.length>18000000)return res.status(413).json({error:"Bản ghi quá lớn. Hãy đọc đoạn ngắn hơn."});
    if (mode === 'multiplayer') {
      const claim = await roomCommand(user.id, 'claim', roomId);
      roomClaim = { userId:user.id, roomId, lease:claim.lease };
      referenceText = claim.room.passage;
      passageId = null;
    }
    const generated=await generateContentWithFallback({prompt:assessmentPrompt(referenceText)+(mode==='multiplayer'?'\nAlso return audio_duration_seconds: the duration in seconds of the attached audio (including pauses). Estimate from the audio, never from reference text length.':''),audioBase64,mimeType:safeMime,jsonMode:true});
    if (mode === 'multiplayer') {
      durationSeconds = Number(extractJson(generated.text).audio_duration_seconds);
      if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 300) throw new Error('Không xác định được thời lượng audio. Hãy thử lại.');
    }
    const assessment=normalizeAssessment(extractJson(generated.text));
    const duration=Math.max(0,Number(durationSeconds||0)), referenceWordCount=countWords(referenceText);
    const wpm=duration>=1?Math.round((referenceWordCount/(duration/60))*10)/10:0, date=safeDate(localDate);
    const row={user_id:user.id,passage_id:passageId||null,mode,placement_step:placementStep?Number(placementStep):null,reference_text:referenceText,recognized_text:assessment.recognized_text,audio_duration_seconds:Math.round(duration*100)/100,wpm,overall_score:assessment.overall_score,pronunciation_score:assessment.pronunciation_score,fluency_score:assessment.fluency_score,completeness_score:assessment.completeness_score,intonation_score:assessment.intonation_score,summary_vi:assessment.summary_vi,main_priority_vi:assessment.main_priority_vi,practice_tip_vi:assessment.practice_tip_vi,words:assessment.words};
    let saved;
    if (roomClaim) saved = await roomCommand(user.id,'complete',roomId,{...row,lease:roomClaim.lease});
    else {const result=await db.from("reading_attempts").insert(row).select().single();if(result.error)throw result.error;saved=result.data;}
    roomClaim = null;
    // A saved submission remains successful even if derived learning metrics fail.
    try { await updateWordProgress(db,user.id,assessment.words,date);
      if(mode!=="placement")await refreshProfileMetrics(db,user.id,date,referenceWordCount,duration);
    } catch (e) { console.error('Learning metrics update failed',e); }
    res.json({ok:true,attempt:saved,assessment,wpm,used_model:generated.usedModel,fallback_used:generated.fallbackUsed,note:"Điểm là ước lượng AI để luyện reading aloud, không phải chứng chỉ chuẩn hóa."});
  } catch(error){if(roomClaim)await roomCommand(roomClaim.userId,'fail',roomClaim.roomId,{lease:roomClaim.lease}).catch(console.error);sendApiError(res,error);}
});

installMultiplayer(app, requireUser);

app.post("/api/placement/finish",async(req,res)=>{
  try {
    const {user,db}=await requireUser(req), date=safeDate(req.body?.localDate);
    const {data:rows,error}=await db.from("reading_attempts").select("*").eq("user_id",user.id).eq("mode","placement").order("created_at",{ascending:false}); if(error)throw error;
    const latest=new Map(); for(const row of rows||[]){if(row.placement_step&&!latest.has(row.placement_step))latest.set(row.placement_step,row);}
    const selected=[...latest.values()].sort((a,b)=>Number(a.placement_step)-Number(b.placement_step));
    if(selected.length<4)return res.status(400).json({error:`Placement cần đủ 4 bài. Hiện có ${selected.length}/4.`});
    const avg=key=>Math.round(selected.reduce((s,r)=>s+Number(r[key]||0),0)/selected.length);
    const scores={overall:avg("overall_score"),pronunciation:avg("pronunciation_score"),fluency:avg("fluency_score"),completeness:avg("completeness_score"),intonation:avg("intonation_score"),wpm:Math.round((selected.reduce((s,r)=>s+Number(r.wpm||0),0)/selected.length)*10)/10};
    const level=readingLevelFromScores(scores), map=new Map();
    for(const a of selected)for(const w of a.words||[]){const k=normalizeWord(w.word);if(!k)continue;if(!map.has(k))map.set(k,[]);map.get(k).push(Number(w.score||0));}
    const weakWords=[...map.entries()].map(([word,vals])=>({word,score:Math.round(vals.reduce((a,b)=>a+b,0)/vals.length)})).sort((a,b)=>a.score-b.score).slice(0,8);
    const prompt=`You are designing a 14-day English READING-ALOUD practice roadmap.\nLearner assessment: Reading-aloud level ${level}; Pronunciation ${scores.pronunciation}; Fluency ${scores.fluency}; Completeness ${scores.completeness}; Intonation ${scores.intonation}; observed speed ${scores.wpm} WPM; weak words ${JSON.stringify(weakWords)}.\nScope is STRICTLY reading English aloud. Do not add grammar, listening quizzes, writing, conversation practice, IELTS questions, or vocabulary lessons. Build a progressive 14-day roadmap improving clear pronunciation, phrase grouping, fewer unnecessary pauses, completeness, sentence stress/intonation, and confidence with gradually longer passages. Do not encourage speed for its own sake; clarity comes first.\nReturn ONLY valid JSON: {\"summary_vi\":\"2-4 câu tiếng Việt\",\"main_focus\":[\"...\"],\"days\":[{\"day\":1,\"focus\":\"short focus name\",\"goal_vi\":\"mục tiêu tiếng Việt\",\"passage_style\":\"kind of passage\",\"focus_words\":[\"optional\"]}]}. Return exactly 14 days.`;
    const generated=await generateContentWithFallback({prompt,jsonMode:true}), plan=extractJson(generated.text);
    await db.from("reading_plans").update({active:false}).eq("user_id",user.id).eq("active",true);
    const {data:savedPlan,error:planError}=await db.from("reading_plans").insert({user_id:user.id,start_date:date,level,summary_vi:String(plan.summary_vi||""),plan_json:plan,active:true}).select().single(); if(planError)throw planError;
    const {data:profile,error:profileError}=await db.from("profiles").update({onboarding_completed:true,placement_completed_at:new Date().toISOString(),reading_level:level,overall_score:scores.overall,pronunciation_score:scores.pronunciation,fluency_score:scores.fluency,completeness_score:scores.completeness,intonation_score:scores.intonation,avg_wpm:scores.wpm,updated_at:new Date().toISOString()}).eq("user_id",user.id).select().single(); if(profileError)throw profileError;
    res.json({ok:true,profile,scores,level,weakWords,plan:savedPlan,used_model:generated.usedModel});
  } catch(error){sendApiError(res,error);}
});

app.get("/api/daily",async(req,res)=>{
  try {
    const {user,db}=await requireUser(req), date=safeDate(req.query.date);
    const {data:lesson,error}=await db.from("daily_lessons").select("*").eq("user_id",user.id).eq("lesson_date",date).maybeSingle(); if(error)throw error;
    if(!lesson)return res.json({ok:true,lesson:null,passages:[]});
    const {data:passages,error:pe}=await db.from("reading_passages").select("*").eq("user_id",user.id).in("id",lesson.passage_ids||[]); if(pe)throw pe;
    const order=new Map((lesson.passage_ids||[]).map((id,i)=>[id,i])); (passages||[]).sort((a,b)=>(order.get(a.id)??999)-(order.get(b.id)??999));
    res.json({ok:true,lesson,passages:passages||[]});
  } catch(error){sendApiError(res,error);}
});

app.post("/api/daily/generate",async(req,res)=>{
  try {
    const {user,db}=await requireUser(req), date=safeDate(req.body?.localDate);
    const {data:existing}=await db.from("daily_lessons").select("*").eq("user_id",user.id).eq("lesson_date",date).maybeSingle();
    if(existing){const {data:passages}=await db.from("reading_passages").select("*").eq("user_id",user.id).in("id",existing.passage_ids||[]);return res.json({ok:true,reused:true,lesson:existing,passages:passages||[]});}
    const {data:profile,error:profileError}=await db.from("profiles").select("*").eq("user_id",user.id).single(); if(profileError)throw profileError;
    if(!profile.onboarding_completed)return res.status(400).json({error:"Hãy hoàn thành Reading Placement trước."});
    const {data:weakRows}=await db.from("word_progress").select("word,average_score,last_score,attempts").eq("user_id",user.id).lt("average_score",85).order("average_score",{ascending:true}).limit(10);
    const {data:recent}=await db.from("reading_passages").select("title,topic,content").eq("user_id",user.id).order("created_at",{ascending:false}).limit(8);
    const plan=await currentReadingPlan(db,user.id), planDay=planFocusForDate(plan,date), topics=Array.isArray(profile.selected_topics)&&profile.selected_topics.length?profile.selected_topics:["Technology","Science","Daily Life"];
    const prompt=`Create today's English READING-ALOUD lesson. Learner level ${profile.reading_level}; Pronunciation ${profile.pronunciation_score}; Fluency ${profile.fluency_score}; Completeness ${profile.completeness_score}; Intonation ${profile.intonation_score}; recent WPM ${profile.avg_wpm}; preferred topics ${JSON.stringify(topics)}; weak/review words ${JSON.stringify(weakRows||[])}; roadmap focus ${JSON.stringify(planDay||{})}. Avoid repeating recent passages ${JSON.stringify((recent||[]).map(p=>({title:p.title,topic:p.topic,preview:p.content.slice(0,160)})))}. Scope is STRICTLY READING ALOUD. Create exactly 3 natural passages: warm-up 45-65 words, main 95-135 words, challenge 145-190 words. Match level, recycle 2-5 weak words naturally, gradually increase sentence length, use punctuation for natural phrase grouping, no tongue-twister nonsense, no comprehension quiz, grammar exercise, or explanations inside passage. Return ONLY JSON: {\"focus_title\":\"short focus\",\"focus_note_vi\":\"Vietnamese note\",\"passages\":[{\"title\":\"...\",\"topic\":\"...\",\"level\":\"${profile.reading_level}\",\"content\":\"...\",\"focus_words\":[\"...\"],\"focus_note\":\"...\"}]}`;
    const generated=await generateContentWithFallback({prompt,jsonMode:true}), result=extractJson(generated.text), raw=Array.isArray(result.passages)?result.passages.slice(0,3):[];
    if(raw.length!==3)throw new Error("Gemini không tạo đủ 3 bài đọc.");
    const passages=await insertPassages(db,user.id,raw.map(item=>normalizeGeneratedPassage(item,topics[0],profile.reading_level,"daily")));
    const {data:lesson,error:le}=await db.from("daily_lessons").insert({user_id:user.id,lesson_date:date,focus_title:String(result.focus_title||"Daily Reading"),focus_note:String(result.focus_note_vi||""),passage_ids:passages.map(p=>p.id)}).select().single(); if(le)throw le;
    res.json({ok:true,reused:false,lesson,passages,used_model:generated.usedModel,fallback_used:generated.fallbackUsed});
  } catch(error){sendApiError(res,error);}
});

app.post("/api/passage/generate",async(req,res)=>{
  try {
    const {user,db}=await requireUser(req);
    const {data:profile,error:profileError}=await db.from("profiles").select("*").eq("user_id",user.id).single(); if(profileError)throw profileError;
    const topic=String(req.body?.topic||"Daily Life").slice(0,80), length=["quick","normal","long"].includes(req.body?.length)?req.body.length:"normal", range=passageLengthRange(length);
    const focusWords=Array.isArray(req.body?.focusWords)?req.body.focusWords.map(normalizeWord).filter(Boolean).slice(0,8):[], level=String(req.body?.level||profile.reading_level||"Intermediate").slice(0,80);
    const prompt=`Generate ONE natural English passage for READING ALOUD practice. Learner level: ${level}. Topic: ${topic}. Length: ${range.min}-${range.max} words. Words to include naturally if possible: ${JSON.stringify(focusWords)}. Requirements: natural modern English, appropriate for reading aloud, punctuation for useful phrase groups, not a tongue twister, no questions/comprehension exercise/vocabulary list/grammar lesson. If focus words are supplied, use them naturally. Return ONLY valid JSON: {\"title\":\"...\",\"topic\":\"${topic}\",\"level\":\"${level}\",\"content\":\"...\",\"focus_words\":[\"...\"],\"focus_note\":\"short reading-aloud focus\"}`;
    const generated=await generateContentWithFallback({prompt,jsonMode:true}), result=extractJson(generated.text), normalized=normalizeGeneratedPassage(result,topic,level,focusWords.length?"review":"generated");
    if(!normalized.content||normalized.word_count<10)throw new Error("Gemini tạo bài đọc không hợp lệ.");
    const passages=await insertPassages(db,user.id,[normalized]);
    res.json({ok:true,passage:passages[0],used_model:generated.usedModel,fallback_used:generated.fallbackUsed});
  } catch(error){sendApiError(res,error);}
});

app.listen(PORT,()=>{
  console.log("");
  console.log("======================================================");
  console.log(" SpeakUp Reading Coach v4");
  console.log(` http://localhost:${PORT}`);
  console.log(` Gemini primary : ${PRIMARY_MODEL}`);
  console.log(` Gemini fallback: ${FALLBACK_MODELS.join(", ") || "(none)"}`);
  console.log(` Supabase       : ${configuredSupabase()?"configured":"NOT CONFIGURED"}`);
  console.log(" Audio storage  : disabled (metrics only)");
  console.log("======================================================");
  console.log("");
});
