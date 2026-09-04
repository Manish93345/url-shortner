import { runner } from 'node-pg-migrate';
import { config } from '../config';

const direction = process.argv[2] === 'down' ? 'down' : 'up';

runner({
  databaseUrl: config.DATABASE_URL,
  // Dev runs from src via tsx; the Docker image will point this at dist (Phase 5)
  dir: process.env.MIGRATIONS_DIR ?? 'src/db/migrations',
  direction,
  migrationsTable: 'pgmigrations',
  singleTransaction: true,
  count: direction === 'down' ? 1 : Infinity, // down rolls back one step
  verbose: true,
})
  .then(() => {
    console.log(`✅ Migrations ${direction} complete`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });