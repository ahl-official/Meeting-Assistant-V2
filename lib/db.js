import bcrypt from 'bcryptjs';
import { supabase } from './supabase';

const SALT_ROUNDS = 10;

// ── Helpers ──────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(str) {
  return typeof str === 'string' && UUID_RE.test(str);
}
export async function findUser(identifier) {
  const id = String(identifier || '').trim().toLowerCase();
  if (!id) return null;

  const phoneDigits = id.replace(/\D/g, '');

  // Quote values so emails (user@x.com) don't break PostgREST filter parsing
  const q = `"${id.replace(/"/g, '\\"')}"`;
  const phoneQ = `"${phoneDigits.replace(/"/g, '\\"')}"`;

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .or(`email.ilike.${q},phone.eq.${phoneQ},username.ilike.${q}`)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data || null;
}

function safeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    phone: row.phone || '',
    username: row.username,
    active: row.is_active,
    isAdmin: row.is_admin,
    createdAt: row.created_at,
  };
}

function safeMeeting(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    transcript: row.transcript || '',
    srt: row.srt || '',
    summary: row.summary || '',
    actionPoints: row.action_points || [],
    decisions: row.decisions || [],
    nextSteps: row.next_steps || '',
    tasks: row.tasks || [],
    duration: row.duration || 0,
    type: row.type || 'recording',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Auth ─────────────────────────────────────────────────────

async function register({ email, phone, username, password }) {
  if (!email || !username || !password) {
    throw new Error('email, username, and password are required');
  }

  const existingByEmail = await findUser(email);
  const existingByUsername = await findUser(username);
  if (existingByEmail || existingByUsername) {
    throw new Error('User already exists');
  }

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

  const { data, error } = await supabase
    .from('users')
    .insert({
      email: String(email).trim().toLowerCase(),
      phone: phone ? String(phone).replace(/\D/g, '') : null,
      username: String(username).trim(),
      password_hash,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('Email or username already taken');
    throw new Error(error.message);
  }

  return { success: true, user: safeUser(data) };
}

async function login({ identifier, password }) {
  if (!identifier || !password) {
    throw new Error('identifier and password are required');
  }

  const user = await findUser(identifier);
  if (!user) throw new Error('User not found');
  if (!user.is_active) throw new Error('Account is deactivated');

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new Error('Invalid password');

  return { success: true, user: safeUser(user) };
}

async function getUser({ _authenticatedUser }) {
  const user = await findUser(_authenticatedUser);
  if (!user) throw new Error('User not found');
  return { success: true, user: safeUser(user) };
}

async function setActive({ _adminUsername, identifier, active }) {
  await requireAdmin(_adminUsername);

  const user = await findUser(identifier);
  if (!user) throw new Error('User not found');

  const { error } = await supabase
    .from('users')
    .update({ is_active: !!active })
    .eq('id', user.id);

  if (error) throw new Error(error.message);
  return { success: true };
}

// ── Meetings ─────────────────────────────────────────────────

async function getMeetings({ _authenticatedUser }) {
  const user = await findUser(_authenticatedUser);
  if (!user) throw new Error('User not found');

  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return { success: true, meetings: (data || []).map(safeMeeting) };
}

async function getMeeting({ _authenticatedUser, meetingId }) {
  const user = await findUser(_authenticatedUser);
  if (!user) throw new Error('User not found');

  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', meetingId)
    .eq('user_id', user.id)
    .single();

  if (error) throw new Error('Meeting not found');
  return { success: true, meeting: safeMeeting(data) };
}

async function saveMeeting({ _authenticatedUser, meeting }) {
  const user = await findUser(_authenticatedUser);
  if (!user) throw new Error('User not found');
  if (!meeting) throw new Error('meeting is required');

  const row = {
    user_id: user.id,
    title: meeting.title || 'Untitled Meeting',
    transcript: meeting.transcript || '',
    srt: meeting.srt || '',
    summary: meeting.summary || '',
    action_points: meeting.actionPoints || [],
    decisions: meeting.decisions || [],
    next_steps: meeting.nextSteps || '',
    tasks: meeting.tasks || [],
    duration: meeting.duration || 0,
    type: meeting.type || 'recording',
  };

  let data;
  let error;

  if (isValidUUID(meeting.id)) {
    // Check if this meeting already exists
    const { data: existing } = await supabase
      .from('meetings')
      .select('id, user_id')
      .eq('id', meeting.id)
      .maybeSingle();

    if (existing) {
      // Meeting exists — verify ownership before updating
      if (existing.user_id !== user.id) {
        throw new Error('Not authorized to update this meeting');
      }
      // Update existing meeting (owned by this user)
      ({ data, error } = await supabase
        .from('meetings')
        .update(row)
        .eq('id', meeting.id)
        .eq('user_id', user.id)
        .select()
        .single());
    } else {
      // Meeting doesn't exist — insert with the provided ID
      row.id = meeting.id;
      ({ data, error } = await supabase
        .from('meetings')
        .insert(row)
        .select()
        .single());
    }
  } else {
    // No valid ID — insert new meeting, let Postgres generate UUID
    ({ data, error } = await supabase
      .from('meetings')
      .insert(row)
      .select()
      .single());
  }

  if (error) throw new Error('Save failed: ' + error.message);
  return { success: true, id: data.id, meeting: safeMeeting(data) };
}

async function updateMeeting({ _authenticatedUser, meetingId, updates }) {
  const user = await findUser(_authenticatedUser);
  if (!user) throw new Error('User not found');
  if (!meetingId || !updates) throw new Error('meetingId and updates are required');

  const patch = {};
  if (updates.title !== undefined) patch.title = updates.title;
  if (updates.transcript !== undefined) patch.transcript = updates.transcript;
  if (updates.srt !== undefined) patch.srt = updates.srt;
  if (updates.summary !== undefined) patch.summary = updates.summary;
  if (updates.actionPoints !== undefined) patch.action_points = updates.actionPoints;
  if (updates.decisions !== undefined) patch.decisions = updates.decisions;
  if (updates.nextSteps !== undefined) patch.next_steps = updates.nextSteps;
  if (updates.tasks !== undefined) patch.tasks = updates.tasks;
  if (updates.duration !== undefined) patch.duration = updates.duration;
  if (updates.type !== undefined) patch.type = updates.type;

  const { data, error } = await supabase
    .from('meetings')
    .update(patch)
    .eq('id', meetingId)
    .eq('user_id', user.id)
    .select('id');

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('Meeting not found');
  return { success: true };
}

async function deleteMeeting({ _authenticatedUser, meetingId }) {
  const user = await findUser(_authenticatedUser);
  if (!user) throw new Error('User not found');
  if (!meetingId) throw new Error('meetingId is required');

  const { data, error } = await supabase
    .from('meetings')
    .delete()
    .eq('id', meetingId)
    .eq('user_id', user.id)
    .select('id');

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('Meeting not found');
  return { success: true };
}

// ── Logging ──────────────────────────────────────────────────

async function pipelineLog({ _authenticatedUser, action, step, level, message, detail, latencyMs }) {
  try {
    let userId = null;
    if (_authenticatedUser) {
      try {
        const user = await findUser(_authenticatedUser);
        userId = user?.id || null;
      } catch {
        userId = null;
      }
    }

    const detailStr =
      detail == null
        ? null
        : typeof detail === 'string'
          ? detail
          : JSON.stringify(detail);

    await supabase.from('logs').insert({
      user_id: userId,
      action: action || null,
      step: step || null,
      level: level || 'INFO',
      message: message || null,
      detail: detailStr,
      latency_ms: latencyMs != null ? Number(latencyMs) : null,
    });
  } catch {
    // never crash the app
  }

  return { success: true };
}

// ── Admin ────────────────────────────────────────────────────

async function requireAdmin(adminUsername) {
  const user = await findUser(adminUsername);
  if (!user || !user.is_admin) throw new Error('Admin access required');
  return user;
}

async function getAllUsers({ _adminUsername }) {
  await requireAdmin(_adminUsername);

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return { success: true, users: (data || []).map(safeUser) };
}

async function getAllMeetings({ _adminUsername }) {
  await requireAdmin(_adminUsername);

  const { data, error } = await supabase
    .from('meetings')
    .select('*, users(username)')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  const meetings = (data || []).map((row) => ({
    ...safeMeeting(row),
    owner: row.users?.username || 'unknown',
  }));

  return { success: true, meetings };
}

async function setAdmin({ _adminUsername, targetUsername, isAdmin }) {
  await requireAdmin(_adminUsername);

  const target = await findUser(targetUsername);
  if (!target) throw new Error('Target user not found');

  const { error } = await supabase
    .from('users')
    .update({ is_admin: !!isAdmin })
    .eq('id', target.id);

  if (error) throw new Error(error.message);
  return { success: true };
}

// ── Action router ────────────────────────────────────────────

const actions = {
  register,
  login,
  getUser,
  setActive,
  getMeetings,
  getMeeting,
  saveMeeting,
  updateMeeting,
  deleteMeeting,
  pipelineLog,
  getAllUsers,
  getAllMeetings,
  setAdmin,
};

export function getAction(name) {
  return actions[name] || null;
}

export {
  safeUser,
  safeMeeting,
  register,
  login,
  getUser,
  setActive,
  getMeetings,
  getMeeting,
  saveMeeting,
  updateMeeting,
  deleteMeeting,
  pipelineLog,
  getAllUsers,
  getAllMeetings,
  setAdmin,
};
