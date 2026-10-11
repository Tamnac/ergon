package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Batch is an encrypted batch of ops.
type Batch struct {
	Seq  int64
	Data []byte
}

// BatchPage is a page of an account's batches.
type BatchPage struct {
	Batches []Batch
	// More is set if there are batches after the page.
	More bool
	// SinceSnapshot counts the account's batches after its latest snapshot.
	SinceSnapshot int64
}

// Snapshot is an encrypted compaction of an account's ops up to batch Seq.
type Snapshot struct {
	Seq  int64
	Data []byte
}

// PushBatch stores a batch and returns its seq. Pushing the same batch id for
// an account again returns the original seq with created false.
func (s *Store) PushBatch(ctx context.Context, account, id string, data []byte) (seq int64, created bool, err error) {
	err = s.tx(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRowContext(ctx,
			`INSERT INTO batches (account, batch_id, data, created) VALUES (?, ?, ?, ?)
			ON CONFLICT (account, batch_id) DO NOTHING RETURNING seq`,
			account, id, data, s.millis()).Scan(&seq)
		if errors.Is(err, sql.ErrNoRows) {
			return tx.QueryRowContext(ctx, `SELECT seq FROM batches WHERE account = ? AND batch_id = ?`, account, id).Scan(&seq)
		}
		created = err == nil
		return err
	})
	return seq, created, err
}

// Batches returns up to limit of the account's batches with seq > after, or
// ErrCursorPruned if after is below the latest snapshot's seq.
func (s *Store) Batches(ctx context.Context, account string, after int64, limit int) (BatchPage, error) {
	page := BatchPage{Batches: []Batch{}}
	err := s.tx(ctx, func(tx *sql.Tx) error {
		snapshot, err := snapshotSeq(ctx, tx, account)
		if err != nil {
			return err
		}
		if after < snapshot {
			return ErrCursorPruned
		}
		err = tx.QueryRowContext(ctx, `SELECT count(*) FROM batches WHERE account = ? AND seq > ?`, account, snapshot).Scan(&page.SinceSnapshot)
		if err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx,
			`SELECT seq, data FROM batches WHERE account = ? AND seq > ? ORDER BY seq LIMIT ?`, account, after, limit+1)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			if len(page.Batches) == limit {
				page.More = true
				break
			}
			var b Batch
			if err := rows.Scan(&b.Seq, &b.Data); err != nil {
				return err
			}
			page.Batches = append(page.Batches, b)
		}
		return rows.Err()
	})
	return page, err
}

func snapshotSeq(ctx context.Context, tx *sql.Tx, account string) (int64, error) {
	var seq int64
	err := tx.QueryRowContext(ctx, `SELECT coalesce((SELECT seq FROM snapshots WHERE account = ?), 0)`, account).Scan(&seq)
	return seq, err
}

// Snapshot returns the account's snapshot, or ErrNotFound.
func (s *Store) Snapshot(ctx context.Context, account string) (Snapshot, error) {
	var snap Snapshot
	err := s.db.QueryRowContext(ctx, `SELECT seq, data FROM snapshots WHERE account = ?`, account).Scan(&snap.Seq, &snap.Data)
	if errors.Is(err, sql.ErrNoRows) {
		return Snapshot{}, ErrNotFound
	}
	return snap, err
}

// PutSnapshot replaces the account's snapshot and deletes the batches it
// covers. It returns ErrStaleSnapshot if snap.Seq isn't above the current
// snapshot's, and ErrSeqTooHigh if it is above the account's latest batch.
func (s *Store) PutSnapshot(ctx context.Context, account string, snap Snapshot) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		current, err := snapshotSeq(ctx, tx, account)
		if err != nil {
			return err
		}
		if snap.Seq <= current {
			return ErrStaleSnapshot
		}
		var latest int64
		if err := tx.QueryRowContext(ctx, `SELECT coalesce(max(seq), 0) FROM batches WHERE account = ?`, account).Scan(&latest); err != nil {
			return err
		}
		if snap.Seq > latest {
			return ErrSeqTooHigh
		}
		_, err = tx.ExecContext(ctx,
			`INSERT INTO snapshots (account, seq, data, created) VALUES (?, ?, ?, ?)
			ON CONFLICT (account) DO UPDATE SET seq = excluded.seq, data = excluded.data, created = excluded.created`,
			account, snap.Seq, snap.Data, s.millis())
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM batches WHERE account = ? AND seq <= ?`, account, snap.Seq)
		return err
	})
}

// CreateLink stores a device link that expires at expires and returns its id.
// Expired links are purged.
func (s *Store) CreateLink(ctx context.Context, account string, data []byte, expires time.Time) (string, error) {
	id := randomID()
	err := s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM links WHERE expires <= ?`, s.millis()); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO links (id, account, data, expires) VALUES (?, ?, ?, ?)`,
			id, account, data, expires.UnixMilli())
		return err
	})
	return id, err
}

// TakeLink deletes a link and returns its data, or ErrNotFound if it doesn't
// exist or has expired.
func (s *Store) TakeLink(ctx context.Context, id string) ([]byte, error) {
	var data []byte
	var expires int64
	err := s.db.QueryRowContext(ctx, `DELETE FROM links WHERE id = ? RETURNING data, expires`, id).Scan(&data, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if expires <= s.millis() {
		return nil, ErrNotFound
	}
	return data, nil
}
