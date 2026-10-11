package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"ergon/server/internal/store"
)

const pingInterval = 25 * time.Second

// broker fans out new batch seqs to the event streams of an account.
type broker struct {
	mu   sync.Mutex
	subs map[string]map[chan int64]struct{}
}

func newBroker() *broker {
	return &broker{subs: make(map[string]map[chan int64]struct{})}
}

func (b *broker) subscribe(account string) chan int64 {
	ch := make(chan int64, 16)
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.subs[account] == nil {
		b.subs[account] = make(map[chan int64]struct{})
	}
	b.subs[account][ch] = struct{}{}
	return ch
}

func (b *broker) unsubscribe(account string, ch chan int64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.subs[account], ch)
	if len(b.subs[account]) == 0 {
		delete(b.subs, account)
	}
}

// publish notifies subscribers without blocking. A subscriber with a full
// buffer misses the event, but it has unread events that make it pull anyway.
func (b *broker) publish(account string, seq int64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs[account] {
		select {
		case ch <- seq:
		default:
		}
	}
}

func (s *server) events(w http.ResponseWriter, r *http.Request, d store.Device) {
	ch := s.broker.subscribe(d.Account)
	defer s.broker.unsubscribe(d.Account, ch)

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	rc := http.NewResponseController(w)
	if err := rc.Flush(); err != nil {
		return
	}

	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()
	for {
		var msg string
		select {
		case <-r.Context().Done():
			return
		case seq := <-ch:
			msg = fmt.Sprintf("event: batch\ndata: {\"seq\":%d}\n\n", seq)
		case <-ticker.C:
			if _, err := s.store.Authenticate(r.Context(), hashToken(token)); errors.Is(err, store.ErrNotFound) {
				return
			}
			msg = ": ping\n\n"
		}
		if _, err := fmt.Fprint(w, msg); err != nil {
			return
		}
		if err := rc.Flush(); err != nil {
			return
		}
	}
}
