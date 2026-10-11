package store

import (
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func open(t *testing.T) (*Store, *clock) {
	t.Helper()
	c := &clock{t: time.UnixMilli(1_790_000_000_000)}
	s, err := Open(t.Context(), filepath.Join(t.TempDir(), "test.db"), c.now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s, c
}

func device(t *testing.T, s *Store, account, token, invite string) (string, bool) {
	t.Helper()
	id, created, err := s.CreateDevice(t.Context(), NewDevice{Account: account, Name: "d", TokenHash: []byte(token), Invite: invite})
	if err != nil {
		t.Fatal(err)
	}
	return id, created
}

func TestReopenKeepsData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	s, err := Open(t.Context(), path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.CreateDevice(t.Context(), NewDevice{Account: "a", Name: "d", TokenHash: []byte("t")}); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	s, err = Open(t.Context(), path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if exists, err := s.AccountExists(t.Context(), "a"); err != nil || !exists {
		t.Errorf("exists = %v, %v", exists, err)
	}
}

func TestInvites(t *testing.T) {
	s, _ := open(t)
	ctx := t.Context()

	first, err := s.BootstrapInvite(ctx)
	if err != nil || first == "" {
		t.Fatalf("bootstrap = %q, %v", first, err)
	}
	if again, _ := s.BootstrapInvite(ctx); again != first {
		t.Errorf("second bootstrap = %q, want the unused %q", again, first)
	}

	if _, _, err := s.CreateDevice(ctx, NewDevice{Account: "a", Name: "d", TokenHash: []byte("t0"), Invite: "nope"}); !errors.Is(err, ErrInvalidInvite) {
		t.Errorf("unknown invite err = %v", err)
	}
	if exists, _ := s.AccountExists(ctx, "a"); exists {
		t.Error("account created despite invalid invite")
	}
	if _, created := device(t, s, "a", "t1", first); !created {
		t.Error("account not created")
	}
	if _, _, err := s.CreateDevice(ctx, NewDevice{Account: "b", Name: "d", TokenHash: []byte("t2"), Invite: first}); !errors.Is(err, ErrInvalidInvite) {
		t.Errorf("used invite err = %v", err)
	}
	if _, created := device(t, s, "a", "t3", first); created {
		t.Error("existing account created again")
	}

	if code, err := s.BootstrapInvite(ctx); err != nil || code != "" {
		t.Errorf("bootstrap with accounts = %q, %v", code, err)
	}
	codes, err := s.CreateInvites(ctx, 3)
	if err != nil || len(codes) != 3 || codes[0] == codes[1] {
		t.Errorf("invites = %v, %v", codes, err)
	}
}

func TestDevices(t *testing.T) {
	s, c := open(t)
	ctx := t.Context()
	id, _ := device(t, s, "a", "t1", "")
	device(t, s, "a", "t2", "")
	device(t, s, "b", "t3", "")

	d, err := s.Authenticate(ctx, []byte("t1"))
	if err != nil || d.ID != id || d.Account != "a" {
		t.Fatalf("authenticate = %+v, %v", d, err)
	}
	created := d.LastSeen
	c.advance(30 * time.Second)
	if d, _ := s.Authenticate(ctx, []byte("t1")); !d.LastSeen.Equal(created) {
		t.Errorf("lastSeen updated within a minute")
	}
	c.advance(time.Minute)
	if d, _ := s.Authenticate(ctx, []byte("t1")); !d.LastSeen.Equal(c.now()) {
		t.Errorf("lastSeen = %v, want %v", d.LastSeen, c.now())
	}

	devices, err := s.Devices(ctx, "a")
	if err != nil || len(devices) != 2 {
		t.Fatalf("devices = %+v, %v", devices, err)
	}
	if err := s.RevokeDevice(ctx, "b", id); !errors.Is(err, ErrNotFound) {
		t.Errorf("revoke other account's device err = %v", err)
	}
	if err := s.RevokeDevice(ctx, "a", id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Authenticate(ctx, []byte("t1")); !errors.Is(err, ErrNotFound) {
		t.Errorf("revoked token err = %v", err)
	}
}

func TestBatchesAndSnapshots(t *testing.T) {
	s, _ := open(t)
	ctx := t.Context()
	device(t, s, "a", "t1", "")
	device(t, s, "b", "t2", "")

	push := func(account, id string) int64 {
		t.Helper()
		seq, _, err := s.PushBatch(ctx, account, id, []byte(id))
		if err != nil {
			t.Fatal(err)
		}
		return seq
	}
	a1, b1, a2, a3 := push("a", "1"), push("b", "1"), push("a", "2"), push("a", "3")
	if seq, created, _ := s.PushBatch(ctx, "a", "2", []byte("other")); seq != a2 || created {
		t.Errorf("repeat push = %d, %v; want %d, false", seq, created, a2)
	}

	page, err := s.Batches(ctx, "a", 0, 2)
	if err != nil || len(page.Batches) != 2 || !page.More || page.SinceSnapshot != 3 || page.Batches[0].Seq != a1 || string(page.Batches[1].Data) != "2" {
		t.Fatalf("page = %+v, %v", page, err)
	}

	if _, err := s.Snapshot(ctx, "a"); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing snapshot err = %v", err)
	}
	if err := s.PutSnapshot(ctx, "a", Snapshot{Seq: a3 + 1, Data: []byte("s")}); !errors.Is(err, ErrSeqTooHigh) {
		t.Errorf("too high err = %v", err)
	}
	if err := s.PutSnapshot(ctx, "a", Snapshot{Seq: b1, Data: []byte("s")}); err != nil {
		t.Fatal(err)
	}
	if err := s.PutSnapshot(ctx, "a", Snapshot{Seq: b1, Data: []byte("s")}); !errors.Is(err, ErrStaleSnapshot) {
		t.Errorf("stale err = %v", err)
	}
	if _, err := s.Batches(ctx, "a", a1, 10); !errors.Is(err, ErrCursorPruned) {
		t.Errorf("pruned err = %v", err)
	}
	page, err = s.Batches(ctx, "a", b1, 10)
	if err != nil || len(page.Batches) != 2 || page.More || page.SinceSnapshot != 2 {
		t.Errorf("after snapshot = %+v, %v", page, err)
	}
	if page, _ := s.Batches(ctx, "b", 0, 10); len(page.Batches) != 1 {
		t.Errorf("other account's batches pruned: %+v", page)
	}
	if snap, err := s.Snapshot(ctx, "a"); err != nil || snap.Seq != b1 || string(snap.Data) != "s" {
		t.Errorf("snapshot = %+v, %v", snap, err)
	}
}

func TestLinks(t *testing.T) {
	s, c := open(t)
	ctx := t.Context()
	device(t, s, "a", "t1", "")

	id, err := s.CreateLink(ctx, "a", []byte("seed"), c.now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if data, err := s.TakeLink(ctx, id); err != nil || string(data) != "seed" {
		t.Errorf("take = %q, %v", data, err)
	}
	if _, err := s.TakeLink(ctx, id); !errors.Is(err, ErrNotFound) {
		t.Errorf("second take err = %v", err)
	}

	id, _ = s.CreateLink(ctx, "a", []byte("seed"), c.now().Add(time.Minute))
	c.advance(time.Minute)
	if _, err := s.TakeLink(ctx, id); !errors.Is(err, ErrNotFound) {
		t.Errorf("expired take err = %v", err)
	}
}
