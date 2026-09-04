# SpeakUp Frontend Redesign Notes

## Design Read

Redesign-preserve of a focused consumer reading-aloud product for students and self-learners, with a calm, premium, highly legible product language using native CSS semantic tokens and restrained motion.

## Dials

- DESIGN_VARIANCE: 5
- MOTION_INTENSITY: 3
- VISUAL_DENSITY: 4

## Audit summary

Preserved:
- Existing information architecture: Today, Read, Difficult Words, Progress, Profile
- Every backend endpoint and server file
- Supabase auth/database flow
- Existing DOM IDs used by app.js
- Placement, recording, assessment, Daily Reading, roadmap and word-bank flows

Retired or reduced:
- Inter font dependency
- Excessive small uppercase section labels
- Emoji-based controls
- Repetitive equal-card grids
- Heavy white-card-on-white-card dashboard rhythm
- Decorative status dot
- Repeated middle-dot separators
- Visible em-dashes
- Circular loading spinner

## Visual system

- Cool neutral light/dark palette
- Existing indigo brand accent preserved and recalibrated
- 16px card radius, 10px control radius, pill only for identity/topic chips
- System UI sans stack for product chrome
- Reading serif used only inside passages and placement text
- No automatic decorative motion; tactile hover/active states only
- System dark mode through CSS variables and prefers-color-scheme
- Reduced-motion fallback included

## Backend integrity

`server.js`, `supabase/schema.sql`, `.env.example`, auth configuration and API contracts were not changed.
