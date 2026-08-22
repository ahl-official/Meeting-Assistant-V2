// ============================================================
// pages/api/send-whatsapp.js
// Sends meeting action plan via WAHA (WhatsApp HTTP API)
// ============================================================

import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import { getMeeting } from '../../lib/db';

// Cloudflare in front of WAHA returns 403 / error 1010 for clients
// that look like bots (missing or non-browser User-Agent).
function wahaHeaders(apiKey, extra = {}) {
    return {
        Accept: 'application/json',
        'X-Api-Key': apiKey,
        'User-Agent': 'AI-Meeting-Assistant/1.0 (WhatsApp share)',
        ...extra,
    };
}

// ── Helpers ──────────────────────────────────────────────────

function normalizePhone(raw) {
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, '');
    return digits || null;
}

function toChatId(raw) {
    let digits = normalizePhone(raw);
    if (!digits) return null;
    if (digits.length === 10) digits = '91' + digits;
    if (digits.length < 7) return null;
    return digits + '@c.us';
}

async function resolveChatId(raw, config) {
    const fallbackChatId = toChatId(raw);
    if (!fallbackChatId) return null;

    const phone = fallbackChatId.replace('@c.us', '');
    const url = new URL('/api/contacts/check-exists', config.baseUrl);
    url.searchParams.set('phone', phone);
    url.searchParams.set('session', config.session);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: wahaHeaders(config.apiKey),
            signal: controller.signal,
        });

        const body = await response.text();
        if (!response.ok) {
            throw new Error(`WAHA number check failed (${response.status}): ${body}`);
        }

        const data = body ? JSON.parse(body) : {};
        if (data.numberExists === false) {
            throw new Error(`Number ${phone} is not registered on WhatsApp`);
        }

        return data.chatId || fallbackChatId;
    } finally {
        clearTimeout(timeout);
    }
}

// ── USER MESSAGE (FULL) ───────────────────────────────────────

function buildUserMessage(meeting, username) {
    const PRIORITY_EMOJI = { high: '🔴', medium: '🟡', low: '🟢', critical: '🔴' };
    const lines = [];

    if (username) {
        lines.push(`👋 Hi *${username}*,`);
        lines.push(`Here's your meeting summary and action plan:`);
        lines.push('');
    }

    lines.push(`📋 *${meeting.title || 'Untitled Meeting'}*`);
    lines.push(`🗓 ${new Date(meeting.createdAt).toLocaleDateString('en-GB')}`);
    if (meeting.duration > 0) lines.push(`⏱ Duration: ${meeting.duration} min`);
    lines.push('');

    if (meeting.summary) {
        lines.push('📝 *Summary*');
        lines.push(meeting.summary);
        lines.push('');
    }

    const aps = meeting.actionPoints || [];
    if (aps.length > 0) {
        lines.push(`✅ *Action Points (${aps.length})*`);
        aps.forEach((ap, i) => {
            const emoji = PRIORITY_EMOJI[ap.priority] || '⚪';
            lines.push(`${i + 1}. ${emoji} *${ap.task}*`);
            lines.push(`   👤 ${ap.owner || 'Unassigned'}  📅 ${ap.dueDate || 'No date'}`);
        });
        lines.push('');
    }

    const tasks = meeting.tasks || [];
    if (tasks.length > 0) {
        lines.push(`📌 *Tasks (${tasks.length})*`);
        tasks.forEach((task, i) => {
            const statusEmoji =
                task.status === 'done' ? '✅' :
                    task.status === 'in_progress' ? '🔄' : '⬜';

            // ✅ Fixed: use title (not task.task), owner (not assignee), details (not notes)
            lines.push(`${i + 1}. ${statusEmoji} *${task.title || task.task || task.name || 'Untitled task'}*`);

            if (task.owner || task.assignee)
                lines.push(`   👤 ${task.owner || task.assignee}`);

            if (task.dueDate)
                lines.push(`   📅 ${task.dueDate}`);

            if (task.details && task.details.length > 0)
                task.details.forEach(d => lines.push(`   • ${d}`));
        });
        lines.push('');
    }

    const decisions = meeting.decisions || [];
    if (decisions.length > 0) {
        lines.push('🏛 *Decisions Made*');
        decisions.forEach(d => lines.push(`• ${d}`));
        lines.push('');
    }

    if (meeting.nextSteps) {
        lines.push('🚀 *Next Steps*');
        lines.push(meeting.nextSteps);
        lines.push('');
    }

    lines.push('_Sent via AI Meeting Assistant_ 🤖');

    return lines.join('\n');
}

// ── COORDINATOR MESSAGE (TASKS ONLY) ─────────────────────────

