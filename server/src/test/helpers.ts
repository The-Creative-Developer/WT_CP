import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';
import type { AppEnv } from '../app';

export const testEnv: AppEnv = {
  NODE_ENV: 'test',
  CORS_ORIGINS: ['http://localhost:5173'],
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-at-least-32-chars',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-at-least-32-chars',
};

/** Runs the test file against a throwaway in-memory MongoDB, emptied after every test. */
export function useTestDatabase() {
  let mongo: MongoMemoryReplSet;

  beforeAll(async () => {
    // A one-node replica set, like local dev and Atlas: transactions don't work on a standalone server.
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri());
    // Build unique/TTL indexes up front so duplicate-key behaviour is tested for real.
    await mongoose.connection.syncIndexes();
  }, 120_000);

  afterEach(async () => {
    // deleteMany (not drop) keeps the indexes in place.
    await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });
}
