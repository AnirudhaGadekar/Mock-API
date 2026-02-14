# 💸 Zero Cost Deployment Guide (100% Free)

This guide allows you to deploy MockUrl for **$0/month** using permanent free tiers.
**You do NOT need your custom domain yet.** You can use the free subdomains provided by these services (e.g., `api.onrender.com`, `vercel.app`) until you get your student pack domain.

## 📋 Prerequisites & Account Creation
Before we start, you must create accounts on these 4 services. You can usually just "Sign up with GitHub" for all of them.

1.  **GitHub** (You already have this)
    *   *Role*: Hosts your code.
2.  **Supabase** ([supabase.com](https://supabase.com))
    *   *Role*: Free PostgreSQL Database.
    *   *Action*: Sign up -> Create a new Organization -> Create a new Project.
    *   *Save*: The `Connection String` (URI) and `Database Password`.
3.  **Upstash** ([upstash.com](https://upstash.com))
    *   *Role*: Free Redis (Cache).
    *   *Action*: Sign up -> Create Database -> Select "Redis" -> Name it "mockurl-cache".
    *   *Save*: The `UPSTASH_REDIS_REST_URL` (endpoint) equivalent. Actually, for this app, we need the standard **TCP URL** (e.g., `redis://default:password@...`).
4.  **Render** ([render.com](https://render.com))
    *   *Role*: Hosts the Backend (Node.js).
    *   *Action*: Sign up with GitHub.
5.  **Vercel** ([vercel.com](https://vercel.com))
    *   *Role*: Hosts the Frontend (React).
    *   *Action*: Sign up with GitHub.

---

## 🚀 Step 1: Database Setup (Supabase)
1.  Go to your Supabase Project -> **Project Settings** -> **Database**.
2.  Under "Connection String", select **Node.js**.
3.  Copy the Mode: **Transaction Mode (Pooler)** connection string (port 6543).
    *   *Reason*: Serverless/Cloud environments work better with the connection pooler.
    *   It looks like: `postgres://postgres.xxxx:password@aws-0-region.pooler.supabase.com:6543/postgres`
    *   **Keep this safe.** You will need to replace `[YOUR-PASSWORD]` with the password you set during creation.

## 🚀 Step 2: Redis Setup (Upstash)
1.  Go to your Upstash Console -> Click on your Redis database.
2.  Scroll to "Connect to your database" -> Select **"Node.js (ioredis)"**.
3.  Copy the URL.
    *   It looks like: `rediss://default:xxxxx@fly-region.upstash.io:6379`
    *   **Keep this safe.**

---

## 🚀 Step 3: Deploy Backend (Render)
1.  Go to **Render Dashboard** -> **New +** -> **Web Service**.
2.  Connect your **GitHub Repository** (`Mock_Url`).
3.  **Configuration**:
    *   **Name**: `mockurl-api`
    *   **Region**: Choose one close to you (e.g., Singapore or Oregon).
    *   **Branch**: `main` (or master).
    *   **Root Directory**: Leave empty (defaults to `/`).
    *   **Runtime**: **Node**
    *   **Build Command**: `npm install && npx prisma generate && npm run build`
    *   **Start Command**: `npm run prisma:deploy && npm start`
    *   **Instance Type**: **Free**
4.  **Environment Variables** (Click "Advanced" or "Environment"):
    Add these key-value pairs:
    *   `NODE_ENV`: `production`
    *   `PORT`: `10000` (Render default).
    *   `DATABASE_URL`: *Paste your Supabase connection string from Step 1.*
    *   `DIRECT_DATABASE_URL`: *Paste the SAME string, but change port `6543` to `5432` (Session mode) if utilizing migrations, OR just use the same one for now.*
        *   *Correction*: For `prisma migrate` (which runs in `npm run prisma:deploy`), you usually need the Session mode (port 5432). Use the **Session** connection string here.
    *   `REDIS_HOST`: The host part of your Upstash URL (e.g., `fly-region.upstash.io`).
    *   `REDIS_PORT`: `6379`
    *   `REDIS_PASSWORD`: The password part from your Upstash URL (the long string after `default:` and before `@`).
        *   *Alternative*: If your app uses a `REDIS_URL` single variable, just paste the whole `rediss://...` string. (Based on your code, check `.env.example`).
    *   `JWT_SECRET`: Generate a random long string.
    *   `ADMIN_SECRET`: Generate a random password for the admin dashboard.
    *   `CORS_ORIGIN`: `*` (Allow all for now to avoid issues, or wait until Step 4 to get your Vercel URL).
5.  Click **Create Web Service**.
    *   *Wait*: It will take a few minutes.
    *   *Success*: Once deployed, copy the **onrender.com URL** (top left, e.g., `https://mockurl-api.onrender.com`).

---

## 🚀 Step 4: Deploy Frontend (Vercel)
1.  Go to **Vercel Dashboard** -> **Add New...** -> **Project**.
2.  Import your **GitHub Repository** (`Mock_Url`).
3.  **Project Name**: `mockurl-frontend`
4.  **Framework Preset**: **Vite**
5.  **Root Directory**: Click "Edit" and select `frontend`. **(Crucial Step!)**
6.  **Environment Variables**:
    *   `VITE_API_URL`: Paste your Render Backend URL from Step 3 (e.g., `https://mockurl-api.onrender.com`).
        *   *Note: No trailing slash.*
7.  Click **Deploy**.
    *   *Wait*: It takes ~1 minute.
    *   *Success*: You will get a `xxxxx.vercel.app` domain.

---

## 🎉 Done!
*   **Frontend URL**: `https://your-project.vercel.app` (Send this to your friend!)
*   **Backend URL**: `https://mockurl-api.onrender.com`
*   **Admin Dashboard**: `https://your-project.vercel.app/admin.html` (Use the `ADMIN_SECRET` you set in Step 3).

### ⚠️ Important Limitations of Free Tier
1.  **Render Cold Starts**: If no one visits the API for 15 minutes, it goes to sleep. The next person to visit will wait **~1 minute** for the page to load. Tell your friend to be patient on the first try!
2.  **Supabase Pausing**: If you don't use the DB for a few days, Supabase might pause it. You just need to log in to Supabase dashboard to "Restore" it.
3.  **Usage Limits**: For testing with a friend, you will never hit the limits.
