package store

import (
	"cmp"
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// Device is a signed-in device (session) of an account.
type Device struct {
	ID       string
	Account  string
	Name     string
	Created  time.Time
	LastSeen time.Time
}

// NewDevice describes a device signing in.
type NewDevice struct {
	Account   string
	Name      string
	TokenHash []byte
	// Invite is consumed if the account gets created. Empty creates the account without one.
	Invite string
}

const insertInvite = `INSERT INTO invites (code, created) VALUES (?, ?)`

// CreateInvites creates n invite codes.
func (s *Store) CreateInvites(ctx context.Context, n int) ([]string, error) {
	codes := make([]string, n)
	err := s.tx(ctx, func(tx *sql.Tx) error {
		for i := range codes {
			codes[i] = newInviteCode()
			if _, err := tx.ExecContext(ctx, insertInvite, codes[i], s.millis()); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return codes, nil
}

// BootstrapInvite returns an unused invite, creating one if needed, as long as
// there are no accounts. Otherwise it returns "".
func (s *Store) BootstrapInvite(ctx context.Context) (string, error) {
	var code string
	err := s.tx(ctx, func(tx *sql.Tx) error {
		var accounts int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM accounts`).Scan(&accounts); err != nil || accounts > 0 {
			return err
		}
		err := tx.QueryRowContext(ctx, `SELECT code FROM invites WHERE used_by IS NULL ORDER BY created LIMIT 1`).Scan(&code)
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		code = newInviteCode()
		_, err = tx.ExecContext(ctx, insertInvite, code, s.millis())
		return err
	})
	return code, err
}

func newInviteCode() string {
	c := strings.ToLower(rand.Text()[:8])
	return c[:4] + "-" + c[4:]
}

// AccountExists reports whether an account with the public key exists.
func (s *Store) AccountExists(ctx context.Context, publicKey string) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM accounts WHERE public_key = ?)`, publicKey).Scan(&exists)
	return exists, err
}

// CreateDevice adds a device to an account, creating the account if it doesn't
// exist. It returns the device id and whether the account was created, or
// ErrInvalidInvite if d.Invite can't be used.
func (s *Store) CreateDevice(ctx context.Context, d NewDevice) (id string, created bool, err error) {
	err = s.tx(ctx, func(tx *sql.Tx) error {
		now := s.millis()
		res, err := tx.ExecContext(ctx, `INSERT INTO accounts (public_key, created) VALUES (?, ?) ON CONFLICT DO NOTHING`, d.Account, now)
		if err != nil {
			return err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return err
		}
		created = n == 1
		if created && d.Invite != "" {
			res, err := tx.ExecContext(ctx, `UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL`, d.Account, now, d.Invite)
			if err != nil {
				return err
			}
			if n, err := res.RowsAffected(); err != nil || n == 0 {
				return cmp.Or(err, ErrInvalidInvite)
			}
		}
		id = randomID()
		_, err = tx.ExecContext(ctx,
			`INSERT INTO devices (id, account, name, token_hash, created, last_seen) VALUES (?, ?, ?, ?, ?, ?)`,
			id, d.Account, d.Name, d.TokenHash, now, now)
		return err
	})
	if err != nil {
		return "", false, err
	}
	return id, created, nil
}

// Authenticate returns the device with the token hash, or ErrNotFound. It
// refreshes the device's last seen time if it is more than a minute old.
func (s *Store) Authenticate(ctx context.Context, tokenHash []byte) (Device, error) {
	var d Device
	var created, lastSeen int64
	err := s.db.QueryRowContext(ctx,
		`SELECT id, account, name, created, last_seen FROM devices WHERE token_hash = ?`, tokenHash,
	).Scan(&d.ID, &d.Account, &d.Name, &created, &lastSeen)
	if errors.Is(err, sql.ErrNoRows) {
		return Device{}, ErrNotFound
	}
	if err != nil {
		return Device{}, err
	}
	if now := s.millis(); now-lastSeen >= time.Minute.Milliseconds() {
		if _, err := s.db.ExecContext(ctx, `UPDATE devices SET last_seen = ? WHERE id = ?`, now, d.ID); err != nil {
			return Device{}, err
		}
		lastSeen = now
	}
	d.Created, d.LastSeen = time.UnixMilli(created), time.UnixMilli(lastSeen)
	return d, nil
}

// Devices lists the devices of an account, oldest first.
func (s *Store) Devices(ctx context.Context, account string) ([]Device, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, created, last_seen FROM devices WHERE account = ? ORDER BY created, id`, account)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var devices []Device
	for rows.Next() {
		d := Device{Account: account}
		var created, lastSeen int64
		if err := rows.Scan(&d.ID, &d.Name, &created, &lastSeen); err != nil {
			return nil, err
		}
		d.Created, d.LastSeen = time.UnixMilli(created), time.UnixMilli(lastSeen)
		devices = append(devices, d)
	}
	return devices, rows.Err()
}

// RevokeDevice deletes a device of an account, or returns ErrNotFound.
func (s *Store) RevokeDevice(ctx context.Context, account, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM devices WHERE account = ? AND id = ?`, account, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err == nil && n == 0 {
		return ErrNotFound
	}
	return err
}
