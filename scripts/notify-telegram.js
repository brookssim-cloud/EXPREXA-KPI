const admin = require('firebase-admin');
const fetch = require('node-fetch');

const STATE_DOC = 'appdata/telegram-notify-state'; // remembers what's already been reported

async function main() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const state = await getState(db);
  const nowMs = Date.now();

  // Shared lookups — fetched once, used by all four checks below
  const [workersDoc, targetsDoc, failsDoc] = await Promise.all([
    db.collection('appdata').doc('perf-workers').get(),
    db.collection('appdata').doc('perf-targets').get(),
    db.collection('appdata').doc('perf-fails').get(),
  ]);
  const workers = (workersDoc.exists ? workersDoc.data().value : []) || [];
  const targets = (targetsDoc.exists ? targetsDoc.data().value : []) || [];
  const allFails = (failsDoc.exists ? failsDoc.data().value : []) || [];
  const nameById = {};
  workers.forEach(w => { nameById[w.id] = w.name; });
  const targetById = {};
  targets.forEach(t => { targetById[t.id] = t; });

  const lines = [];

  // ---- 1. Pending reviews right now, itemized ----
  const pendingSnap = await db.collection('perf_submissions_docs').where('status', '==', 'pending').get();
  const pendingSubs = pendingSnap.docs.map(d => d.data());
  if (pendingSubs.length > 0) {
    lines.push(`📋 *Pending reviews (${pendingSubs.length})*`);
    pendingSubs.forEach(s => {
      const name = nameById[s.workerId] || 'Unknown worker';
      const target = targetById[s.targetId];
      const title = target ? target.title : (s.title || 'a task');
      lines.push(`   • ${name} — ${title}`);
    });
  }

  // ---- 2. Challenger tasks accepted since last run, itemized ----
  const newlyAccepted = targets.filter(t =>
    t.sideQuestId && t.acceptedAt && new Date(t.acceptedAt).getTime() > state.lastRunMs
  );
  if (newlyAccepted.length > 0) {
    lines.push(`🙋 *Challenger tasks accepted (${newlyAccepted.length})*`);
    newlyAccepted.forEach(t => {
      const name = nameById[t.workerId] || 'Someone';
      lines.push(`   • ${name} — ${t.title}`);
    });
  }

  // ---- 3. Challenger tasks expiring within the hour, itemized with time left ----
  const soonExpiring = targets.filter(t =>
    t.status === 'active' && t.sideQuestId && t.expiresAt &&
    new Date(t.expiresAt).getTime() > nowMs &&
    new Date(t.expiresAt).getTime() < nowMs + 60 * 60 * 1000
  );
  if (soonExpiring.length > 0) {
    lines.push(`⏱ *Expiring within the hour (${soonExpiring.length})*`);
    soonExpiring.forEach(t => {
      const name = nameById[t.workerId] || 'Unknown worker';
      const minsLeft = Math.max(0, Math.round((new Date(t.expiresAt).getTime() - nowMs) / 60000));
      lines.push(`   • ${name} — ${t.title} (${minsLeft} min left)`);
    });
  }

  // ---- 4. New fails since last run, itemized ----
  const newFails = allFails.filter(f => f.failedAt && new Date(f.failedAt).getTime() > state.lastRunMs);
  if (newFails.length > 0) {
    lines.push(`⚠️ *New fails (${newFails.length})*`);
    newFails.forEach(f => {
      const name = nameById[f.workerId] || 'Someone';
      lines.push(`   • ${name} — ${f.title || 'a task'}`);
    });
  }

  // ---- Send, only if there's something to say ----
  if (lines.length > 0) {
    const message = ['*Exprexa Performance update*', '', ...lines].join('\n');
    await sendTelegramMessage(message);
    console.log('Sent:\n' + message);
  } else {
    console.log('Nothing new to report — no message sent.');
  }

  await setState(db, { lastRunMs: nowMs });
}

async function getState(db) {
  const doc = await db.doc(STATE_DOC).get();
  if (doc.exists) return doc.data();
  return { lastRunMs: Date.now() - 24 * 60 * 60 * 1000 }; // first run: look back 24h
}
async function setState(db, state) {
  await db.doc(STATE_DOC).set(state);
}

// Telegram rejects any single message over 4096 characters. A long digest
// (e.g. a big backlog of pending reviews, each listed by name) can easily
// exceed that, so split it into chunks at line boundaries and send in
// sequence rather than losing the whole notification to a 400 error.
const TELEGRAM_MAX_CHARS = 3900; // headroom under the 4096 hard limit

function splitIntoChunks(text) {
  if (text.length <= TELEGRAM_MAX_CHARS) return [text];
  const lines = text.split('\n');
  const chunks = [];
  let current = '';
  for (const line of lines) {
    // A single line longer than the limit is rare, but hard-split it if so
    if (line.length > TELEGRAM_MAX_CHARS) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < line.length; i += TELEGRAM_MAX_CHARS) {
        chunks.push(line.slice(i, i + TELEGRAM_MAX_CHARS));
      }
      continue;
    }
    if ((current + '\n' + line).length > TELEGRAM_MAX_CHARS) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const chunks = splitIntoChunks(text);
  for (let i = 0; i < chunks.length; i++) {
    const body = chunks.length > 1
      ? `${chunks[i]}\n\n_(part ${i + 1} of ${chunks.length})_`
      : chunks[i];
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: body,
        parse_mode: 'Markdown',
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Telegram send failed (${res.status}): ${errText}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
