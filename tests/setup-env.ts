import "dotenv/config";

// Unit tests must not depend on a developer's .env: give crypto deterministic test keys.
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString("base64");
process.env.DATA_HASH_KEY ??= Buffer.alloc(32, 2).toString("base64");
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-1234";
process.env.DATABASE_URL ??= "postgresql://townmart_app:app-dev-only@localhost:5432/townmart";
