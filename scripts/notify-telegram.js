const admin = require('firebase-admin');
const fetch = require('node-fetch');

const STATE_DOC = 'appdata/telegram-notify-state'; // remembers what's already been reported

async function main() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const state = await getState(db);
  const nowMs = Date.now();

  const lines = [];

  // ---- 1. Pending reviews right now ----
  const pendingSnap = await db.collection('perf_submissions_docs').where('status', '==', 'pending').get();
  const pendingCount = pendingSnap.size;
  if (pendingCount > 0) {
    lines.push(`📋 *${pendingCount}* submission${pendingCount === 1 ? '' : 's'} waiting for review`);
  }

  // ---- 2. New fails since last run ----
  const failsDoc = await db.collection('appdata').doc('perf-fails').get();
  const allFails = (failsDoc.exists ? failsDoc.data().value : []) || [];
  const newFails = allFails.filter(f => f.failedAt && new Date(f.failedAt).getTime() > state.lastRunMs);
  if (newFails.length > 0) {
    const workersDoc = await db.collection('appdata').doc('perf-workers').get();
    const workers = (workersDoc.exists ? workersDoc.data().value : []) || [];
    const nameById = {};
    workers.forEach(w => { nameById[w.id] = w.name; });
    newFails.forEach(f => {
      const name = nameById[f.workerId] || 'Someone';
      lines.push(`⚠️ *${name}* missed: ${f.title || 'a task'}`);
    });
  }

  // ---- 3. Challenger tasks expiring within the hour, still not submitted ----
  const targetsDoc = await db.collection('appdata').doc('perf-targets').get();
  const targets = (targetsDoc.exists ? targetsDoc.data().value : []) || [];
  const soonExpiring = targets.filter(t =>
    t.status === 'active' && t.sideQuestId && t.expiresAt &&
    new Date(t.expiresAt).getTime() > nowMs &&
    new Date(t.expiresAt).getTime() < nowMs + 60 * 60 * 1000
  );
  if (soonExpiring.length > 0) {
    lines.push(`⏱ *${soonExpiring.length}* challenger task${soonExpiring.length === 1 ? '' : 's'} expiring within the hour`);
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

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown',
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Telegram send failed (${res.status}): ${errText}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
