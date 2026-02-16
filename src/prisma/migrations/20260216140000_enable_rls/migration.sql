-- Enable Row Level Security on all tables to satisfy Supabase security linter
-- This effectively blocks public access via PostgREST unless policies are added
-- The Node.js backend (Prisma) connects as "postgres" or service_role, bypassing RLS.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "endpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "request_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_invitations" ENABLE ROW LEVEL SECURITY;
