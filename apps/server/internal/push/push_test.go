package push

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ergon/server/internal/store"
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

type harness struct {
	t      *testing.T
	store  *store.Store
	clock  *clock
	pusher *Pusher
	device store.Device
	// requests received by the fake push service, and the status it answers with.
	requests []*http.Request
	status   atomic.Int32
	service  *httptest.Server
	mu       sync.Mutex
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{t: t, clock: &clock{t: time.UnixMilli(1_790_000_000_000)}}
	h.status.Store(http.StatusCreated)
	h.service = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		h.requests = append(h.requests, r)
		h.mu.Unlock()
		w.WriteHeader(int(h.status.Load()))
	}))
	t.Cleanup(h.service.Close)

	st, err := store.Open(t.Context(), filepath.Join(t.TempDir(), "test.db"), h.clock.now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	h.store = st
	h.pusher, err = New(t.Context(), st, "mailto:test@example.com", h.service.Client(), h.clock.now)
	if err != nil {
		t.Fatal(err)
	}

	id, _, err := st.CreateDevice(t.Context(), store.NewDevice{Account: "acct", Name: "d", TokenHash: []byte("t")})
	if err != nil {
		t.Fatal(err)
	}
	h.device = store.Device{ID: id, Account: "acct"}
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	err = st.PutPush(t.Context(), h.device, store.PushSubscription{
		Endpoint: h.service.URL + "/push/1",
		P256dh:   base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()),
		Auth:     base64.RawURLEncoding.EncodeToString(auth),
	})
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func (h *harness) remind(id string, in time.Duration) {
	h.t.Helper()
	r := store.Reminder{ID: id, At: h.clock.now().Add(in), Data: []byte("sealed " + id)}
	if err := h.store.PutReminders(h.t.Context(), h.device.Account, []store.Reminder{r}); err != nil {
		h.t.Fatal(err)
	}
}

func (h *harness) deliver() int {
	h.t.Helper()
	if err := h.pusher.Deliver(h.t.Context()); err != nil {
		h.t.Fatal(err)
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.requests)
}

func TestDeliversDueReminderOnce(t *testing.T) {
	h := newHarness(t)
	h.remind("a", time.Minute)

	if n := h.deliver(); n != 0 {
		t.Fatalf("%d requests before the reminder is due", n)
	}
	h.clock.advance(time.Minute)
	if n := h.deliver(); n != 1 {
		t.Fatalf("%d requests when due, want 1", n)
	}
	req := h.requests[0]
	if got := req.Header.Get("Authorization"); !strings.HasPrefix(got, "vapid ") {
		t.Errorf("Authorization = %q", got)
	}
	if got := req.Header.Get("Content-Encoding"); got != "aes128gcm" {
		t.Errorf("Content-Encoding = %q", got)
	}
	if got := req.Header.Get("TTL"); got != "3600" {
		t.Errorf("TTL = %q", got)
	}

	if n := h.deliver(); n != 1 {
		t.Errorf("%d requests after a second run, want 1", n)
	}
	h.remind("a", time.Minute)
	h.clock.advance(time.Minute)
	if n := h.deliver(); n != 1 {
		t.Errorf("%d requests after the sent reminder was uploaded again, want 1", n)
	}
}

func TestReplacedReminderIsNotSent(t *testing.T) {
	h := newHarness(t)
	h.remind("a", time.Minute)
	h.remind("b", 2*time.Minute)
	h.clock.advance(time.Hour)
	if n := h.deliver(); n != 1 {
		t.Errorf("%d requests, want only b", n)
	}
}

func TestSkipsStaleReminders(t *testing.T) {
	h := newHarness(t)
	h.remind("a", time.Minute)
	h.clock.advance(2 * time.Hour)
	if n := h.deliver(); n != 0 {
		t.Errorf("%d requests for a reminder older than its TTL", n)
	}
}

func TestDropsGoneSubscriptions(t *testing.T) {
	h := newHarness(t)
	h.status.Store(http.StatusGone)
	h.remind("a", 0)
	h.deliver()

	subs, err := h.store.PushSubscriptions(t.Context(), "acct")
	if err != nil || len(subs) != 0 {
		t.Errorf("subscriptions = %v, %v", subs, err)
	}
}

func TestRetriesTemporaryFailures(t *testing.T) {
	h := newHarness(t)
	h.status.Store(http.StatusServiceUnavailable)
	h.remind("a", 0)
	if n := h.deliver(); n != 1 {
		t.Fatalf("%d requests, want 1", n)
	}
	h.status.Store(http.StatusCreated)
	h.clock.advance(time.Minute)
	if n := h.deliver(); n != 2 {
		t.Errorf("%d requests after retrying, want 2", n)
	}
	if n := h.deliver(); n != 2 {
		t.Errorf("%d requests after success, want 2", n)
	}
}

func TestKeepsVAPIDKeys(t *testing.T) {
	h := newHarness(t)
	again, err := New(t.Context(), h.store, "mailto:test@example.com", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if again.PublicKey() != h.pusher.PublicKey() || again.PublicKey() == "" {
		t.Errorf("public key changed: %q, %q", again.PublicKey(), h.pusher.PublicKey())
	}
}

func TestPublicOnly(t *testing.T) {
	for address, ok := range map[string]bool{
		"8.8.8.8:443":           true,
		"[2606:4700::1111]:443": true,
		"127.0.0.1:443":         false,
		"10.0.0.5:443":          false,
		"192.168.1.1:443":       false,
		"169.254.169.254:80":    false,
		"[::1]:443":             false,
		"[::ffff:10.0.0.1]:443": false,
	} {
		if err := publicOnly("tcp", address, nil); (err == nil) != ok {
			t.Errorf("publicOnly(%s) = %v, want ok=%v", address, err, ok)
		}
	}
}
