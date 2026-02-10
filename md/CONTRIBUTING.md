# Contributing to MockUrl Clone Backend

## Development Setup

### Quick Start

```bash
# One-command setup
make setup

# Or manually:
npm install
make docker-up
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

### Development Workflow

1. **Create a feature branch**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Start development server**
   ```bash
   make dev
   # or
   npm run dev
   ```

3. **Make your changes** - Hot reload is enabled

4. **Write tests** in `src/tests/`
   ```bash
   make test
   ```

5. **Lint your code**
   ```bash
   make lint
   ```

6. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

## Code Standards

### TypeScript

- Use strict TypeScript mode
- Avoid `any` types
- Use interfaces for object shapes
- Use type guards for runtime checks

### Naming Conventions

- **Files**: `kebab-case.ts`
- **Classes**: `PascalCase`
- **Functions/Variables**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Types/Interfaces**: `PascalCase`

### Project Structure

```
src/
├── lib/          # Core utilities (db, logger, auth)
├── middleware/   # Fastify middleware
├── routes/       # API routes organized by version
│   └── api/
│       └── v1/
├── types/        # TypeScript type definitions
└── tests/        # Test files (*.test.ts)
```

## Database Migrations

### Creating Migrations

```bash
# Make changes to schema.prisma
npm run prisma:migrate

# This creates a new migration and applies it
```

### Migration Best Practices

- One migration per logical change
- Descriptive migration names
- Test migrations in development first
- Never modify existing migrations
- Use transactions when possible

## Testing

### Writing Tests

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Feature Name', () => {
  beforeAll(async () => {
    // Setup
  });

  afterAll(async () => {
    // Cleanup
  });

  it('should do something', async () => {
    // Arrange
    const input = {};

    // Act
    const result = await myFunction(input);

    // Assert
    expect(result).toBe(expected);
  });
});
```

### Running Tests

```bash
# Run all tests
make test

# Run with coverage
make test-coverage

# Watch mode
npm test -- --watch

# Run specific test file
npm test -- src/tests/auth.test.ts
```

## Logging

Use the structured logger for all logging:

```typescript
import { logger } from './lib/logger.js';

logger.info('Operation completed', { userId, action });
logger.warn('Deprecated feature used', { feature });
logger.error('Operation failed', { error, context });
logger.debug('Debug information', { data });
```

## Error Handling

### HTTP Errors

```typescript
fastify.get('/route', async (request, reply) => {
  if (!valid) {
    return reply.code(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
    });
  }
});
```

### Try-Catch

```typescript
try {
  await operation();
} catch (error) {
  logger.error('Operation failed', { error });
  throw error; // Or handle gracefully
}
```

## Environment Variables

- Never commit `.env` file
- Add new variables to `.env.example`
- Update `src/types/env.d.ts` with types
- Document variables in README

## Docker

### Local Development

```bash
# Start services
make docker-up

# View logs
make docker-logs

# Stop services
make docker-down

# Clean everything (including data)
make docker-clean
```

### Production Build

```bash
# Build image
make prod-build

# Start production stack
make prod-up

# View logs
make prod-logs
```

## Pull Request Process

1. Ensure all tests pass
2. Update documentation if needed
3. Update CHANGELOG.md (if applicable)
4. Request review from maintainers
5. Address review comments
6. Squash commits before merge

## Commit Message Format

Follow Conventional Commits:

```
feat: add new endpoint for user management
fix: resolve race condition in request logging
docs: update API documentation
refactor: simplify authentication logic
test: add integration tests for endpoints
chore: update dependencies
```

## Useful Commands

```bash
# Database
make prisma-studio      # Open Prisma GUI
make prisma-generate    # Regenerate client
make prisma-seed        # Seed test data

# Development
make dev                # Start dev server
make test               # Run tests
make lint               # Lint code

# Docker
make docker-up          # Start services
make docker-down        # Stop services
make docker-logs        # View logs
```

## Troubleshooting

### Database Issues

```bash
# Reset database
make docker-clean
make docker-up
npm run prisma:migrate
npm run prisma:seed
```

### Port Conflicts

Change ports in `docker-compose.yml` and update `.env`

### TypeScript Errors

```bash
# Regenerate Prisma Client
npm run prisma:generate

# Clean build
rm -rf dist
npm run build
```

## Resources

- [Fastify Documentation](https://www.fastify.io/)
- [Prisma Documentation](https://www.prisma.io/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vitest Documentation](https://vitest.dev/)

## Questions?

- Check existing issues
- Review documentation
- Ask in discussions
- Create a new issue