function buildCoordinatorMessage(meeting, username) {
    const lines = [];

    lines.push(`📋 *${meeting.title || 'Untitled Meeting'}*`);
    lines.push(`🗓 ${new Date(meeting.createdAt).toLocaleDateString('en-GB')}`);
    lines.push('');

    if (username) {
        lines.push(`👤 For *${username}*`);
        lines.push('');
    }

    const tasks = meeting.tasks || [];

    if (tasks.length > 0) {
        lines.push(`📌 *Tasks for Coordination (${tasks.length})*`);

        tasks.forEach((task, i) => {
            const statusEmoji =
                task.status === 'done' ? '✅' :
                    task.status === 'in_progress' ? '🔄' : '⬜';

            // ✅ Fixed: same field names as TasksPanel schema
            lines.push(`${i + 1}. ${statusEmoji} *${task.title || task.task || task.name || 'Untitled task'}*`);

            if (task.owner || task.assignee)
                lines.push(`   👤 ${task.owner || task.assignee}`);

            if (task.dueDate)
                lines.push(`   📅 ${task.dueDate}`);

            if (task.details && task.details.length > 0)
                task.details.forEach(d => lines.push(`   • ${d}`));
        });

    } else {
        lines.push('_No tasks assigned for this meeting._');
    }

    lines.push('');
    lines.push('_Sent via AI Meeting Assistant_ 🤖');

    return lines.join('\n');
}

// ── SEND MESSAGE ─────────────────────────────────────────────

async function sendMessage(chatId, text, config) {
    const endpoint = new URL('/api/sendText', config.baseUrl).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: wahaHeaders(config.apiKey, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                chatId,
                text,
                session: config.session,
            }),
            signal: controller.signal,
        });

        const body = await response.text();

        if (!response.ok) {
            let detail = body;
            try {
                detail = JSON.parse(body)?.message || detail;
            } catch { }

            throw new Error(`WAHA error (${response.status}): ${detail}`);
        }

        return true;
    } finally {
        clearTimeout(timeout);
    }
}

// ── API HANDLER ─────────────────────────────────────────────

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).end();
    }

    const session = await getServerSession(req, res, authOptions);
    if (!session) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const WAHA_BASE_URL = process.env.WAHA_API_URL || process.env.WAHA_BASE_URL;

    if (!WAHA_BASE_URL) {
        return res.status(500).json({
            success: false,
            error: 'WhatsApp service not configured. Set WAHA_API_URL in environment variables.',
        });
    }

    const baseUrl = WAHA_BASE_URL.replace(/\/+$/, '');
    const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
    const WAHA_SESSION = process.env.WAHA_SESSION || 'default';
    const config = { baseUrl, apiKey: WAHA_API_KEY, session: WAHA_SESSION };

    const { meetingId, userPhone, coordinatorPhone } = req.body || {};

    if (!meetingId) {
        return res.status(400).json({
            success: false,
            error: 'Missing meetingId',
        });
    }

    let meeting;
    try {
        const result = await getMeeting({ _authenticatedUser: session.user.username, meetingId });
        meeting = result.meeting;
    } catch (err) {
        return res.status(404).json({
            success: false,
            error: 'Meeting not found',
        });
    }

    const username = session.user.username;

    let userChatId = null;
    let coordChatId = null;
    const resolveErrors = [];

    try {
        userChatId = await resolveChatId(userPhone, config);
    } catch (err) {
        resolveErrors.push(`User (${userPhone}): ${err.message}`);
    }

    try {
        coordChatId = await resolveChatId(coordinatorPhone, config);
    } catch (err) {
        resolveErrors.push(`Coordinator (${coordinatorPhone}): ${err.message}`);
    }

    if (!userChatId && !coordChatId) {
        return res.status(400).json({
            success: false,
            error: resolveErrors.join(' | ') || 'No valid WhatsApp phone number provided',
        });
    }

    const results = { user: null, coordinator: null };
    const errors = [...resolveErrors];

    if (userChatId) {
        try {
            await sendMessage(userChatId, buildUserMessage(meeting, username), config);
            results.user = 'sent';
        } catch (err) {
            results.user = 'failed';
            errors.push(`User (${userPhone}): ${err.message}`);
        }
    } else {
        results.user = 'skipped';
    }

    if (coordChatId) {
        try {
            await sendMessage(coordChatId, buildCoordinatorMessage(meeting, username), config);
            results.coordinator = 'sent';
        } catch (err) {
            results.coordinator = 'failed';
            errors.push(`Coordinator (${coordinatorPhone}): ${err.message}`);
        }
    } else {
        results.coordinator = 'skipped';
    }

    if (results.user !== 'sent' && results.coordinator !== 'sent') {
        return res.status(500).json({
            success: false,
            error: errors.join(' | '),
            results,
        });
    }

    return res.status(200).json({
        success: true,
        results,
        errors,
    });
}
