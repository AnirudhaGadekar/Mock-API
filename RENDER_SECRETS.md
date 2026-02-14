# �️ Ultimate Supabase to Render Guide

Follow these steps exactly to fix the `P1001` Database Error.

## Part A: Get the Correct Strings from Supabase
> [!NOTE]
> **Why we use Prisma instead of `db.js`**:
> Your project is built using **Prisma** (see `src/lib/db.ts`). This is better than the simple `db.js` suggested by Supabase because it handles your data structure automatically. The strings below are specifically formatted to make Prisma work on Render.

1.  **Open Supabase Dashboard** and click on your project (**Mock-Url**).
2.  On the left sidebar, click the **Settings icon** (⚙️) at the very bottom.
3.  Click on **Database**.
4.  Scroll down to the **"Connection Pooler"** section.
    *   **Check**: Is it enabled? If not, turn it **ON**.
    *   **Mode**: Ensure it is set to **Transaction**.
5.  Look for the **"Connection string"** box in this section.
    *   Select the **URI** tab.
    *   It should look like this: `postgresql://postgres.exvziohtjistpqtreoia:[YOUR-PASSWORD]@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres`

---

## Part B: The Variables for Render
You need to add **TWO** variables to Render. I have pre-filled them for you with your password (`Anirudha@7546@SUPABASE`) already fixed for the URL.

### 1. `DATABASE_URL` (The "Pooler" URL)
*   **Where to find in Supabase**: The "Connection Pooler" section (Step 4 above).
*   **Port**: `6543`
*   **Paste this into Render**:
    `postgresql://postgres.exvziohtjistpqtreoia:Anirudha%407546%40SUPABASE@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require`

### 2. `DIRECT_DATABASE_URL` (The "Direct" URL)
*   **Where to find in Supabase**: Scroll **UP** on that same page to the "Connection Info" section.
*   **Port**: `5432`
*   **Paste this into Render**:
    `postgresql://postgres.exvziohtjistpqtreoia:Anirudha%407546%40SUPABASE@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require`

---

## Part C: Applying to Render
1.  Open **Render Dashboard** -> Click your **Mock-Url** service.
2.  Click **Environment** on the left.
3.  Find the `DATABASE_URL` row (or add it if missing).
4.  Find the `DIRECT_DATABASE_URL` row (or add it if missing).
5.  **Important**: Make sure there are no spaces at the start or end of the URLs.
6.  Click **Save Changes**.

Render will now redeploy. Since I fixed the code errors earlier, this should be the final step!

---

## Part D: Other Required Variables
If you haven't added these yet, make sure they are in Render too:

### 2. Redis (Upstash)
| Key | Value |
| :--- | :--- |
| `REDIS_HOST` | `ready-snake-56669.upstash.io` |
| `REDIS_PORT` | `6379` |
| `REDIS_PASSWORD` | `Ad1dAAIncDI4YTMzMjZjNjYzODg0MGQwYjJjNzYyNDBkMmJmY2Y3NnAyNTY2Njk` |

### 3. App Secrets
| Key | Value |
| :--- | :--- |
| `JWT_SECRET` | `generate-a-long-random-string-at-least-32-chars` |
| `ADMIN_SECRET` | `my-secure-admin-password123` |
| `NODE_ENV` | `production` |
| `PORT` | `10000` |
| `HOST` | `0.0.0.0` |
| `JWT_EXPIRES_IN` | `7d` |
| `CORS_ORIGIN` | `*` |

