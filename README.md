# DropVault 🔐

Secure profile management dashboard for drop botters. Profiles, invoices, profit tracking, expenses, analytics and leaderboard — all in one place.

---

## ⚡ Quick Setup (15 minutes)

### Step 1 — Install Node.js
Download and install Node.js from https://nodejs.org (use the LTS version).

### Step 2 — Extract & install dependencies
```bash
# Unzip the project folder, then open a terminal inside it
npm install
```

### Step 3 — Set your encryption key
Open `.env` and change `VITE_ENCRYPTION_KEY` to any random 32-character string.
**This key encrypts all card data. Write it down and never lose it.**

Example:
```
VITE_ENCRYPTION_KEY=xK9#mP2$vL8nQ5wR1jY4tB7cD6hF3aE0
```

### Step 4 — Run the Supabase schema
1. Go to https://supabase.com and open your project
2. Click **SQL Editor** in the left sidebar
3. Paste the entire contents of `schema.sql`
4. Click **Run**

### Step 5 — Make yourself admin
Still in the SQL Editor, run this (replace with your email):
```sql
UPDATE public.user_profiles 
SET role = 'admin' 
WHERE id = (SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL_HERE');
```

### Step 6 — Start the app
```bash
npm run dev
```

Open http://localhost:5173 in your browser.

### Step 7 — Create your account
1. Go to **Join** tab on the login page
2. You need an invite code — but as the first user/admin, generate one first:
   - Go to your Supabase project → SQL Editor and run:
   ```sql
   INSERT INTO public.invite_codes (code, used, expires_at)
   VALUES ('ADMIN-BOOT', false, NOW() + INTERVAL '1 day');
   ```
3. Use code `ADMIN-BOOT` to sign up
4. Check your email and confirm your account
5. Log back in

---

## 🚀 Deploy to Vercel (free hosting)

1. Push your code to GitHub (make a private repo)
2. Go to https://vercel.com → Import project
3. Add environment variables in Vercel dashboard:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_ENCRYPTION_KEY` (same key you set locally)
4. Deploy — done!

---

## 🔐 Security Notes

- **Card data** is encrypted with AES-256-GCM before being stored. The database only contains encrypted blobs — unreadable without your encryption key.
- **Row Level Security** is enabled on all tables — users can only read their own data at the database level, not just in the UI.
- **Invite codes** are single-use and expiring — you control who gets access.
- **Never share** your `VITE_ENCRYPTION_KEY` or Supabase service role key.
- The `.env` file is in `.gitignore` — it will never be committed to git.

---

## 📋 Features

| Feature | Description |
|---|---|
| **Profiles** | Create, edit, delete profiles matching your CSV template. Import/export CSV. Full card details viewable. Encrypted at rest. |
| **Invoices** | Log invoices, mark as paid/pending/overdue. Track outstanding balance. |
| **Profit Tracker** | Log items bought and sold. Track P&L per item and by platform (ACO, StockX, etc.) |
| **Expenses** | Track bot costs, proxies, fees. Recurring expense support. Pie chart breakdown. |
| **Leaderboard** | Monthly checkout rankings. Anonymous mode available. |
| **Admin Panel** | View all users, view/export any user's profiles, generate invite codes. |

---

## 🛠 Tech Stack

- **React + Vite** — Frontend
- **Tailwind CSS** — Styling
- **Supabase** — Database, Auth, Row Level Security
- **Web Crypto API** — AES-256-GCM encryption (built into the browser, no external dependency)
- **Recharts** — Charts
- **PapaParse** — CSV import/export

---

## ❓ Troubleshooting

**"Invalid invite code"** — Make sure the code is unused and not expired. Check in Supabase → Table Editor → invite_codes.

**Decryption errors after changing encryption key** — All existing profiles were encrypted with the old key. Don't change the encryption key after you've stored data.

**Can't log in after signup** — Check your email for a confirmation link from Supabase.

**Admin panel not showing** — Make sure you ran the UPDATE query in Step 5 after signing up (not before).
