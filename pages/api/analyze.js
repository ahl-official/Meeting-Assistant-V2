// ============================================================
// pages/api/analyze.js — Next.js serverless route
// Pipeline: transcript → chunk → summarize chunks → merge → structured JSON
//
// Chunking strategy:
//   1. Split transcript into ~3000-char chunks with ~300-char overlap
//   2. Extract action points from each chunk (parallel, batches of 3)
//   3. Summarize each chunk into a mini-summary (parallel, batches of 3)
//   4. Merge mini-summaries into final summary + decisions + nextSteps
//   5. Generate tasks from merged summary + action points
//
// This ensures NO content is dropped from long transcripts.
// ============================================================

import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';

const LLM_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite';

// ── Vercel timeout ──────────────────────────────────────────
// Hobby: max 60s, Pro: max 300s. Set to your plan's max.
export const maxDuration = 60;

// ── Helpers ─────────────────────────────────────────────────

/**
 * Single place to call OpenRouter. Retries once on 429/5xx.
 */
async function callLLM(apiKey, prompt, { temperature = 0.1, max_tokens = 2000 } = {}) {
  const body = {
    model: LLM_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature,
    max_tokens,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (resp.status === 429 || resp.status >= 500) {
      // Wait 2s then retry once
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
    }

    if (!resp.ok) {
      throw new Error(`OpenRouter ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
  }
}

/**
 * Robustly extract JSON from model output.
 * Handles: thinking blocks, markdown fences, leading/trailing text, truncation.
 */
function extractJSON(raw) {
  if (!raw) throw new Error('Empty response from model');

  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

  try { return JSON.parse(cleaned); } catch {}

  // Try array match first (for task lists), then object match
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch {}
  }

  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}

    // Salvage truncated JSON by closing open braces/brackets
    let partial = objMatch[0];
    let braces = 0, brackets = 0;
    for (const ch of partial) {
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '[') brackets++;
      else if (ch === ']') brackets--;
    }
    partial = partial.replace(/,\s*"[^"]*$/, '').replace(/,\s*$/, '');
    partial += ']'.repeat(Math.max(0, brackets));
    partial += '}'.repeat(Math.max(0, braces));
    try { return JSON.parse(partial); } catch {}
  }

  throw new Error('No valid JSON found in model response. Raw: ' + raw.slice(0, 300));
}

// ── Chunking ────────────────────────────────────────────────

/**
 * Split transcript into overlapping chunks at sentence boundaries.
 *
 * @param {string} text       Full transcript
 * @param {number} chunkSize  Target chars per chunk (default 3000)
 * @param {number} overlap    Overlap chars between chunks (default 300)
 * @returns {string[]}        Array of chunk strings
 *
 * Why overlap? Action points or context that falls right at a boundary
 * would be cut in half without it. 300 chars ≈ 2–3 sentences of context
 * carried into the next chunk, so the LLM can understand what was being
 * discussed when the chunk begins.
 */
function chunkTranscript(text, chunkSize = 3000, overlap = 300) {
  if (text.length <= chunkSize) return [text];

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // Try to break at a sentence boundary
    if (end < text.length) {
      const boundary = text.lastIndexOf('. ', end);
      if (boundary > start + chunkSize * 0.4) {
        end = boundary + 2;
      }
    }

    chunks.push(text.slice(start, end).trim());

    // Advance start, stepping back by overlap for context continuity
    const nextStart = end - overlap;

    // Safety: always advance by at least 1 char to prevent infinite loop
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

// ── Prompts ─────────────────────────────────────────────────

function actionPointPrompt(chunk, i, total) {
  return `You are extracting action items from part ${i + 1} of ${total} of a meeting transcript.

TRANSCRIPT SEGMENT:
${chunk}

Return ONLY a JSON array of action items found in this segment. Each item:
{
  "task": "specific task description",
  "owner": "person name or 'Unassigned'",
  "dueDate": "date mentioned or 'Not specified'",
  "priority": "high" | "medium" | "low"
}

If no action items in this segment, return [].
Return ONLY the JSON array. No explanation, no markdown.`;
}

function chunkSummaryPrompt(chunk, i, total) {
  return `You are summarizing part ${i + 1} of ${total} of a meeting transcript.

TRANSCRIPT SEGMENT:
${chunk}

Return ONLY JSON, no markdown:
{
  "summary": "2-3 sentence summary of what was discussed in THIS segment",
  "decisions": ["any decisions made in this segment"],
  "keyTopics": ["main topics covered"]
}`;
}

function mergeSummariesPrompt(chunkSummaries) {
  const numbered = chunkSummaries
    .map((s, i) => `Segment ${i + 1}:\n  Summary: ${s.summary}\n  Decisions: ${(s.decisions || []).join('; ') || 'none'}\n  Topics: ${(s.keyTopics || []).join(', ')}`)
    .join('\n\n');

  return `You are merging segment summaries of a meeting into one cohesive overview.

SEGMENT SUMMARIES:
${numbered}

Return ONLY JSON, no markdown:
{
  "summary": "2-4 sentence cohesive overview of the ENTIRE meeting — what was discussed, key outcomes, and overall direction",
  "decisions": ["all decisions across the meeting, deduplicated"],
  "nextSteps": "1-2 sentence description of immediate next steps agreed upon"
}`;
}

function tasksPrompt(mergedSummary, actionPoints) {
  const apsText = actionPoints.length
    ? actionPoints.map((ap, i) =>
        `${i + 1}. [${(ap.priority || 'medium').toUpperCase()}] ${ap.task || ''}` +
        ` (Owner: ${ap.owner || 'Unassigned'}, Due: ${ap.dueDate || 'TBD'})`
      ).join('\n')
    : '(none extracted)';

  return `You are a senior project manager creating tasks from a meeting.

MEETING SUMMARY:
${mergedSummary}

EXTRACTED ACTION POINTS:
${apsText}

RULES:
1. Each task is a STANDALONE, self-contained unit of work.
2. Be PRECISE: capture who, what, expected output, and any constraints.
3. Use "details" for acceptance criteria, context, or dependencies.
4. Merge related action points into ONE task when they form a single workstream.
5. Create tasks implied by the summary even if no explicit action point exists.
6. Do NOT copy-paste — synthesise and distil.
7. Priority must be one of: "critical" | "high" | "medium" | "low"

Return ONLY a JSON array. Each element:
{
  "title": "Imperative verb headline, max 12 words",
  "priority": "high",
  "owner": "Person name or 'Unassigned'",
  "dueDate": "Specific date or 'Not specified'",
  "details": ["acceptance criteria or deliverable", "dependency or deadline"],
  "sourceActionPoints": [0, 2]
}

If no actionable work, return [].
Return ONLY the JSON array. No markdown, no explanation.`;
}

// ── Deduplication ───────────────────────────────────────────

/**
 * Dedup action points by normalised (owner + task) key.
 * Strips filler words and compares on content words only,
 * which catches near-duplicates from overlapping chunks.
 */
function deduplicateActionPoints(actionPoints) {
  const seen = new Set();
  const stopWords = new Set(['the', 'a', 'an', 'to', 'and', 'or', 'for', 'of', 'in', 'on', 'with', 'is', 'are', 'will', 'should', 'need', 'needs']);

  return actionPoints.filter(ap => {
    const words = ((ap.owner || '') + ' ' + (ap.task || ''))
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1 && !stopWords.has(w))
      .sort()
      .join(' ');

    // Use first 80 chars of the normalised key (after sorting, similar tasks collide)
    const key = words.slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Main handler ────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const { transcript } = req.body;
  if (!transcript?.trim()) return res.status(400).json({ error: 'No transcript' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'OPENROUTER_API_KEY not set' });
  }

  // ── 1. Chunk the transcript ───────────────────────────────
  const chunks = chunkTranscript(transcript, 3000, 300);
  const isShort = chunks.length === 1; // Short transcript, skip chunk-merge flow

  // ── 2. Short transcript: simple parallel (action points + summary) ──
  // ── 3. Long transcript: run AP extraction & chunk summaries simultaneously ──

  let deduped = [];
  let summary = '', decisions = [], nextSteps = '';

  try {
    if (isShort) {
      // Short path: 2 parallel calls — action points + summary
      const [apRaw, summaryRaw] = await Promise.all([
        callLLM(apiKey, actionPointPrompt(chunks[0], 0, 1)),
        callLLM(apiKey, `Summarize this meeting transcript. Return ONLY JSON, no markdown:
{
  "summary": "2-4 sentence overview of what was discussed and decided",
  "decisions": ["decision 1", "decision 2"],
  "nextSteps": "1-2 sentence description of immediate next steps"
}

TRANSCRIPT:
${transcript}`, { temperature: 0.2, max_tokens: 1000 }),
      ]);

      // Parse action points
      try {
        const aps = JSON.parse(apRaw.replace(/```json|```/g, '').trim());
        deduped = Array.isArray(aps) ? aps : [];
      } catch { deduped = []; }

      // Parse summary
      const parsed = extractJSON(summaryRaw);
      summary = parsed.summary || '';
      decisions = parsed.decisions || [];
      nextSteps = parsed.nextSteps || '';

    } else {
      // Long path: run AP extraction and chunk summaries AT THE SAME TIME
      // Both iterate over the same chunks but with different prompts.
      // This means a 5-chunk transcript does AP batch 1 + summary batch 1
      // concurrently, instead of all APs first then all summaries.

      async function extractAllActionPoints() {
        const all = [];
        for (let i = 0; i < chunks.length; i += 3) {
          const batch = chunks.slice(i, i + 3);
          const results = await Promise.all(
            batch.map(async (chunk, j) => {
              const raw = await callLLM(apiKey, actionPointPrompt(chunk, i + j, chunks.length));
              try {
                return JSON.parse(raw.replace(/```json|```/g, '').trim());
              } catch { return []; }
            })
          );
          all.push(...results.flat());
        }
        return all;
      }

      async function summarizeAllChunks() {
        const summaries = [];
        for (let i = 0; i < chunks.length; i += 3) {
          const batch = chunks.slice(i, i + 3);
          const results = await Promise.all(
            batch.map(async (chunk, j) => {
              const raw = await callLLM(apiKey, chunkSummaryPrompt(chunk, i + j, chunks.length), {
                temperature: 0.2, max_tokens: 800,
              });
              try { return extractJSON(raw); }
              catch { return { summary: '', decisions: [], keyTopics: [] }; }
            })
          );
          summaries.push(...results);
        }
        return summaries;
      }

      // Fire both pipelines simultaneously
      const [allActionPoints, chunkSummaries] = await Promise.all([
        extractAllActionPoints(),
        summarizeAllChunks(),
      ]);

      deduped = deduplicateActionPoints(allActionPoints);

      // Merge chunk summaries into final summary (1 call)
      const mergeRaw = await callLLM(apiKey, mergeSummariesPrompt(chunkSummaries), {
        temperature: 0.2, max_tokens: 1000,
      });
      const merged = extractJSON(mergeRaw);
      summary = merged.summary || '';
      decisions = merged.decisions || [];
      nextSteps = merged.nextSteps || '';
    }
  } catch (err) {
    if (!summary) summary = 'Analysis failed: ' + err.message;
    // If we have partial action points, keep them
    if (!deduped.length) {
      return res.status(500).json({ success: false, error: 'Analysis failed: ' + err.message });
    }
  }

  // ── 4. Generate tasks from merged summary + action points ──
  let tasks = [];

  try {
    // Feed the merged summary (which covers the FULL transcript) + deduped action points
    const summaryForTasks = summary + (decisions.length ? '\n\nDecisions: ' + decisions.join('; ') : '');
    const raw = await callLLM(apiKey, tasksPrompt(summaryForTasks, deduped), {
      temperature: 0.1,
      max_tokens: 3000,
    });

    const extracted = extractJSON(raw);
    tasks = Array.isArray(extracted) ? extracted : [];

    // Normalise each task to guarantee shape
    tasks = tasks.map(t => ({
      title:              t.title              || 'Untitled Task',
      priority:           t.priority           || 'medium',
      owner:              t.owner              || 'Unassigned',
      dueDate:            t.dueDate            || 'Not specified',
      details:            Array.isArray(t.details) ? t.details : [],
      sourceActionPoints: Array.isArray(t.sourceActionPoints) ? t.sourceActionPoints : [],
    }));
  } catch (err) {
    // Tasks are non-critical — return what we have
    console.error('[analyze] Task generation failed:', err.message);
  }

  // ── 5. Return ─────────────────────────────────────────────
  return res.json({
    success: true,
    result: {
      summary,
      actionPoints: deduped,
      tasks,
      decisions,
      nextSteps,
    },
  });
}