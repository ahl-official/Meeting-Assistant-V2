import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();

    const session = await getServerSession(req, res, authOptions);
    if (!session) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { id } = req.query;
    const apiKey = process.env.ASSEMBLYAI_API_KEY;

    if (!apiKey) return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not set' });
    if (!id) return res.status(400).json({ error: 'Missing transcript ID' });

    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers: { Authorization: apiKey },
    });

    const data = await pollRes.json().catch(() => ({}));

    if (!pollRes.ok) {
        return res.status(pollRes.status).json({
            error: data.error || data.message || `AssemblyAI status error ${pollRes.status}`,
        });
    }

    res.json({
        status: data.status,
        text: data.text || '',
        transcript: data.text || '',
        utterances: data.utterances || [],
        words: data.words || [],
        error: data.error || null,
    });
}
