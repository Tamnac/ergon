package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// PushSubscription is a browser's Web Push subscription, owned by one device.
type PushSubscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

// Reminder is a sealed payload to push at At.
type Reminder struct {
	ID   string
	At   time.Time
	Data []byte
}

// DueReminder is an unsent Reminder and the account it belongs to.
type DueReminder struct {
	Reminder
	Account string
}

// PutPush sets the Web Push subscription of a device. A subscription is
// delivered to once, so one with the same endpoint on another device is
// replaced (e.g. after signing in again from the same browser).
func (s *Store) PutPush(ctx context.Context, d Device, sub PushSubscription) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE endpoint = ?`, sub.Endpoint); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx,
			`INSERT INTO push_subscriptions (device, account, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (device) DO UPDATE SET endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth`,
			d.ID, d.Account, sub.Endpoint, sub.P256dh, sub.Auth)
		return err
	})
}

// DeletePush removes the subscription of a device, if it has one.
func (s *Store) DeletePush(ctx context.Context, device string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE device = ?`, device)
	return err
}

// DeleteEndpoint removes the subscription with the endpoint, e.g. once its
// push service reports it gone.
func (s *Store) DeleteEndpoint(ctx context.Context, endpoint string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE endpoint = ?`, endpoint)
	return err
}

// PushSubscriptions lists the subscriptions of an account's devices.
func (s *Store) PushSubscriptions(ctx context.Context, account string) ([]PushSubscription, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE account = ? ORDER BY device`, account)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var subs []PushSubscription
	for rows.Next() {
		var sub PushSubscription
		if err := rows.Scan(&sub.Endpoint, &sub.P256dh, &sub.Auth); err != nil {
			return nil, err
		}
		subs = append(subs, sub)
	}
	return subs, rows.Err()
}

// PutReminders replaces the unsent reminders of an account. Reminders already
// sent are kept, so a device that still lists one doesn't make it fire again.
func (s *Store) PutReminders(ctx context.Context, account string, reminders []Reminder) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM reminders WHERE account = ? AND sent = 0`, account); err != nil {
			return err
		}
		for _, r := range reminders {
			_, err := tx.ExecContext(ctx,
				`INSERT INTO reminders (account, id, at, data) VALUES (?, ?, ?, ?)
				 ON CONFLICT (account, id) DO NOTHING`,
				account, r.ID, r.At.UnixMilli(), r.Data)
			if err != nil {
				return err
			}
		}
		return nil
	})
}

// DueReminders returns unsent reminders that fire in (since, now], soonest first.
func (s *Store) DueReminders(ctx context.Context, since time.Time, limit int) ([]DueReminder, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT account, id, at, data FROM reminders WHERE sent = 0 AND at > ? AND at <= ? ORDER BY at, id LIMIT ?`,
		since.UnixMilli(), s.millis(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var due []DueReminder
	for rows.Next() {
		var r DueReminder
		var at int64
		if err := rows.Scan(&r.Account, &r.ID, &at, &r.Data); err != nil {
			return nil, err
		}
		r.At = time.UnixMilli(at)
		due = append(due, r)
	}
	return due, rows.Err()
}

// MarkReminderSent records that a reminder has been delivered (or given up on).
func (s *Store) MarkReminderSent(ctx context.Context, account, id string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE reminders SET sent = 1 WHERE account = ? AND id = ?`, account, id)
	return err
}

// PruneReminders deletes reminders that fired before the cutoff.
func (s *Store) PruneReminders(ctx context.Context, before time.Time) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM reminders WHERE at < ?`, before.UnixMilli())
	return err
}

// Setting returns the server setting under key, storing create's result first
// if there is none.
func (s *Store) Setting(ctx context.Context, key string, create func() (string, error)) (string, error) {
	var value string
	err := s.tx(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if value, err = create(); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?)`, key, value)
		return err
	})
	return value, err
}
