#!/bin/bash

set -e

echo "🚀 Setting up MockAPI Clone Backend..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env file from template...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✓ .env created${NC}"
else
    echo -e "${GREEN}✓ .env already exists${NC}"
fi

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
npm install
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Start Docker services
echo -e "${YELLOW}Starting Docker services (Postgres, PgBouncer, Redis)...${NC}"
docker-compose up -d
echo -e "${GREEN}✓ Docker services started${NC}"

# Wait for services to be ready
echo -e "${YELLOW}Waiting for services to be healthy (30s)...${NC}"
sleep 30

# Generate Prisma Client
echo -e "${YELLOW}Generating Prisma Client...${NC}"
npm run prisma:generate
echo -e "${GREEN}✓ Prisma Client generated${NC}"

# Run migrations
echo -e "${YELLOW}Running database migrations...${NC}"
npm run prisma:migrate
echo -e "${GREEN}✓ Migrations completed${NC}"

# Seed database
echo -e "${YELLOW}Seeding database with test users...${NC}"
npm run prisma:seed
echo -e "${GREEN}✓ Database seeded${NC}"

echo ""
echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}🎉 Setup completed successfully!${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo -e "To start the development server:"
echo -e "  ${YELLOW}npm run dev${NC}"
echo ""
echo -e "To test the health endpoint:"
echo -e "  ${YELLOW}curl http://localhost:3000/healthz${NC}"
echo ""
echo -e "To view logs:"
echo -e "  ${YELLOW}npm run docker:logs${NC}"
echo ""
echo -e "To stop services:"
echo -e "  ${YELLOW}npm run docker:down${NC}"
echo ""
