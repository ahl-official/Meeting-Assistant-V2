# AI Meeting Assistant — Setup & Deployment Guide

## Overview

AI Meeting Assistant is a modern web application for recording, transcribing, analyzing, and storing meeting notes and action points.

- **Speech-to-Text**: Real-time recording and single-request file uploads powered by **AssemblyAI**.
- **AI Analysis**: Meeting summaries, decisions, action points, and task extraction powered by **OpenRouter** (Gemini models).
- **Database & Persistence**: Postgres database hosted on **Supabase**.
- **Authentication**: JWT session management with **NextAuth.js** and `bcrypt` password hashing.
- **Messaging Integration**: Action plan distribution via **WAHA** (WhatsApp HTTP API).

---

## Tech Stack

- **Framework**: Next.js 14 (Pages Router)
- **Language**: JavaScript (ES6+ / React 18)
- **Authentication**: NextAuth.js (Credentials Provider + JWT)
- **Database**: Cloud Postgres (Supabase)
- **Transcription**: AssemblyAI API
- **AI Inference**: OpenRouter API (`google/gemini-2.5-flash-lite` default)
- **Styling**: Vanilla CSS Modules

---

## Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **Supabase Account**: Project URL and Service Role Key
- **AssemblyAI Account**: API Key
- **OpenRouter Account**: API Key with available credits

---

## Environment Variables

Copy `.env.local.example` to `.env.local` in the project root:

```bash
cp .env.local.example .env.local
```

### Configuration Parameters

| Variable | Required | Description |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase Project API URL (`https://<project-id>.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only Supabase Service Role Key (bypasses RLS) |
| `NEXTAUTH_SECRET` | Yes | Secret used to sign JWTs (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Yes | Base URL (`http://localhost:3000` locally, domain in production) |
| `ASSEMBLYAI_API_KEY` | Yes | AssemblyAI API Key for audio upload & transcription |
| `OPENROUTER_API_KEY` | Yes | OpenRouter API Key for summary and task generation |
| `OPENROUTER_MODEL` | No | Optional LLM model override (defaults to `google/gemini-2.5-flash-lite`) |
| `WAHA_API_URL` | No | WAHA WhatsApp server endpoint (optional) |
| `WAHA_API_KEY` | No | WAHA API authorization key (optional) |
| `WAHA_SESSION` | No | WAHA session name (default: `default`) |

---

## Supabase Database Setup

1. Create a new project in [Supabase](https://supabase.com).
2. Open the **SQL Editor** in your Supabase Dashboard.
3. Run the following DDL script to create the necessary tables (`users`, `meetings`, `logs`) and indexes:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users Table
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Meetings Table
CREATE TABLE IF NOT EXISTS public.meetings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled Meeting',
  transcript TEXT DEFAULT '',
  srt TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  action_points JSONB DEFAULT '[]'::jsonb,
  decisions JSONB DEFAULT '[]'::jsonb,
  next_steps TEXT DEFAULT '',
  tasks JSONB DEFAULT '[]'::jsonb,
  duration INT DEFAULT 0,
  type TEXT DEFAULT 'recording',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Audit Logs Table
CREATE TABLE IF NOT EXISTS public.logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT,
  step TEXT,
  level TEXT DEFAULT 'INFO',
  message TEXT,
  detail TEXT,
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_meetings_user_id ON public.meetings(user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_created_at ON public.meetings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
```

4. Grant permissions to the `service_role`:

```sql
GRANT ALL ON public.users TO service_role;
GRANT ALL ON public.meetings TO service_role;
GRANT ALL ON public.logs TO service_role;
```

---

## Creating the Initial Admin User

Generate a bcrypt password hash (e.g. using `bcryptjs` in Node or an online generator with 10 rounds), then insert the admin user into Supabase SQL Editor:

```sql
INSERT INTO public.users (email, phone, username, password_hash, is_admin, is_active)
VALUES (
  'admin@example.com',
  '+1234567890',
  'admin',
  '$2a$10$YourBcryptHashHere', -- Replace with your hashed password
  true,
  true
);
```

---

## Running Locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Generate NextAuth secret:
   ```bash
   openssl rand -base64 32
   ```
   Add the generated secret to `NEXTAUTH_SECRET` in `.env.local`.

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Deployment to Vercel

1. Push your codebase to GitHub/GitLab.
2. Import the repository into **Vercel**.
3. Configure all environment variables in **Project Settings → Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL` (set to your production domain, e.g. `https://your-app.vercel.app`)
   - `ASSEMBLYAI_API_KEY`
   - `OPENROUTER_API_KEY`
4. Click **Deploy**.

---

## Known Limitations & Production Notes

- **Vercel Function Timeouts**:
  - Vercel Hobby plans enforce a **10-second** to **60-second** maximum serverless function execution limit.
  - Large audio file uploads (100MB+) or extremely long transcripts (2+ hours) require multiple LLM calls and may exceed 60s. For heavy enterprise usage, deploy on Vercel Pro (up to 300s function duration) or host on dedicated infrastructure (Docker/Node server).
- **Authentication**:
  - Native password resets via email are not configured out of the box; user account statuses and roles can be managed by admins in the `/admin` portal.
