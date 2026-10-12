package api

import (
	"net/http"
	"regexp"
	"strings"
	"time"

	"ergon/server/internal/store"
)

const (
	maxReminders    = 500
	maxReminderData = 3 << 10
	maxEndpoint     = 2048
)

var base64URL = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func (s *server) putPush(w http.ResponseWriter, r *http.Request, d store.Device) {
	var req struct {
		Endpoint string `json:"endpoint"`
		P256dh   string `json:"p256dh"`
		Auth     string `json:"auth"`
	}
	if !decode(w, r, 8<<10, &req) {
		return
	}
	valid := strings.HasPrefix(req.Endpoint, "https://") && len(req.Endpoint) <= maxEndpoint &&
		len(req.P256dh) <= 128 && len(req.Auth) <= 64 &&
		base64URL.MatchString(req.P256dh) && base64URL.MatchString(req.Auth)
	if !valid {
		writeError(w, http.StatusBadRequest, codeBadRequest, "invalid push subscription")
		return
	}
	sub := store.PushSubscription{Endpoint: req.Endpoint, P256dh: req.P256dh, Auth: req.Auth}
	if err := s.store.PutPush(r.Context(), d, sub); err != nil {
		internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) deletePush(w http.ResponseWriter, r *http.Request, d store.Device) {
	if err := s.store.DeletePush(r.Context(), d.ID); err != nil {
		internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) putReminders(w http.ResponseWriter, r *http.Request, d store.Device) {
	var req struct {
		Reminders []struct {
			ID   string `json:"id"`
			At   int64  `json:"at"`
			Data string `json:"data"`
		} `json:"reminders"`
	}
	if !decode(w, r, bodyLimit(maxReminders*maxReminderData), &req) {
		return
	}
	if len(req.Reminders) > maxReminders {
		writeError(w, http.StatusBadRequest, codeBadRequest, "too many reminders")
		return
	}
	reminders := make([]store.Reminder, len(req.Reminders))
	for i, rem := range req.Reminders {
		if !validID(rem.ID) || rem.At < 0 {
			writeError(w, http.StatusBadRequest, codeBadRequest, "invalid reminder")
			return
		}
		data, ok := decodeData(w, rem.Data, maxReminderData)
		if !ok {
			return
		}
		reminders[i] = store.Reminder{ID: rem.ID, At: time.UnixMilli(rem.At), Data: data}
	}
	if err := s.store.PutReminders(r.Context(), d.Account, reminders); err != nil {
		internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
