import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';

export const maxDuration = 60;

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

function readRequestBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not set' });
  }

  try {
    const body = await readRequestBuffer(req);

    if (body.length > 200 * 1024 * 1024) {
      return res.status(413).json({ error: 'Payload Too Large (max 200MB)' });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5-minute timeout for large files

    const upstream = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/octet-stream',
      },
      body: body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await upstream.json();

    if (!upstream.ok || !data.upload_url) {
      return res.status(upstream.status).json({
        error: `AssemblyAI upload failed (${upstream.status})`,
      });
    }

    return res.status(200).json({ upload_url: data.upload_url });
  } catch (err) {
    const errorMsg = err.name === 'AbortError' ? 'Upload request timed out' : err.message;
    return res.status(500).json({ error: errorMsg || 'Upload proxy error' });
  }
}