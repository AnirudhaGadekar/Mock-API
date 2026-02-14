# 🔐 Render Environment Variables (Copy & Paste)

Go to your **Render Dashboard** -> **Mock-Url Service** -> **Environment** tab.
Click **"Add Environment Variable"** for each line below.

## 1. Database (Supabase)
> **Note**: I have URL-encoded your password (`Anirudha@7546@SUPABASE` -> `Anirudha%407546%40SUPABASE`) so the `@` symbols don't break the connection string.

| Key | Value |
| :--- | :--- |
| `DATABASE_URL` | `postgresql://postgres.exvziohtjistpqtreoia:Anirudha%407546%40SUPABASE@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true` |
| `DIRECT_DATABASE_URL` | `postgresql://postgres.exvziohtjistpqtreoia:Anirudha%407546%40SUPABASE@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres` |

## 2. Redis (Upstash)
| Key | Value |
| :--- | :--- |
| `REDIS_HOST` | `ready-snake-56669.upstash.io` |
| `REDIS_PORT` | `6379` |
| `REDIS_PASSWORD` | `Ad1dAAIncDI4YTMzMjZjNjYzODg0MGQwYjJjNzYyNDBkMmJmY2Y3NnAyNTY2Njk` |

## 3. App Secrets (Generate these!)
| Key | Value |
| :--- | :--- |
| `JWT_SECRET` | `generate-a-long-random-string-here-at-least-32-chars` |
| `ADMIN_SECRET` | `my-secure-admin-password` |
| `NODE_ENV` | `production` |
| `PORT` | `10000` |

---

# 🛠️ Vercel Fix (Already Applied)
I fixed the `src/pages/Chaos.tsx` error ("loading is never read") which was causing your **Vercel** build to fail.
You just need to:
1.  **Commit & Push** the changes to GitHub.
2.  Vercel will automatically redeploy.

## Vercel Environment Variables
Don't forget to add this in Vercel -> Settings -> Environment Variables:
| Key | Value |
| :--- | :--- |
| `VITE_API_URL` | `https://mock-url-9rwn.onrender.com` |
