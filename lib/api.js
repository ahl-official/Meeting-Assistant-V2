// ============================================================
// lib/api.js — Supabase API client
// All calls go through the Next.js /api/db router.
// The action is passed as a query param; the body as POST JSON.
// NOTE: For authenticated actions, the server derives the acting user
// from the NextAuth session. Client-supplied 'username' is ignored.
// ============================================================

const PROXY_URL = '/api/db';

function summarizeResponseText(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'No response body.';
  return raw.slice(0, 220);
}

async function request(action, payload = {}) {
  try {
    const res = await fetch(`${PROXY_URL}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    if (!res.ok) {
      const errText = await res.text();
      let message = summarizeResponseText(errText);
      if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(errText);
          if (parsed?.error) message = parsed.error;
          if (parsed?.detail) message = `${message} (${parsed.detail})`;
        } catch (e) { }
      }
      throw new Error(`Request failed (${res.status}): ${message}`);
    }

    if (!contentType.includes('application/json')) {
      const bodyText = await res.text();
      throw new Error(`Invalid API response: ${summarizeResponseText(bodyText)}`);
    }

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error from API');
    return data;
  } catch (err) {
    console.error(`API ${action} failed:`, err);
    throw err;
  }
}

// ── Auth ──────────────────────────────────────────────────────

/**
 * login({ identifier, password })
 * identifier = email OR phone OR username
 * Returns { user: { email, phone, username, active, createdAt, isAdmin } }
 */
export const login = (identifier, password) =>
  request('login', { identifier, password });

/**
 * register({ email, phone, username, password })
 * email and phone are stored as separate user fields.
 */
export const register = ({ email, phone, username, password }) =>
  request('register', { email, phone, username, password });

export const getUser = (identifier) =>
  request('getUser', { identifier });

/**
 * setActive — activate or deactivate a user account (admin only)
 * adminUsername: calling admin (must already be admin)
 * identifier: email, phone, or username of the target user
 */
export const setActive = (adminUsername, identifier, active) =>
  request('setActive', { adminUsername, identifier, active });

// ── Meetings ──────────────────────────────────────────────────

/** Fetch all meetings for a user (sorted newest first) */
export const getMeetings = (identifier) =>
  request('getMeetings', { username: identifier });

/** Fetch a single meeting by id for a user */
export const getMeeting = (username, meetingId) =>
  request('getMeeting', { username, meetingId });

/** Save a complete meeting record */
export const saveMeeting = (username, meeting) =>
  request('saveMeeting', { username, meeting });

/**
 * updateMeeting — partial update of any meeting fields.
 * updates object is passed through as-is; do NOT strip tasks or actionPoints before calling.
 */
export const updateMeeting = (username, meetingId, updates) =>
  request('updateMeeting', { username, meetingId, updates });

export const deleteMeeting = (username, meetingId) =>
  request('deleteMeeting', { username, meetingId });

// ── Pipeline logging ──────────────────────────────────────────

export const pipelineLog = (username, { action, step, level = 'INFO', message, detail, latencyMs }) =>
  request('pipelineLog', { username, action, step, level, message, detail, latencyMs })
    .catch(() => { }); // Never let logging crash the main flow

// ── Admin ─────────────────────────────────────────────────────

/**
 * getAllUsers — fetch every user's profile.
 * adminUsername must belong to an admin account.
 * Returns { users: [{ email, phone, username, active, createdAt, isAdmin }] }
 */
export const getAllUsers = (adminUsername) =>
  request('getAllUsers', { adminUsername });

/**
 * getAllMeetings — fetch every meeting from every user.
 * Returns { meetings: [{ owner, id, title, summary, actionPoints, tasks, ... }] }
 */
export const getAllMeetings = (adminUsername) =>
  request('getAllMeetings', { adminUsername });

/**
 * setAdmin — grant or revoke admin access for a user.
 * adminUsername: calling admin (must already be admin).
 * targetUsername: user to update.
 * isAdmin: true to grant, false to revoke.
 */
export const setAdmin = (adminUsername, targetUsername, isAdmin) =>
  request('setAdmin', { adminUsername, targetUsername, isAdmin });

/**
 * resetPassword — set a new password for a user (admin only).
 * The plaintext is hashed server-side; it is never stored or returned.
 */
export const resetPassword = (targetIdentifier, newPassword) =>
  request('resetPassword', { targetIdentifier, newPassword });
