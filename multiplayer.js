import { createClient } from '@supabase/supabase-js';

export const scoreKeys = ['overall_score', 'pronunciation_score', 'fluency_score', 'completeness_score', 'intonation_score'];
export function rankResults(rows, room) {
  return [...rows].sort((a, b) => {
    for (const key of scoreKeys) if (a[key] !== b[key]) return b[key] - a[key];
    if (room.wpm_tiebreak) {
      const delta = Math.abs(a.wpm - room.target_wpm) - Math.abs(b.wpm - room.target_wpm);
      if (delta) return delta;
    }
    return Date.parse(a.submitted_at) - Date.parse(b.submitted_at);
  }).map((row, i) => ({ ...row, rank: i + 1 }));
}

export function multiplayerService() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Multiplayer cần SUPABASE_SERVICE_ROLE_KEY trên server.');
  return createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function roomCommand(userId, action, roomId = null, payload = {}) {
  const { data, error } = await multiplayerService().rpc('speakup_room_command', {
    actor: userId, action, room_key: roomId, payload
  });
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  return data;
}
export function installMultiplayer(app, requireUser) {
  app.post('/api/rooms', async (req, res) => {
    try {
      const { user } = await requireUser(req);
      const { action, roomId = null, ...payload } = req.body || {};
      if (!['create', 'join', 'ready', 'start', 'finish', 'leave', 'snapshot', 'list'].includes(action))
        return res.status(400).json({ error: 'Room action không hợp lệ.' });
      const data = await roomCommand(user.id, action, roomId, payload);
      if (data?.room) data.results = rankResults(data.results || [], data.room);
      res.json(data);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}
