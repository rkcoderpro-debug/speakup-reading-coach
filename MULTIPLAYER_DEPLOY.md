# SpeakUp multiplayer deployment

Based on repository commit `23bbcbe4d380898a0ae8c8ac18b451321dd957d9`. Copy the files in this update into that project, preserving their paths. Existing assets, HTML, schema.sql and themes are retained.

## Deploy checklist

1. Back up the Supabase database. Run **only** `supabase/migrations/20260905_multiplayer.sql` once in Supabase SQL Editor, after the existing v4 schema. Do not rerun or replace `schema.sql`. The migration is transactional and additive. It creates room/player/result tables, adds `profiles.bio`, grants read access to room members and restricts room mutations to the server role. Existing own-profile policies remain in effect.
2. The migration creates the public **speakup-avatars** Storage bucket with a 2 MB limit and PNG/JPEG/WebP types. If this bucket already exists, verify those settings manually: the migration leaves existing bucket settings untouched. Upload/update/delete policies restrict paths to the user's UUID folder. Uploaded avatars are publicly accessible; raw reading audio is not stored.
3. Add **SUPABASE_SERVICE_ROLE_KEY** to the Render service's server environment, alongside the existing `SUPABASE_URL`, publishable/anon key and `GEMINI_API_KEY`. Never put the service-role or Gemini key in frontend files or Git. `/api/config` continues to expose only the existing public Supabase configuration.
4. Verify Realtime is enabled. The migration adds the three new tables to `supabase_realtime` and adds authenticated private Presence policies to `realtime.messages`. The frontend subscribes to private Presence channels and RLS-filtered Postgres Changes, with a five-second snapshot fallback. See [Supabase Presence](https://supabase.com/docs/guides/realtime/presence) and [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).
5. From your project folder, run:

```bash
npm install
npm run check
npm test
git status
git add server.js multiplayer.js multiplayer.test.js package.json public/app.js public/multiplayer.js public/style.css supabase/migrations/20260905_multiplayer.sql MULTIPLAYER_DEPLOY.md
git commit -m "Add multiplayer reading rooms and profile editing"
git push
```

6. Deploy the new commit on Render (or wait for configured Auto Deploy). Test with two signed-in accounts: create/join, both ready, five-second countdown, record the same passage, submit, view final ranking. Refresh while waiting and after submission. Check all three themes and profile upload/default-avatar reset. Confirm placement, daily/custom/review reading, history and preferences still work against your live environment.

## Behavior and recovery

- Rooms support 2–20 players, a five-second countdown and a ten-minute submission window. Set the passage, target WPM (60–220, default 130) and WPM tie-break toggle when creating a room; they are frozen thereafter. The host can start, end the room or leave the lobby. Leaving transfers host to the earliest remaining player, or closes an empty room. Ending a room before all readers submit finalizes only received results; it is blocked while an assessment lease is active.
- Ranking: overall, pronunciation, fluency, completeness, intonation descending; absolute distance from target WPM ascending if enabled; server submission timestamp ascending. Timestamp is captured when the server accepts the successful submission attempt, before Gemini finishes. Exact ties across all fields retain display order.
- Gemini is called through the existing `/api/assess`. The server loads the authoritative room passage and ignores client-supplied scores and duration for multiplayer. WPM uses reference word count divided by **Gemini's estimate of attached audio duration**, including pauses; it is an estimate, not a precise media measurement. The UI states this. You can disable the WPM tie-break when this uncertainty matters.
- Only one successful result per player/room. A five-minute lease rejects concurrent submissions. Failed or expired leases allow retry within the submission window. History and immutable room results are committed in one database transaction. Multiplayer history uses the existing `custom` mode, so no existing mode constraint or history behavior changes. Learning metrics are updated afterward; failure of those derived updates does not invalidate a saved result.
- Room membership, readiness, deadlines and scores persist in Supabase. The browser remembers the last room per account; you can also rejoin by ID or the recent-room list. Refresh during a request recovers the saved result/status. A recording that has not reached the server is held only in browser memory and must be recorded again after refresh. If the server dies during assessment, retry becomes available when its lease expires. An abandoned running room finalizes after its deadline once no live assessment lease remains and a member fetches a snapshot.
- Online badges are advisory Presence information, not an authorization or scoring input. Room membership and host permissions are checked on the server/database. Profile identity lookup exposes only display name, avatar and bio to signed-in readers; it does not expose email, private history or learning metrics.
- New profile images are uploaded under unique object names. Previous uploads are retained; users may manage them in Storage under their own folder. Clearing the profile avatar uses `/assets/ai-coach.png`, the app's existing default.

## Validation performed

- JavaScript syntax checks for server and both frontend/backend multiplayer modules, plus app.js.
- Three automated ranking tests cover every score priority, target distance, symmetric WPM ties, submission time and disabling/changing the target tie-break.
- Applied the original schema and migration in local PGlite PostgreSQL, using stand-ins for Supabase auth/storage/realtime schemas. Exercised room creation, join, unauthorized access, readiness, countdown, duplicate claims/results, failed/stale lease retry, atomic attempt persistence, completion, host transfer and authenticated-role RLS isolation.
- DOM smoke test for mounting the multiplayer/profile UI, unique IDs, empty-room listing and cleanup.
- Live Supabase Realtime delivery, Storage uploads, microphone permissions, Gemini assessment and Render deployment still require the two-account live smoke test above. No production migration, deployment, commit or push was performed.
