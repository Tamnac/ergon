package api

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"ergon/server/internal/store"
)

const (
	challengeTTL  = 5 * time.Minute
	maxChallenges = 10_000
	authPrefix    = "ergon-auth-v1:"
)

// challenges holds issued nonces until they are used or expire.
type challenges struct {
	mu      sync.Mutex
	now     func() time.Time
	expires map[string]time.Time
}

func newChallenges(now func() time.Time) *challenges {
	return &challenges{now: now, expires: make(map[string]time.Time)}
}

// issue returns a new nonce, or false if too many are pending.
func (c *challenges) issue() (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if len(c.expires) >= maxChallenges {
		for nonce, exp := range c.expires {
			if !now.Before(exp) {
				delete(c.expires, nonce)
			}
		}
		if len(c.expires) >= maxChallenges {
			return "", false
		}
	}
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	nonce := base64.StdEncoding.EncodeToString(b)
	c.expires[nonce] = now.Add(challengeTTL)
	return nonce, true
}

// take consumes a nonce and reports whether it was issued and unexpired.
func (c *challenges) take(nonce string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	exp, ok := c.expires[nonce]
	delete(c.expires, nonce)
	return ok && c.now().Before(exp)
}

func (s *server) challenge(w http.ResponseWriter, _ *http.Request) {
	nonce, ok := s.challenges.issue()
	if !ok {
		writeError(w, http.StatusServiceUnavailable, codeInternal, "too many pending challenges")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"nonce": nonce})
}

type sessionRequest struct {
	PublicKey string `json:"publicKey"`
	Nonce     string `json:"nonce"`
	Signature string `json:"signature"`
	Device    struct {
		Name string `json:"name"`
	} `json:"device"`
	Invite string `json:"invite"`
}

func (s *server) createSession(w http.ResponseWriter, r *http.Request) {
	var req sessionRequest
	if !decode(w, r, 16<<10, &req) {
		return
	}
	pub, err := base64.StdEncoding.Strict().DecodeString(req.PublicKey)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		writeError(w, http.StatusBadRequest, codeBadRequest, "publicKey must be a base64 Ed25519 public key")
		return
	}
	sig, err := base64.StdEncoding.DecodeString(req.Signature)
	if err != nil || len(sig) != ed25519.SignatureSize {
		writeError(w, http.StatusBadRequest, codeBadRequest, "signature must be a base64 Ed25519 signature")
		return
	}
	if n := utf8.RuneCountInString(req.Device.Name); n < 1 || n > 100 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "device name must be 1 to 100 characters")
		return
	}
	if len(req.Invite) > 100 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "invite too long")
		return
	}
	if !s.challenges.take(req.Nonce) {
		writeError(w, http.StatusUnauthorized, codeUnauthorized, "unknown, used or expired nonce")
		return
	}
	if !ed25519.Verify(pub, []byte(authPrefix+req.Nonce), sig) {
		writeError(w, http.StatusUnauthorized, codeUnauthorized, "invalid signature")
		return
	}

	account := base64.StdEncoding.EncodeToString(pub)
	exists, err := s.store.AccountExists(r.Context(), account)
	if err != nil {
		internalError(w, r, err)
		return
	}
	invite := ""
	if !exists && !s.allowlist[account] {
		switch s.cfg.Registration {
		case RegistrationOpen:
		case RegistrationInvite:
			if req.Invite == "" {
				writeError(w, http.StatusForbidden, codeInviteRequired, "an invite code is required to register")
				return
			}
			invite = req.Invite
		default:
			writeError(w, http.StatusForbidden, codeRegistrationClosed, "registration is closed")
			return
		}
	}

	token := make([]byte, 32)
	_, _ = rand.Read(token)
	tokenStr := base64.RawURLEncoding.EncodeToString(token)
	id, created, err := s.store.CreateDevice(r.Context(), store.NewDevice{
		Account:   account,
		Name:      req.Device.Name,
		TokenHash: hashToken(tokenStr),
		Invite:    invite,
	})
	if errors.Is(err, store.ErrInvalidInvite) {
		writeError(w, http.StatusForbidden, codeInvalidInvite, "invite code is unknown or already used")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": tokenStr, "deviceId": id, "account": account, "created": created})
}

func hashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

type authedHandler func(http.ResponseWriter, *http.Request, store.Device)

// auth wraps h to require a valid bearer token.
func (s *server) auth(h authedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || token == "" {
			writeError(w, http.StatusUnauthorized, codeUnauthorized, "missing bearer token")
			return
		}
		device, err := s.store.Authenticate(r.Context(), hashToken(token))
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusUnauthorized, codeUnauthorized, "unknown or revoked token")
			return
		}
		if err != nil {
			internalError(w, r, err)
			return
		}
		h(w, r, device)
	}
}

func (s *server) deleteSession(w http.ResponseWriter, r *http.Request, d store.Device) {
	if err := s.store.RevokeDevice(r.Context(), d.Account, d.ID); err != nil && !errors.Is(err, store.ErrNotFound) {
		internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type deviceJSON struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Created  int64  `json:"created"`
	LastSeen int64  `json:"lastSeen"`
	Current  bool   `json:"current"`
}

func (s *server) devices(w http.ResponseWriter, r *http.Request, current store.Device) {
	devices, err := s.store.Devices(r.Context(), current.Account)
	if err != nil {
		internalError(w, r, err)
		return
	}
	res := make([]deviceJSON, len(devices))
	for i, d := range devices {
		res[i] = deviceJSON{
			ID:       d.ID,
			Name:     d.Name,
			Created:  d.Created.UnixMilli(),
			LastSeen: d.LastSeen.UnixMilli(),
			Current:  d.ID == current.ID,
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"devices": res})
}

func (s *server) revokeDevice(w http.ResponseWriter, r *http.Request, d store.Device) {
	err := s.store.RevokeDevice(r.Context(), d.Account, r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, codeNotFound, "no such device")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
