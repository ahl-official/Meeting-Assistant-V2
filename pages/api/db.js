import { getAction } from '../../lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';

const PUBLIC_ACTIONS = new Set(['login', 'register']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const action = String(req.query.action || '');
  if (!action) {
    return res.status(400).json({ success: false, error: 'Missing action' });
  }

  const fn = getAction(action);
  if (!fn) {
    return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
  }

  // Auth check for protected actions
  if (!PUBLIC_ACTIONS.has(action)) {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const ADMIN_ACTIONS = new Set(['getAllUsers', 'getAllMeetings', 'setAdmin', 'setActive']);
    if (ADMIN_ACTIONS.has(action) && !session.user.isAdmin) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    // Overwrite ALL client-supplied identity fields with verified session data
    // This prevents the client from choosing whose data to access
    req.body = req.body || {};
    req.body._authenticatedUser = session.user.username;
    req.body._authenticatedUserId = session.user.id;

    // Remove any client-supplied identity fields that db.js might trust
    delete req.body.username;
    delete req.body.adminUsername;

    if (ADMIN_ACTIONS.has(action)) {
      req.body._adminUsername = session.user.username;
    }
  }

  try {
    const result = await fn(req.body);
    return res.status(200).json(result);
  } catch (err) {
    console.error(`[db] ${action} failed:`, err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
}
