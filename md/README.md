# MockUrl Backend

Scalable TypeScript/Fastify backend for MockUrl. MockUrl-style mock API with endpoints, request history, and admin tooling.

## 🎯 Features (This Piece)

- ✅ **Production-ready infrastructure** with Docker Compose
- ✅ **Scalable database layer** with Prisma, PostgreSQL, and PgBouncer
- ✅ **Redis caching layer** with ioredis
- ✅ **Authentication utilities** (JWT + API Key)
- ✅ **Structured logging** with Winston (JSON format)
- ✅ **Security middleware** (Helmet, CORS, Rate Limiting)
- ✅ **Health check endpoints** (`/healthz`, `/healthz/live`, `/healthz/ready`)
- ✅ **Database schema** for Users, Endpoints, and Request Logs

## 🛠 Tech Stack

- **Runtime**: Node.js 20+ with TypeScript 5
- **Framework**: Fastify v5
- **Database**: PostgreSQL 14 with Prisma ORM
- **Connection Pooling**: PgBouncer (transaction mode)
- **Cache**: Redis 7 with ioredis
- **Validation**: Zod
- **Logging**: Winston (JSON)
- **Security**: Helmet, CORS, Rate Limiting
- **Testing**: Vitest
- **Containerization**: Docker & Docker Compose

## 📁 Project Structure

```
MockUrl-backend/
├── src/
│   ├── prisma/
│   │   ├── schema.prisma         # Database schema
│   │   ├── seed.ts               # Seed script (2 test users)
│   │   └── migrations/           # Prisma migrations
│   ├── lib/
│   │   ├── db.ts                 # Prisma client singleton
│   │   ├── redis.ts              # Redis client singleton
│   │   ├── logger.ts             # Winston logger
│   │   └── auth.ts               # JWT/API key utilities
│   ├── middleware/               # (Future: request logging, auth)
│   ├── routes/                   # (Future: API routes)
│   ├── types/
│   │   └── env.d.ts              # Environment type definitions
│   ├── tests/
│   │   └── setup.ts              # Test configuration
│   └── index.ts                  # Main server entry point
├── docker/                       # Docker configurations
├── docker-compose.yml            # Development services
├── docker-compose.prod.yml       # Production deployment
├── Dockerfile                    # Multi-stage build
├── package.json                  # Dependencies
├── tsconfig.json                 # TypeScript config
├── vitest.config.ts              # Test configuration
├── eslint.config.js              # Linting rules
├── .env.example                  # Environment template
└── README.md                     # This file
```

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- npm or yarn

### 1. Clone and Install

```bash
# Navigate to project directory
cd MockUrl-backend

# Install dependencies
npm install
```

### 2. Setup Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your configuration (defaults work for local dev)
```

### 3. Start Infrastructure

```bash
# Start PostgreSQL, PgBouncer, and Redis
npm run docker:up

# Wait for services to be healthy (~10 seconds)
docker-compose logs -f
```

### 4. Setup Database

```bash
# Generate Prisma Client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Seed database with test users
npm run prisma:seed
```

### 5. Start Development Server

```bash
# Run in watch mode
npm run dev
```

The server will start on `http://localhost:3000`

### 6. Test Health Endpoints

```bash
# General health check
curl http://localhost:3000/healthz

# Expected response: { "status": "ok", "uptime": 12.345 }

# Liveness probe (simple uptime check)
curl http://localhost:3000/healthz/live

# Readiness probe (checks dependencies)
curl http://localhost:3000/healthz/ready
```

## 📊 Database Schema

### User Model
- Stores user accounts with email and API key
- Each user can create multiple endpoints

### Endpoint Model
- Named endpoints per user (e.g., `my-api`)
- Configurable rules and settings (JSON)
- Accessible at `{BASE_URL}/e/{name}`

### RequestLog Model
- Captures all requests to endpoints
- Stores method, path, headers, body
- Tracks response status, headers, body
- Records latency and metadata

## 🔧 Available Scripts

```bash
# Development
npm run dev              # Start dev server with hot reload
npm run build            # Build for production
npm start                # Start production server

# Database
npm run prisma:generate  # Generate Prisma Client
npm run prisma:migrate   # Create and apply migrations
npm run prisma:deploy    # Deploy migrations (production)
npm run prisma:seed      # Seed database with test data
npm run prisma:studio    # Open Prisma Studio GUI

# Docker
npm run docker:up        # Start all services
npm run docker:down      # Stop all services
npm run docker:logs      # View logs
npm run docker:clean     # Remove volumes and data

# Testing & Linting
npm test                 # Run tests
npm run test:coverage    # Run tests with coverage
npm run lint             # Lint code
```

