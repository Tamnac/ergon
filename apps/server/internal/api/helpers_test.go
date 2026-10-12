package api

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"sync"
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
	t       *testing.T
	handler http.Handler
	store   *store.Store
	clock   *clock
}

func newHarness(t *testing.T, cfg Config, web fs.FS) *harness {
	t.Helper()
	c := &clock{t: time.UnixMilli(1_790_000_000_000)}
	st, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "test.db"), c.now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if cfg.VAPID == "" {
		cfg.VAPID = "BAUTH"
	}
	if cfg.Registration == "" {
		cfg.Registration = RegistrationOpen
	}
	cfg.Now = c.now
	return &harness{t: t, handler: New(cfg, st, web), store: st, clock: c}
}

// do sends a request with an optional bearer token and JSON body (a string is sent as is).
func (h *harness) do(method, path, token string, body any) *httptest.ResponseRecorder {
	h.t.Helper()
	var r io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		r = bytes.NewBufferString(b)
	default:
		raw, err := json.Marshal(b)
		if err != nil {
			h.t.Fatal(err)
		}
		r = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, r)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	return rec
}

// ok asserts the status and validates the body against def unless def is empty.
func ok(t *testing.T, rec *httptest.ResponseRecorder, status int, def string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, status, rec.Body)
	}
	if def != "" {
		validate(t, def, rec.Body.Bytes())
	}
}

// fails asserts an error response with the status and code.
func fails(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, status, rec.Body)
	}
	validate(t, "Error", rec.Body.Bytes())
	var body struct{ Error string }
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Error != code {
		t.Errorf("error = %q, want %q", body.Error, code)
	}
}

func decodeBody[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("%v in %s", err, rec.Body)
	}
	return v
}

type account struct {
	pub  ed25519.PublicKey
	priv ed25519.PrivateKey
}

func newAccount(t *testing.T) account {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return account{pub, priv}
}

func (a account) key() string {
	return base64.StdEncoding.EncodeToString(a.pub)
}

func (h *harness) nonce() string {
	h.t.Helper()
	rec := h.do(http.MethodPost, "/api/v1/challenge", "", nil)
	ok(h.t, rec, http.StatusOK, "Challenge")
	return decodeBody[struct{ Nonce string }](h.t, rec).Nonce
}

func (a account) sessionRequest(nonce, invite string) map[string]any {
	req := map[string]any{
		"publicKey": a.key(),
		"nonce":     nonce,
		"signature": base64.StdEncoding.EncodeToString(ed25519.Sign(a.priv, []byte(authPrefix+nonce))),
		"device":    map[string]string{"name": "Test device"},
	}
	if invite != "" {
		req["invite"] = invite
	}
	return req
}

// signIn requests a challenge and a session.
func (h *harness) signIn(a account, invite string) *httptest.ResponseRecorder {
	h.t.Helper()
	req := a.sessionRequest(h.nonce(), invite)
	validate(h.t, "SessionRequest", mustJSON(h.t, req))
	return h.do(http.MethodPost, "/api/v1/session", "", req)
}

type session struct {
	Token    string
	DeviceID string
	Account  string
	Created  bool
}

// session signs in successfully and returns the session.
func (h *harness) session(a account) session {
	h.t.Helper()
	rec := h.signIn(a, "")
	ok(h.t, rec, http.StatusOK, "Session")
	return decodeBody[session](h.t, rec)
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func itoa(n int64) string {
	return strconv.FormatInt(n, 10)
}

func b64(b []byte) string {
	return base64.StdEncoding.EncodeToString(b)
}
