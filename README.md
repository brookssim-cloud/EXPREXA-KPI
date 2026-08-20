# Telegram Notifications for Exprexa Performance — Setup Guide

This adds a scheduled check (every 30 minutes, roughly 6am–11pm Malaysia time)
that posts a short message to a Telegram chat whenever there's something
worth knowing — pending reviews, a worker missing a deadline, a challenger
task about to expire. If nothing's changed, it stays silent.

Unlike WhatsApp, this is **completely free with no per-message cost, no
business verification, and no message-template approval**. Setup takes a
few minutes, not hours.

## Step 1 — Create the bot (about 2 minutes)

1. Open Telegram, search for **@BotFather** (this is Telegram's own official
   bot for creating other bots — verified with a blue checkmark).
2. Send it the command `/newbot`.
3. Give it a name (e.g. "Exprexa Alerts") — this is just the display name.
4. Give it a username (must end in `bot`, e.g. `exprexa_alerts_bot`).
5. BotFather replies with a **token** — a long string like
   `123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`. This is your
   `TELEGRAM_BOT_TOKEN` — save it somewhere safe, it's effectively a
   password for the bot.

## Step 2 — Get your chat ID

You need to tell the bot where to send messages — either a group, or a
direct message to you personally.

**If using a group (recommended, so your team can see it too):**
1. Create a Telegram group (or use an existing one), add your new bot to it
   like you'd add any other member.
2. Send any message in the group.
3. In your browser, go to:
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   (replace `<YOUR_TOKEN>` with your actual token from Step 1)
4. Look through the response for `"chat":{"id":-123456789,...}` — that
   number (including the minus sign, if there is one) is your
   `TELEGRAM_CHAT_ID`.

**If just messaging yourself:**
1. Search for your bot's username in Telegram and send it any message
   directly (e.g. "hello").
2. Visit the same `getUpdates` URL as above and find your personal chat ID
   the same way.

## Step 3 — Get a Firebase service account key

- Firebase Console → your **performance-and-rewards** project → ⚙️ Project
  Settings → **Service Accounts** tab → **Generate new private key**.
- This downloads a JSON file. Keep it safe — it has full read/write access
  to your Firestore data.

## Step 4 — Add this to your GitHub repo

1. Copy the `scripts/` folder and `.github/workflows/telegram-notify.yml`
   from this package into the same GitHub repo where your
   `exprexa_performance.html` lives (or a new repo — either works).

2. In that repo, go to **Settings → Secrets and variables → Actions** and
   add three secrets:

   | Secret name | Value |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT_JSON` | The *entire contents* of the JSON file from Step 3, pasted as one block |
   | `TELEGRAM_BOT_TOKEN` | Your bot token from Step 1 |
   | `TELEGRAM_CHAT_ID` | Your group or personal chat ID from Step 2 |

3. Commit and push. The workflow runs automatically on its schedule from
   then on — no server to maintain, it's just a GitHub Action.

## Testing it before you wait for the schedule

Go to the **Actions** tab in your repo → **Telegram Notify — Exprexa
Performance** → **Run workflow** button. This triggers it immediately so you
can confirm the message actually arrives.

## Adjusting what it checks or how often

- **Frequency / active hours**: edit the `cron:` line in
  `.github/workflows/telegram-notify.yml`. It's in UTC — Malaysia is UTC+8.
- **What counts as notification-worthy**: edit `scripts/notify-telegram.js`
  — the three checks (pending reviews, new fails, expiring challenger tasks)
  are each their own clearly-marked section, so it's easy to add a fourth or
  remove one you don't care about.

## Cost

Zero. Telegram's Bot API has no pricing tier, no per-message charge, and no
verification requirement — it's free for any volume a small internal team
would ever generate. The only cost here at all is GitHub Actions minutes,
and this workflow's usage is far below the free monthly allowance.

## One trade-off worth knowing

Your team needs Telegram installed to see these — if everyone's used to
WhatsApp day-to-day, this means checking a second app for these specific
alerts. Worth weighing against the very real cost and friction of the
WhatsApp Business Platform route.
