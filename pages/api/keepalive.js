// ============================================================
// pages/api/keepalive.js
// Triggered by Vercel Cron (see vercel.json) on a schedule.
// Does a trivial read against Supabase so the project registers
// as active and the free tier doesn't auto-pause it for inactivity.
// ============================================================

import { supabase } from '../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) throw new Error(error.message);
    return res.status(200).json({ success: true, pingedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
