// Package push delivers reminders to browsers with Web Push (RFC 8030).
package push

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"syscall"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"ergon/server/internal/store"
)

const (
	// ttl is how long a reminder is still worth showing; later ones are dropped.
	ttl = time.Hour
	// retention is how long sent reminders are remembered so devices re-uploading
	// them don't send them again.
	retention = 24 * time.Hour
	batchSize = 100
)

// Pusher sends the reminders that come due to the push subscriptions of their account.
type Pusher struct {
	store   *store.Store
	subject string
	private string
	public  string
	client  webpush.HTTPClient
	now     func() time.Time
}

// New returns a Pusher, creating the server's VAPID key pair on first use.
// subject is a mailto: or https: URL push services can contact the operator at.
// client defaults to one that only reaches public addresses, and now to time.Now.
func New(ctx context.Context, st *store.Store, subject string, client webpush.HTTPClient, now func() time.Time) (*Pusher, error) {
	keys, err := st.Setting(ctx, "vapid", func() (string, error) {
		private, public, err := webpush.GenerateVAPIDKeys()
		if err != nil {
			return "", err
		}
		raw, err := json.Marshal(map[string]string{"private": private, "public": public})
		return string(raw), err
	})
	if err != nil {
		return nil, err
	}
	var pair struct{ Private, Public string }
	if err := json.Unmarshal([]byte(keys), &pair); err != nil {
		return nil, err
	}
	if client == nil {
		client = newClient()
	}
	if now == nil {
		now = time.Now
	}
	return &Pusher{store: st, subject: subject, private: pair.Private, public: pair.Public, client: client, now: now}, nil
}

// PublicKey is the VAPID public key (base64url) browsers subscribe with.
func (p *Pusher) PublicKey() string {
	return p.public
}

// Run delivers due reminders every interval until ctx is done.
func (p *Pusher) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if err := p.Deliver(ctx); err != nil && ctx.Err() == nil {
			slog.Error("deliver reminders", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Deliver sends the reminders that came due within the last hour.
func (p *Pusher) Deliver(ctx context.Context) error {
	now := p.now()
	due, err := p.store.DueReminders(ctx, now.Add(-ttl), batchSize)
	if err != nil {
		return err
	}
	for _, r := range due {
		if err := p.send(ctx, r); err != nil {
			return err
		}
	}
	return p.store.PruneReminders(ctx, now.Add(-retention))
}

// send pushes a reminder to every subscription of its account. It stays unsent,
// and is tried again on the next run, only if every attempt failed temporarily.
func (p *Pusher) send(ctx context.Context, r store.DueReminder) error {
	subs, err := p.store.PushSubscriptions(ctx, r.Account)
	if err != nil {
		return err
	}
	message := []byte(base64.StdEncoding.EncodeToString(r.Data))
	delivered, failed := 0, 0
	for _, sub := range subs {
		status, err := p.post(ctx, sub, message)
		switch {
		case err != nil || status == http.StatusTooManyRequests || status >= 500:
			failed++
			slog.Warn("push failed", "status", status, "err", err)
		case status == http.StatusNotFound || status == http.StatusGone ||
			status == http.StatusUnauthorized || status == http.StatusForbidden:
			if err := p.store.DeleteEndpoint(ctx, sub.Endpoint); err != nil {
				return err
			}
		case status >= 400:
			slog.Warn("push rejected", "status", status)
		default:
			delivered++
		}
	}
	if failed > 0 && delivered == 0 {
		return nil
	}
	return p.store.MarkReminderSent(ctx, r.Account, r.ID)
}

func (p *Pusher) post(ctx context.Context, sub store.PushSubscription, message []byte) (int, error) {
	res, err := webpush.SendNotificationWithContext(ctx, message,
		&webpush.Subscription{Endpoint: sub.Endpoint, Keys: webpush.Keys{Auth: sub.Auth, P256dh: sub.P256dh}},
		&webpush.Options{
			HTTPClient:      p.client,
			Subscriber:      p.subject,
			TTL:             int(ttl.Seconds()),
			Urgency:         webpush.UrgencyHigh,
			VAPIDPublicKey:  p.public,
			VAPIDPrivateKey: p.private,
		})
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	return res.StatusCode, nil
}

// newClient returns the HTTP client for push services. Endpoints are chosen by clients, so it
// has timeouts, doesn't follow redirects and refuses connections to non-public addresses.
func newClient() *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second, Control: publicOnly}
	return &http.Client{
		Timeout:       10 * time.Second,
		Transport:     &http.Transport{DialContext: dialer.DialContext, TLSHandshakeTimeout: 5 * time.Second},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// publicOnly is a net.Dialer Control that rejects loopback, private and link-local addresses.
func publicOnly(_, address string, _ syscall.RawConn) error {
	addr, err := netip.ParseAddrPort(address)
	if err != nil {
		return err
	}
	if ip := addr.Addr().Unmap(); !ip.IsGlobalUnicast() || ip.IsPrivate() {
		return fmt.Errorf("refusing to connect to %s", ip)
	}
	return nil
}
