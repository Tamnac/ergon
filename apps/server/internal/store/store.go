// Package store persists accounts, devices, batches, snapshots, device links and
// reminders in SQLite.
package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

var (
	// ErrNotFound means the requested row doesn't exist or has expired.
	ErrNotFound = errors.New("not found")
	// ErrInvalidInvite means the invite code is unknown or already used.
	ErrInvalidInvite = errors.New("invite unknown or already used")
	// ErrStaleSnapshot means the snapshot's seq isn't above the stored one.
	ErrStaleSnapshot = errors.New("snapshot seq not above the current one")
	// ErrSeqTooHigh means the snapshot's seq is above the account's latest batch.
	ErrSeqTooHigh = errors.New("snapshot seq above the latest batch")
	// ErrCursorPruned means the requested batches were removed by a snapshot.
	ErrCursorPruned = errors.New("batches before the latest snapshot were pruned")
)

// Store is the server's database. Its methods are safe for concurrent use.
type Store struct {
	db  *sql.DB
	now func() time.Time
}

// Open opens or creates the SQLite database at path and migrates it.
// now is the clock used for timestamps and expiry.
func Open(ctx context.Context, path string, now func() time.Time) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, now: now}
	if err := s.migrate(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

// Close closes the database.
func (s *Store) Close() error {
	return s.db.Close()
}

// migrations is append-only. Never edit a migration that has shipped.
var migrations = []string{
	`
	CREATE TABLE accounts (
		public_key TEXT PRIMARY KEY,
		created INTEGER NOT NULL
	) STRICT;

	CREATE TABLE invites (
		code TEXT PRIMARY KEY,
		created INTEGER NOT NULL,
		used_by TEXT REFERENCES accounts (public_key),
		used_at INTEGER
	) STRICT;

	CREATE TABLE devices (
		id TEXT PRIMARY KEY,
		account TEXT NOT NULL REFERENCES accounts (public_key),
		name TEXT NOT NULL,
		token_hash BLOB NOT NULL UNIQUE,
		created INTEGER NOT NULL,
		last_seen INTEGER NOT NULL
	) STRICT;
	CREATE INDEX devices_account ON devices (account);

	CREATE TABLE batches (
		seq INTEGER PRIMARY KEY AUTOINCREMENT,
		account TEXT NOT NULL REFERENCES accounts (public_key),
		batch_id TEXT NOT NULL,
		data BLOB NOT NULL,
		created INTEGER NOT NULL,
		UNIQUE (account, batch_id)
	) STRICT;
	CREATE INDEX batches_account_seq ON batches (account, seq);

	CREATE TABLE snapshots (
		account TEXT PRIMARY KEY REFERENCES accounts (public_key),
		seq INTEGER NOT NULL,
		data BLOB NOT NULL,
		created INTEGER NOT NULL
	) STRICT;

	CREATE TABLE links (
		id TEXT PRIMARY KEY,
		account TEXT NOT NULL REFERENCES accounts (public_key),
		data BLOB NOT NULL,
		expires INTEGER NOT NULL
	) STRICT;
	`,
	`
	CREATE TABLE push_subscriptions (
		device TEXT PRIMARY KEY REFERENCES devices (id) ON DELETE CASCADE,
		account TEXT NOT NULL REFERENCES accounts (public_key),
		endpoint TEXT NOT NULL UNIQUE,
		p256dh TEXT NOT NULL,
		auth TEXT NOT NULL
	) STRICT;
	CREATE INDEX push_subscriptions_account ON push_subscriptions (account);

	CREATE TABLE reminders (
		account TEXT NOT NULL REFERENCES accounts (public_key),
		id TEXT NOT NULL,
		at INTEGER NOT NULL,
		data BLOB NOT NULL,
		sent INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (account, id)
	) STRICT, WITHOUT ROWID;
	CREATE INDEX reminders_at ON reminders (at);

	CREATE TABLE settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	) STRICT, WITHOUT ROWID;
	`,
}

func (s *Store) migrate(ctx context.Context) error {
	var version int
	if err := s.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	for v := version; v < len(migrations); v++ {
		err := s.tx(ctx, func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, migrations[v]); err != nil {
				return err
			}
			_, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", v+1))
			return err
		})
		if err != nil {
			return fmt.Errorf("version %d: %w", v+1, err)
		}
	}
	return nil
}

func (s *Store) tx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (s *Store) millis() int64 {
	return s.now().UnixMilli()
}

func randomID() string {
	b := make([]byte, 9)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
