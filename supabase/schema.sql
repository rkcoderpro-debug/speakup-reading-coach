-- SpeakUp Reading Coach v4
-- Run this entire file once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  onboarding_completed boolean not null default false,
  placement_completed_at timestamptz,
  reading_level text not null default 'Unassessed',
  pronunciation_score integer not null default 0 check (pronunciation_score between 0 and 100),
  fluency_score integer not null default 0 check (fluency_score between 0 and 100),
  completeness_score integer not null default 0 check (completeness_score between 0 and 100),
  intonation_score integer not null default 0 check (intonation_score between 0 and 100),
  overall_score integer not null default 0 check (overall_score between 0 and 100),
  avg_wpm numeric(7,2) not null default 0,
  selected_topics text[] not null default array['Technology','Science','Daily Life']::text[],
  daily_goal integer not null default 3 check (daily_goal between 1 and 10),
  current_streak integer not null default 0,
  last_practice_date date,
  total_words_read integer not null default 0,
  total_reading_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.reading_passages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content text not null,
  topic text not null default 'Daily Life',
  level text not null default 'Intermediate',
  source text not null default 'generated' check (source in ('daily','generated','review')),
  word_count integer not null default 0,
  estimated_seconds integer not null default 0,
  focus_words text[] not null default '{}'::text[],
  focus_note text,
  created_at timestamptz not null default now()
);
create index if not exists reading_passages_user_created_idx on public.reading_passages(user_id, created_at desc);

create table if not exists public.reading_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  passage_id uuid references public.reading_passages(id) on delete set null,
  mode text not null default 'daily' check (mode in ('placement','daily','custom','review')),
  placement_step integer,
  reference_text text not null,
  recognized_text text,
  audio_duration_seconds numeric(8,2) not null default 0,
  wpm numeric(7,2) not null default 0,
  overall_score integer not null check (overall_score between 0 and 100),
  pronunciation_score integer not null check (pronunciation_score between 0 and 100),
  fluency_score integer not null check (fluency_score between 0 and 100),
  completeness_score integer not null check (completeness_score between 0 and 100),
  intonation_score integer not null check (intonation_score between 0 and 100),
  summary_vi text,
  main_priority_vi text,
  practice_tip_vi text,
  words jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists reading_attempts_user_created_idx on public.reading_attempts(user_id, created_at desc);
create index if not exists reading_attempts_user_mode_idx on public.reading_attempts(user_id, mode, created_at desc);

create table if not exists public.word_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  average_score numeric(6,2) not null default 0,
  best_score integer not null default 0,
  last_score integer not null default 0,
  attempts integer not null default 0,
  status text not null default 'weak' check (status in ('weak','improving','strong')),
  next_review date,
  last_seen date,
  updated_at timestamptz not null default now(),
  primary key (user_id, word)
);
create index if not exists word_progress_user_score_idx on public.word_progress(user_id, average_score asc);
create index if not exists word_progress_review_idx on public.word_progress(user_id, next_review asc);

create table if not exists public.daily_lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_date date not null,
  focus_title text not null,
  focus_note text,
  passage_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  unique (user_id, lesson_date)
);
create index if not exists daily_lessons_user_date_idx on public.daily_lessons(user_id, lesson_date desc);

create table if not exists public.reading_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null default current_date,
  level text not null,
  summary_vi text,
  plan_json jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists reading_plans_active_idx on public.reading_plans(user_id, active, created_at desc);

alter table public.profiles enable row level security;
alter table public.reading_passages enable row level security;
alter table public.reading_attempts enable row level security;
alter table public.word_progress enable row level security;
alter table public.daily_lessons enable row level security;
alter table public.reading_plans enable row level security;

-- Profiles
create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Reading passages
create policy "passages_select_own" on public.reading_passages for select to authenticated using ((select auth.uid()) = user_id);
create policy "passages_insert_own" on public.reading_passages for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "passages_update_own" on public.reading_passages for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "passages_delete_own" on public.reading_passages for delete to authenticated using ((select auth.uid()) = user_id);

-- Attempts
create policy "attempts_select_own" on public.reading_attempts for select to authenticated using ((select auth.uid()) = user_id);
create policy "attempts_insert_own" on public.reading_attempts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "attempts_update_own" on public.reading_attempts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "attempts_delete_own" on public.reading_attempts for delete to authenticated using ((select auth.uid()) = user_id);

-- Word progress
create policy "words_select_own" on public.word_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy "words_insert_own" on public.word_progress for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "words_update_own" on public.word_progress for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "words_delete_own" on public.word_progress for delete to authenticated using ((select auth.uid()) = user_id);

-- Daily lessons
create policy "daily_select_own" on public.daily_lessons for select to authenticated using ((select auth.uid()) = user_id);
create policy "daily_insert_own" on public.daily_lessons for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "daily_update_own" on public.daily_lessons for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "daily_delete_own" on public.daily_lessons for delete to authenticated using ((select auth.uid()) = user_id);

-- Reading plans
create policy "plans_select_own" on public.reading_plans for select to authenticated using ((select auth.uid()) = user_id);
create policy "plans_insert_own" on public.reading_plans for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "plans_update_own" on public.reading_plans for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "plans_delete_own" on public.reading_plans for delete to authenticated using ((select auth.uid()) = user_id);
