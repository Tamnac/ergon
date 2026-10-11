package api

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"ergon/server/internal/store"
)

const (
	defaultLimit = 500
	maxLimit     = 1000
)

type dataJSON struct {
	Seq  int64  `json:"seq,omitempty"`
	Data string `json:"data"`
}

func (s *server) pushBatch(w http.ResponseWriter, r *http.Request, d store.Device) {
	var req struct {
		ID   string `json:"id"`
		Data string `json:"data"`
	}
	if !decode(w, r, bodyLimit(maxBatch), &req) {
		return
	}
	if !validID(req.ID) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "invalid batch id")
		return
	}
	data, ok := decodeData(w, req.Data, maxBatch)
	if !ok {
		return
	}
	seq, created, err := s.store.PushBatch(r.Context(), d.Account, req.ID, data)
	if err != nil {
		internalError(w, r, err)
		return
	}
	if created {
		s.broker.publish(d.Account, seq)
	}
	writeJSON(w, http.StatusOK, map[string]int64{"seq": seq})
}

func (s *server) batches(w http.ResponseWriter, r *http.Request, d store.Device) {
	q := r.URL.Query()
	after, err := intParam(q.Get("after"), 0)
	if err != nil || after < 0 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "after must be a non-negative integer")
		return
	}
	limit, err := intParam(q.Get("limit"), defaultLimit)
	if err != nil || limit < 1 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "limit must be a positive integer")
		return
	}
	page, err := s.store.Batches(r.Context(), d.Account, after, int(min(limit, maxLimit)))
	if errors.Is(err, store.ErrCursorPruned) {
		writeError(w, http.StatusGone, codeCursorPruned, fmt.Sprintf("batches after %d were pruned; load the snapshot", after))
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	batches := make([]dataJSON, len(page.Batches))
	for i, b := range page.Batches {
		batches[i] = dataJSON{Seq: b.Seq, Data: base64.StdEncoding.EncodeToString(b.Data)}
	}
	writeJSON(w, http.StatusOK, map[string]any{"batches": batches, "more": page.More, "sinceSnapshot": page.SinceSnapshot})
}

func intParam(s string, def int64) (int64, error) {
	if s == "" {
		return def, nil
	}
	return strconv.ParseInt(s, 10, 64)
}

func (s *server) snapshot(w http.ResponseWriter, r *http.Request, d store.Device) {
	snap, err := s.store.Snapshot(r.Context(), d.Account)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, codeNotFound, "no snapshot")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, dataJSON{Seq: snap.Seq, Data: base64.StdEncoding.EncodeToString(snap.Data)})
}

func (s *server) putSnapshot(w http.ResponseWriter, r *http.Request, d store.Device) {
	var req dataJSON
	if !decode(w, r, bodyLimit(maxSnapshot), &req) {
		return
	}
	if req.Seq < 1 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "seq must be a positive integer")
		return
	}
	data, ok := decodeData(w, req.Data, maxSnapshot)
	if !ok {
		return
	}
	err := s.store.PutSnapshot(r.Context(), d.Account, store.Snapshot{Seq: req.Seq, Data: data})
	switch {
	case errors.Is(err, store.ErrStaleSnapshot):
		writeError(w, http.StatusConflict, codeStaleSnapshot, "a snapshot with the same or a higher seq exists")
	case errors.Is(err, store.ErrSeqTooHigh):
		writeError(w, http.StatusBadRequest, codeBadRequest, "seq is above the latest batch")
	case err != nil:
		internalError(w, r, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *server) createLink(w http.ResponseWriter, r *http.Request, d store.Device) {
	var req struct {
		Data string `json:"data"`
	}
	if !decode(w, r, bodyLimit(maxLink), &req) {
		return
	}
	data, ok := decodeData(w, req.Data, maxLink)
	if !ok {
		return
	}
	expires := s.cfg.Now().Add(linkTTL)
	id, err := s.store.CreateLink(r.Context(), d.Account, data, expires)
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "expires": expires.UnixMilli()})
}

func (s *server) link(w http.ResponseWriter, r *http.Request) {
	data, err := s.store.TakeLink(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, codeNotFound, "link unknown, used or expired")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"data": base64.StdEncoding.EncodeToString(data)})
}
