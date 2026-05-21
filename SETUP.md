# Setup Guide — Challan System

A complete walkthrough for taking the app from these files to a live URL anyone in your company can use.

**Total time:** ~30 minutes. No coding required; just clicking and copy-paste.

---

## What you have

Four files:

- `schema.sql` — creates database tables
- `seed.sql` — populates initial data (companies, distributors, retailers, placeholder products)
- `index.html` + `app.js` + `config.js` — the web app
- `SETUP.md` — this guide

## What we'll do

1. **Supabase** — create a free Postgres database, paste in the schema, add your team as users
2. **Connect the app** to Supabase by filling in two values in `config.js`
3. **Vercel** — deploy the app to a live URL like `asn-challan.vercel.app`
4. **First login + sanity check**

---

## Step 1 — Supabase (database + auth)

### 1.1 Create a project

1. Go to [supabase.com](https://supabase.com) and sign up (free, use Google/GitHub login if you prefer)
2. Click **New project**
3. Pick a name like `asn-challan`, set a strong database password (save it — you may need it later), pick the region closest to you (Mumbai/Singapore for India), click **Create new project**
4. Wait ~2 minutes for the project to spin up

### 1.2 Run the schema

1. In your Supabase dashboard, click **SQL Editor** in the left sidebar
2. Click **New query**
3. Open `schema.sql` from your computer, copy everything, paste it in
4. Click **Run** (or Cmd/Ctrl + Enter)
5. You should see "Success. No rows returned" — that means all tables were created

### 1.3 Seed initial data

1. In the same SQL Editor, click **New query** again
2. Open `seed.sql`, copy everything, paste it in
3. Click **Run**
4. Verify by running this in another new query:
   ```sql
   select code, name, next_dc_number from companies;
   ```
   You should see 2 rows: ASN and ASE.

### 1.4 Get your API credentials

1. In Supabase, click **Project Settings** (gear icon, bottom-left) → **API**
2. Copy two things:
   - **Project URL** (looks like `https://abcdefghijk.supabase.co`)
   - **anon public** key (a long string starting with `eyJ...`)
3. Paste them into `config.js`:
   ```javascript
   window.SUPABASE_URL  = 'https://abcdefghijk.supabase.co';
   window.SUPABASE_ANON = 'eyJ...your-long-key...';
   ```
4. Save `config.js`

> The anon key is meant to be public — it's safe to commit to GitHub. Row-Level Security (which we set up in the schema) prevents unauthorized access.

### 1.5 Add your team as users

For each person who'll use the app:

1. In Supabase, go to **Authentication** → **Users**
2. Click **Add user** → **Create new user**
3. Enter their email and a temporary password
4. Uncheck "Auto Confirm User" if you want them to verify via email; check it if you want them to log in immediately
5. Send them the email + password — they can log in right away

> Want to disable signups so only invited users can join? Go to **Authentication → Providers → Email** and turn off "Enable Signups". Then the only way to get in is for you to add users manually.

---

## Step 2 — Test locally (optional but recommended)

Before deploying to Vercel, make sure it works on your machine:

1. Put `index.html`, `app.js`, `config.js` in the same folder
2. Open `index.html` in any modern browser (Chrome/Edge/Safari/Firefox)
3. Log in with one of the users you just created
4. Verify: you see the 2 companies, 5 distributors, 26 retailers, 4 placeholder products

If something fails, open the browser console (Cmd/Ctrl + Shift + I) and check for errors — most issues are typos in `config.js`.

---

## Step 3 — Deploy to Vercel

### 3.1 Sign up

1. Go to [vercel.com](https://vercel.com), sign up (free Hobby plan is plenty)
2. Sign in with GitHub if you have an account; otherwise use email

### 3.2 Deploy without GitHub (easiest)

If you don't want to deal with GitHub:

1. Install the Vercel CLI: open a terminal and run
   ```
   npm install -g vercel
   ```
2. Navigate to the folder with your 3 files (`index.html`, `app.js`, `config.js`)
3. Run: `vercel`
4. Follow the prompts — confirm the project name, accept the defaults
5. After ~30 seconds you'll get a URL like `https://asn-challan-xyz.vercel.app`

### 3.3 Deploy via GitHub (recommended for updates)

1. Create a new GitHub repo (private is fine)
2. Upload `index.html`, `app.js`, `config.js` (and optionally `schema.sql`, `seed.sql`, `SETUP.md` for documentation)
3. In Vercel, click **Add New → Project**, connect your GitHub repo
4. Click **Deploy** — Vercel auto-detects it's a static site, no configuration needed
5. You'll get a URL like `https://asn-challan.vercel.app`

> **Updating later:** push changes to GitHub → Vercel auto-redeploys. Or run `vercel --prod` again.

### 3.4 (Optional) Custom domain

If you own a domain like `challans.yourcompany.com`:

1. In Vercel, click your project → **Settings → Domains**
2. Add your domain, follow the DNS instructions
3. Done — your team can bookmark the custom URL

---

## Step 4 — First real use

1. Open your Vercel URL
2. Log in as yourself
3. Go to **Master Data** tab
4. **Edit the placeholder products** — replace with your real product lineup for each company
5. **Add real lots** — for each product, click "+ Add Lot" and enter the actual lot numbers and bag counts
6. **Verify company settings** — go to Company Settings, edit each company, make sure GSTIN/CIN/addresses/next DC # are correct
7. (Optional) **Upload logos** — Master Data → Company Settings → Edit → option 9. Paste a base64 image data URL. Use a free tool like [base64-image.de](https://www.base64-image.de) to convert your logo file.
8. Now go to **New Batch** and generate a test DC end-to-end

---

## Common questions

**"How do I add new distributors/retailers/products?"**
Master Data tab → corresponding "+ Add" button. All staff with login access can do this.

**"How do I prevent staff from editing master data?"**
For v1 everyone has full access. If you want a stricter admin/operator split later, ask and I'll add Postgres row-level-security policies based on user roles.

**"What if I want to change a saved DC?"**
For now, you can view past DCs in the Register tab but not edit them — this is by design (DCs are legal documents). If you need to fix one, generate a new one and add a note. If you need true edit-after-save, ask.

**"What if I want to undo a DC and put bags back into stock?"**
Right now there's no automated rollback. If needed, manually adjust the lot's available bags via Master Data → Lot Inventory → Edit → option 1 ("adjust available bags").

**"What about backups?"**
Supabase auto-backs up daily on free tier. You can also export the whole DB anytime: Project Settings → Database → Backups.

**"Free tier limits — when will I hit them?"**
Supabase free: 500 MB storage, 50K monthly active users. For ~26 retailers and a few hundred DCs/month you won't get close. Vercel free: 100 GB bandwidth/month. Same — plenty.

---

## Troubleshooting

**Login fails with "Invalid login credentials"**
→ The user doesn't exist yet, or the password is wrong. Add them in Supabase → Authentication → Users.

**App shows "Config missing" error on first load**
→ You haven't edited `config.js` with your Supabase URL and key. Open it, fill in the values, redeploy (or refresh locally).

**"Database error: relation 'companies' does not exist"**
→ You haven't run `schema.sql` yet. Go to Supabase SQL Editor and run it.

**"Insufficient stock: lot has X bags, requested Y"**
→ Working as designed. The DC won't save because you'd be over-shipping. Either reduce the bags, pick a different lot, or update the lot's available bags in Master Data.

**Saved a DC but it doesn't appear in Register**
→ Refresh the page. If still missing, check the browser console for errors and tell me.

---

Built with care. If anything breaks or feels awkward, send a screenshot or the error message and we'll fix it.
