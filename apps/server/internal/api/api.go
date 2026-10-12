// Package api implements the HTTP API of the Ergon server, as described in
// protocol/README.md.
package api

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"ergon/server/internal/store"
)

// Registration is the server's policy for creating accounts.
type Registration string

// Registration modes. Allowlisted public keys can register in every mode.
const (
	// RegistrationOpen accepts anyone.
	RegistrationOpen Registration = "open"
	// RegistrationInvite requires an unused invite code.
	RegistrationInvite Registration = "invite"
	// RegistrationClosed accepts only allowlisted public keys.
	RegistrationClosed Registration = "closed"
)

// Config configures the API.
type Config struct {
	Registration Registration
	// Allowlist holds base64 public keys that may always register.
	Allowlist []string
	// VAPID is the public key (base64url) browsers subscribe to Web Push with.
	VAPID string
	// Now is the clock; nil means time.Now.
	Now func() time.Time
}

const (
	maxBatch    = 1 << 20
	maxSnapshot = 32 << 20
	maxLink     = 4 << 10
	linkTTL     = 10 * time.Minute
)

type server struct {
	cfg        Config
	allowlist  map[string]bool
	store      *store.Store
	challenges *challenges
	broker     *broker
}

// New returns the root HTTP handler. web holds the web app, served for
// non-API paths with index.html as fallback; it may be nil.
func New(cfg Config, st *store.Store, web fs.FS) http.Handler {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	s := &server{
		cfg:        cfg,
		allowlist:  make(map[string]bool),
		store:      st,
		challenges: newChallenges(cfg.Now),
		broker:     newBroker(),
	}
	for _, key := range cfg.Allowlist {
		s.allowlist[key] = true
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", health)
	mux.HandleFunc("GET /api/v1/info", s.info)
	mux.HandleFunc("POST /api/v1/challenge", s.challenge)
	mux.HandleFunc("POST /api/v1/session", s.createSession)
	mux.HandleFunc("DELETE /api/v1/session", s.auth(s.deleteSession))
	mux.HandleFunc("GET /api/v1/devices", s.auth(s.devices))
	mux.HandleFunc("DELETE /api/v1/devices/{id}", s.auth(s.revokeDevice))
	mux.HandleFunc("POST /api/v1/batches", s.auth(s.pushBatch))
	mux.HandleFunc("GET /api/v1/batches", s.auth(s.batches))
	mux.HandleFunc("GET /api/v1/snapshot", s.auth(s.snapshot))
	mux.HandleFunc("PUT /api/v1/snapshot", s.auth(s.putSnapshot))
	mux.HandleFunc("GET /api/v1/events", s.auth(s.events))
	mux.HandleFunc("PUT /api/v1/push", s.auth(s.putPush))
	mux.HandleFunc("DELETE /api/v1/push", s.auth(s.deletePush))
	mux.HandleFunc("PUT /api/v1/reminders", s.auth(s.putReminders))
	mux.HandleFunc("POST /api/v1/links", s.auth(s.createLink))
	mux.HandleFunc("GET /api/v1/links/{id}", s.link)
	mux.Handle("GET /", static(web))
	return cors(mux)
}

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) info(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"version": 1, "registration": s.cfg.Registration, "vapid": s.cfg.VAPID})
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", "*")
			if r.Method == http.MethodOptions {
				h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE")
				h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				h.Set("Access-Control-Max-Age", "86400")
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// Error codes from protocol/README.md.
const (
	codeBadRequest         = "bad_request"
	codeUnauthorized       = "unauthorized"
	codeInviteRequired     = "invite_required"
	codeInvalidInvite      = "invalid_invite"
	codeRegistrationClosed = "registration_closed"
	codeNotFound           = "not_found"
	codeStaleSnapshot      = "stale_snapshot"
	codeCursorPruned       = "cursor_pruned"
	codeTooLarge           = "too_large"
	codeInternal           = "internal"
)

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": code, "message": message})
}

func internalError(w http.ResponseWriter, r *http.Request, err error) {
	slog.Error("request", "method", r.Method, "path", r.URL.Path, "err", err)
	writeError(w, http.StatusInternalServerError, codeInternal, "internal error")
}

// decode reads a JSON body of at most limit bytes into v. On failure it writes
// the error response and returns false.
func decode(w http.ResponseWriter, r *http.Request, limit int64, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	dec.DisallowUnknownFields()
	err := dec.Decode(v)
	if maxErr := (*http.MaxBytesError)(nil); errors.As(err, &maxErr) {
		writeError(w, http.StatusRequestEntityTooLarge, codeTooLarge, "request body too large")
		return false
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "invalid JSON: "+err.Error())
		return false
	}
	return true
}

// bodyLimit is the request size allowing for base64 data of up to maxData bytes.
func bodyLimit(maxData int) int64 {
	return int64(base64.StdEncoding.EncodedLen(maxData)) + 4<<10
}

// decodeData decodes non-empty base64 data of at most maxData bytes. On
// failure it writes the error response and returns false.
func decodeData(w http.ResponseWriter, s string, maxData int) ([]byte, bool) {
	data, err := base64.StdEncoding.Strict().DecodeString(s)
	if err != nil || len(data) == 0 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "data must be non-empty base64")
		return nil, false
	}
	if len(data) > maxData {
		writeError(w, http.StatusRequestEntityTooLarge, codeTooLarge, "data too large")
		return nil, false
	}
	return data, true
}

// validID reports whether id matches the protocol's Id definition.
func validID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	return strings.Trim(id, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") == ""
}
