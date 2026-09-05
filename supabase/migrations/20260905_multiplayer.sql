-- Additive migration for the existing SpeakUp v4 schema. Run once in SQL Editor.
begin;
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add constraint speakup_bio_length check (length(bio) <= 300);

create table public.speakup_rooms (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id),
  title text not null check (length(title) between 1 and 140),
  passage text not null check (length(passage) between 10 and 5000),
  target_wpm integer not null default 130 check (target_wpm between 60 and 220),
  wpm_tiebreak boolean not null default true,
  state text not null default 'lobby' check (state in ('lobby','running','finished')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.speakup_players (
  room_id uuid references public.speakup_rooms on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  ready boolean not null default false,
  status text not null default 'joined' check (status in ('joined','assessing','submitted','failed','left')),
  joined_at timestamptz not null default now(),
  submitted_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  primary key (room_id,user_id)
);
create table public.speakup_results (
  room_id uuid not null,
  user_id uuid not null,
  attempt_id uuid references public.reading_attempts(id) on delete set null,
  overall_score integer not null check (overall_score between 0 and 100),
  pronunciation_score integer not null check (pronunciation_score between 0 and 100),
  fluency_score integer not null check (fluency_score between 0 and 100),
  completeness_score integer not null check (completeness_score between 0 and 100),
  intonation_score integer not null check (intonation_score between 0 and 100),
  wpm numeric not null check (wpm between 0 and 1000),
  submitted_at timestamptz not null,
  primary key (room_id,user_id),
  foreign key (room_id,user_id) references public.speakup_players on delete cascade
);
create index on public.speakup_players(user_id,room_id);
alter table public.speakup_rooms enable row level security;
alter table public.speakup_players enable row level security;
alter table public.speakup_results enable row level security;

create function public.speakup_is_member(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.speakup_players where room_id=rid and user_id=(select auth.uid()));
$$;
revoke all on function public.speakup_is_member(uuid) from public;
grant execute on function public.speakup_is_member(uuid) to authenticated;
create policy speakup_room_read on public.speakup_rooms for select to authenticated using (public.speakup_is_member(id));
create policy speakup_player_read on public.speakup_players for select to authenticated using (public.speakup_is_member(room_id));
create policy speakup_result_read on public.speakup_results for select to authenticated using (public.speakup_is_member(room_id));
revoke all on public.speakup_rooms,public.speakup_players,public.speakup_results from anon,authenticated;
grant select on public.speakup_rooms,public.speakup_players,public.speakup_results to authenticated;
grant all on public.speakup_rooms,public.speakup_players,public.speakup_results to service_role;

-- Only public identity fields, never email, learning metrics or private history.
create function public.speakup_identities(ids uuid[]) returns table(user_id uuid,display_name text,avatar_url text,bio text)
language sql stable security definer set search_path = '' as $$
 select p.user_id,p.display_name,p.avatar_url,p.bio from public.profiles p
 where (select auth.uid()) is not null and p.user_id=any(ids[1:100]);
$$;
revoke all on function public.speakup_identities(uuid[]) from public;
grant execute on function public.speakup_identities(uuid[]) to authenticated;

-- All mutations serialized on the room row. Callable ONLY by authenticated server code
-- using the service role; actor is taken from auth.getUser(), never from request data.
create function public.speakup_room_command(actor uuid, action text, room_key uuid default null, payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.speakup_rooms; p public.speakup_players; saved uuid; result jsonb;
begin
 if action='list' then
   return jsonb_build_object('rooms', coalesce((select jsonb_agg(x) from (
    select id,title,state,host_id,created_at from public.speakup_rooms
    where (state='lobby' and created_at>now()-interval '1 day') or id in
      (select room_id from public.speakup_players where user_id=actor)
    order by created_at desc limit 40) x),'[]'::jsonb));
 end if;
 if action='create' then
   if (select count(*) from public.speakup_rooms where host_id=actor and state<>'finished' and created_at>now()-interval '1 day')>=5 then
     raise exception 'Bạn đã có 5 phòng đang mở.';
   end if;
   insert into public.speakup_rooms(host_id,title,passage,target_wpm,wpm_tiebreak)
   values(actor,trim(payload->>'title'),trim(payload->>'passage'),coalesce((payload->>'target_wpm')::int,130),coalesce((payload->>'wpm_tiebreak')::boolean,true)) returning * into r;
   insert into public.speakup_players(room_id,user_id) values(r.id,actor);
   return jsonb_build_object('roomId',r.id);
 end if;
 select * into r from public.speakup_rooms where id=room_key for update;
 if not found then raise exception 'Không tìm thấy phòng.'; end if;
 select * into p from public.speakup_players where room_id=r.id and user_id=actor;
 if action='join' then
   if p.user_id is null or p.status='left' then
     if r.state<>'lobby' then raise exception 'Phòng đã bắt đầu.'; end if;
     if (select count(*) from public.speakup_players where room_id=r.id and status<>'left')>=20 then raise exception 'Phòng đã đủ 20 người.'; end if;
     insert into public.speakup_players(room_id,user_id) values(r.id,actor)
       on conflict(room_id,user_id) do update set status='joined',ready=false;
   end if;
   return jsonb_build_object('roomId',r.id);
 end if;
 if p.user_id is null then raise exception 'Bạn chưa tham gia phòng.'; end if;
 if r.state='running' and now()>r.ends_at and not exists
   (select 1 from public.speakup_players where room_id=r.id and status='assessing' and lease_until>now()) then
   update public.speakup_rooms set state='finished' where id=r.id returning * into r;
 end if;
 if action='ready' then
   if r.state<>'lobby' or p.status='left' then raise exception 'Không thể đổi ready.'; end if;
   update public.speakup_players set ready=coalesce((payload->>'ready')::boolean,false) where room_id=r.id and user_id=actor;
 elsif action='start' then
   if actor<>r.host_id or r.state<>'lobby' then raise exception 'Chỉ host được bắt đầu trong lobby.'; end if;
   if (select count(*) from public.speakup_players where room_id=r.id and status<>'left')<2 or exists
     (select 1 from public.speakup_players where room_id=r.id and status<>'left' and not ready) then raise exception 'Cần ít nhất 2 người, tất cả sẵn sàng.'; end if;
   update public.speakup_rooms set state='running',starts_at=now()+interval '5 seconds',ends_at=now()+interval '10 minutes 5 seconds' where id=r.id;
 elsif action='finish' then
   if actor<>r.host_id or r.state='finished' then raise exception 'Chỉ host được kết thúc phòng đang mở.'; end if;
   if exists(select 1 from public.speakup_players where room_id=r.id and status='assessing' and lease_until>now()) then raise exception 'Hãy chờ các bài đang chấm.'; end if;
   update public.speakup_rooms set state='finished' where id=r.id;
 elsif action='leave' then
   if r.state<>'lobby' then raise exception 'Sau khi bắt đầu, có thể rời màn hình và quay lại phòng.'; end if;
   update public.speakup_players set status='left',ready=false where room_id=r.id and user_id=actor;
   if actor=r.host_id then
     select user_id into saved from public.speakup_players where room_id=r.id and status<>'left' order by joined_at limit 1;
     update public.speakup_rooms set host_id=coalesce(saved,host_id),state=case when saved is null then 'finished' else state end where id=r.id;
   end if;
 elsif action='claim' then
   if exists(select 1 from public.speakup_results where room_id=r.id and user_id=actor) then raise exception 'Bài đã được nộp. Mở bảng xếp hạng để xem kết quả.'; end if;
   if r.state<>'running' or now()<r.starts_at or now()>r.ends_at or p.status='left' then raise exception 'Không trong thời gian nộp bài.'; end if;
   if p.status='assessing' and p.lease_until>now() then raise exception 'Bài đang được chấm. Vui lòng chờ.'; end if;
   saved=gen_random_uuid();
   update public.speakup_players set status='assessing',lease_id=saved,lease_until=now()+interval '5 minutes',submitted_at=now() where room_id=r.id and user_id=actor;
   return jsonb_build_object('room',to_jsonb(r),'lease',saved);
 elsif action='fail' then
   update public.speakup_players set status='failed',lease_until=null where room_id=r.id and user_id=actor and lease_id=(payload->>'lease')::uuid and status='assessing';
 elsif action='complete' then
   if p.status<>'assessing' or p.lease_id is distinct from (payload->>'lease')::uuid or r.state<>'running' then raise exception 'Bản nộp đã hết hiệu lực.'; end if;
   -- Store private assessment history and immutable leaderboard scores atomically.
   insert into public.reading_attempts(user_id,mode,reference_text,recognized_text,audio_duration_seconds,wpm,overall_score,pronunciation_score,fluency_score,completeness_score,intonation_score,summary_vi,main_priority_vi,practice_tip_vi,words)
   values(actor,'custom',r.passage,payload->>'recognized_text',(payload->>'audio_duration_seconds')::numeric,(payload->>'wpm')::numeric,
     (payload->>'overall_score')::int,(payload->>'pronunciation_score')::int,(payload->>'fluency_score')::int,(payload->>'completeness_score')::int,(payload->>'intonation_score')::int,
     payload->>'summary_vi',payload->>'main_priority_vi',payload->>'practice_tip_vi',payload->'words') returning id into saved;
   insert into public.speakup_results values(r.id,actor,saved,(payload->>'overall_score')::int,(payload->>'pronunciation_score')::int,(payload->>'fluency_score')::int,(payload->>'completeness_score')::int,(payload->>'intonation_score')::int,(payload->>'wpm')::numeric,p.submitted_at);
   update public.speakup_players set status='submitted',lease_until=null where room_id=r.id and user_id=actor;
   if not exists(select 1 from public.speakup_players where room_id=r.id and status not in ('submitted','left')) then update public.speakup_rooms set state='finished' where id=r.id; end if;
   select to_jsonb(a) into result from public.reading_attempts a where id=saved;
   return result;
 elsif action<>'snapshot' then raise exception 'Unknown action';
 end if;
 select * into r from public.speakup_rooms where id=room_key;
 return jsonb_build_object('room',to_jsonb(r),'serverTime',now(),
   'players',coalesce((select jsonb_agg(jsonb_build_object('user_id',q.user_id,'ready',q.ready,'status',q.status,'lease_until',q.lease_until,'display_name',f.display_name,'avatar_url',f.avatar_url,'bio',f.bio)) from public.speakup_players q left join public.profiles f on f.user_id=q.user_id where q.room_id=r.id),'[]'::jsonb),
   'results',coalesce((select jsonb_agg(to_jsonb(s)) from public.speakup_results s where s.room_id=r.id),'[]'::jsonb));
end;
$$;
revoke all on function public.speakup_room_command(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.speakup_room_command(uuid,text,uuid,jsonb) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('speakup-avatars','speakup-avatars',true,2097152,array['image/png','image/jpeg','image/webp'])
on conflict(id) do nothing;
create policy speakup_avatar_insert on storage.objects for insert to authenticated with check(bucket_id='speakup-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy speakup_avatar_update on storage.objects for update to authenticated using(bucket_id='speakup-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='speakup-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy speakup_avatar_delete on storage.objects for delete to authenticated using(bucket_id='speakup-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy speakup_avatar_select on storage.objects for select to authenticated using(bucket_id='speakup-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);

-- Private channels: identity presence is advisory; never used to authorize scores/actions.
create policy speakup_presence_read on realtime.messages for select to authenticated using (
 extension='presence' and (realtime.topic()='speakup-online' or exists(select 1 from public.speakup_players where user_id=(select auth.uid()) and 'speakup-room-'||room_id::text=realtime.topic())));
create policy speakup_presence_write on realtime.messages for insert to authenticated with check (
 extension='presence' and (realtime.topic()='speakup-online' or exists(select 1 from public.speakup_players where user_id=(select auth.uid()) and 'speakup-room-'||room_id::text=realtime.topic())));
do $$ declare t text; begin
 foreach t in array array['speakup_rooms','speakup_players','speakup_results'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
     execute format('alter publication supabase_realtime add table public.%I',t);
   end if;
 end loop;
end $$;
commit;
