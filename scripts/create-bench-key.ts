import { pool } from '../src/db/pool';
import { createApiKey } from '../src/modules/auth/service';

async function main() {
  const { rows } = await pool.query(
    `INSERT INTO users (email, plan) VALUES ('bench@localhost', 'benchmark')
     ON CONFLICT (email) DO UPDATE SET plan = 'benchmark'
     RETURNING id`,
  );
  const key = await createApiKey(rows[0].id, 'load-test');
  console.log('\nBench API key (shown once — save it):\n\n  ' + key.key + '\n');
  await pool.end();
}
main();