## 🐳 Docker Services

### Development (`docker-compose.yml`)

- **PostgreSQL 14** on port 5432
- **PgBouncer** on port 6432 (transaction pooling)
- **Redis 7** on port 6379

### Production (`docker-compose.prod.yml`)

Includes the application container with:
- Multi-stage optimized build
- Non-root user execution
- Health checks
- Auto-restart policy

To deploy production:

```bash
# Build and start
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f app
```

## 🔐 Authentication

The system supports two authentication methods:

### API Key (X-API-Key header)
```bash
curl -H "X-API-Key: YOUR_API_KEY" \
  http://localhost:3000/api/v1/endpoints
```

Test users created by seed script:
- `alice@example.com` (API key in seed output)
- `bob@example.com` (API key in seed output)

## 🔍 PgBouncer Configuration

The setup uses **transaction pooling mode** for optimal compatibility with Prisma:

- Pool size: 20 connections
- Minimum pool: 5 connections
- Reserve pool: 5 connections
- Max client connections: 1000

Database connection strings:
- **App queries**: `postgresql://...?pgbouncer=true&connection_limit=1`
- **Migrations**: `postgresql://...` (direct connection)

## 📝 Environment Variables

Key environment variables (see `.env.example` for full list):

```bash
# Server
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

# Database
DATABASE_URL="postgresql://..."          # Through PgBouncer
DIRECT_DATABASE_URL="postgresql://..."   # Direct to Postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Security
JWT_SECRET=your-secret-key
CORS_ORIGIN=http://localhost:3000

# API Configuration
BASE_ENDPOINT_URL=http://localhost:3000/e
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm test -- --watch
```

## 📈 Monitoring

### Health Check Endpoints

- **`GET /healthz`** - Full health check with all dependencies
- **`GET /healthz/live`** - Liveness probe (uptime only)
- **`GET /healthz/ready`** - Readiness probe (checks DB + Redis)

### Logging

All logs are JSON-formatted for easy parsing:

```json
{
  "timestamp": "2024-02-06 10:30:00.000",
  "level": "info",
  "message": "Server listening on 0.0.0.0:3000",
  "service": "MockUrl",
  "environment": "development"
}
```

## 🚦 API Summary (MockUrl-style)

- **POST /api/v1/endpoints/create** – Create endpoint `{ name }` → instant URL `https://{name}.mockurl.com`
- **GET /api/v1/endpoints** – List endpoints (cursor: `afterId`, `limit`, `sort`)
- **GET /api/v1/endpoints/:id** – Get endpoint + stats (owner-only)
- **DELETE /api/v1/endpoints/:id** – Soft-delete
- **GET /api/v1/history/:endpointId** – Request history (search, method, status, facets)
- **GET /api/v1/history/export/:endpointId** – Export logs (JSON)
- **GET /api/v1/user/me** – Current user
- **GET /api/v1/admin/overview** – Fleet stats (admin)
- **GET /healthz** – `{ status: "ok", uptime }`

## 🤝 Development Workflow

1. Start Docker services: `npm run docker:up`
2. Run migrations: `npm run prisma:migrate`
3. Seed data: `npm run prisma:seed`
4. Start dev server: `npm run dev`
5. Make changes (hot reload enabled)
6. Test endpoints with curl/Postman
7. Stop services: `npm run docker:down`

## ⚠️ Troubleshooting

### Database Connection Issues

```bash
# Check if PostgreSQL is running
docker-compose ps

# View PostgreSQL logs
docker-compose logs postgres

# Reset database
npm run docker:clean
npm run docker:up
npm run prisma:migrate
```

### Redis Connection Issues

```bash
# Test Redis connection
docker exec -it MockUrl-redis redis-cli ping
# Should return: PONG

# Clear Redis data
docker exec -it MockUrl-redis redis-cli FLUSHALL
```

### Port Conflicts

If ports 3000, 5432, or 6379 are in use:

```bash
# Change ports in docker-compose.yml
# Update .env accordingly
```

## 📄 License

MIT

## 🙋 Support

For issues or questions:
1. Check the logs: `npm run docker:logs`
2. Review health endpoints: `curl http://localhost:3000/healthz`
3. Verify environment variables in `.env`

---

**Status**: ✅ Foundation Complete - Ready for Feature Development
