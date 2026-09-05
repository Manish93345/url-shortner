exports.up = (pgm) => {
  pgm.addColumns('users', {
    password_hash: { type: 'text' },                       // null for the old dev user — fine
    plan: { type: 'varchar(20)', notNull: true, default: 'free' },
  });

  pgm.createTable('api_keys', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)' },
    name: { type: 'varchar(50)', notNull: true },
    key_hash: { type: 'varchar(64)', notNull: true, unique: true }, // sha256 hex — O(1) lookup
    prefix: { type: 'varchar(12)', notNull: true },        // shown in UI so users can identify keys
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_used_at: { type: 'timestamptz' },
    revoked_at: { type: 'timestamptz' },
  });
  pgm.createIndex('api_keys', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('api_keys');
  pgm.dropColumns('users', ['password_hash', 'plan']);
};