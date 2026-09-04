exports.up = (pgm) => {
  // Single row holding the global ID counter. Block allocation claims
  // ranges from it atomically — the heart of "distributed counter service".
  pgm.createTable('counter', {
    id: { type: 'integer', primaryKey: true },
    value: { type: 'bigint', notNull: true },
  });
  // Seed at 1,000,000 so the first codes aren't "0", "1", "2"...
  pgm.sql('INSERT INTO counter (id, value) VALUES (1, 1000000)');

  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'text', notNull: true, unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // Temporary dev user — replaced by real registration in Phase 3
  pgm.sql("INSERT INTO users (email) VALUES ('dev@localhost')");

  pgm.createTable('urls', {
    id: { type: 'bigint', primaryKey: true }, // the allocated numeric ID
    short_code: { type: 'varchar(10)', notNull: true, unique: true },
    original_url: { type: 'text', notNull: true },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz' },
  });
  pgm.createIndex('urls', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('urls');
  pgm.dropTable('users');
  pgm.dropTable('counter');
};