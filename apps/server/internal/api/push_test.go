package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func validSubscription() map[string]string {
	return map[string]string{
		"endpoint": "https://push.example.com/send/abc",
		"p256dh":   "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
		"auth":     "tBHItJI5svbpez7KI4CCXg",
	}
}

func TestPushSubscriptions(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	a := newAccount(t)
	first, second := h.session(a), h.session(a)
	sub := validSubscription()
	validate(t, "PushSubscription", mustJSON(t, sub))

	fails(t, h.do(http.MethodPut, "/api/v1/push", "", sub), http.StatusUnauthorized, codeUnauthorized)
	for name, change := range map[string]map[string]string{
		"http":      {"endpoint": "http://push.example.com/send"},
		"long":      {"endpoint": "https://" + strings.Repeat("a", maxEndpoint)},
		"bad key":   {"p256dh": "not base64url!"},
		"empty key": {"auth": ""},
	} {
		t.Run(name, func(t *testing.T) {
			bad := validSubscription()
			for k, v := range change {
				bad[k] = v
			}
			fails(t, h.do(http.MethodPut, "/api/v1/push", first.Token, bad), http.StatusBadRequest, codeBadRequest)
		})
	}

	ok(t, h.do(http.MethodPut, "/api/v1/push", first.Token, sub), http.StatusNoContent, "")
	subs, err := h.store.PushSubscriptions(t.Context(), first.Account)
	if err != nil || len(subs) != 1 || subs[0].Endpoint != sub["endpoint"] {
		t.Fatalf("subscriptions = %+v, %v", subs, err)
	}

	// The same browser signing in as another device takes the subscription over.
	ok(t, h.do(http.MethodPut, "/api/v1/push", second.Token, sub), http.StatusNoContent, "")
	ok(t, h.do(http.MethodDelete, "/api/v1/push", first.Token, nil), http.StatusNoContent, "")
	if subs, _ := h.store.PushSubscriptions(t.Context(), first.Account); len(subs) != 1 {
		t.Fatalf("subscriptions after the first device removed its own = %+v", subs)
	}

	ok(t, h.do(http.MethodDelete, "/api/v1/devices/"+second.DeviceID, first.Token, nil), http.StatusNoContent, "")
	if subs, _ := h.store.PushSubscriptions(t.Context(), first.Account); len(subs) != 0 {
		t.Errorf("subscriptions after revoking the device = %+v", subs)
	}
}

func TestReminders(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	s := h.session(newAccount(t))
	at := h.clock.now().Add(time.Minute).UnixMilli()
	body := map[string]any{"reminders": []any{map[string]any{"id": "r1", "at": at, "data": b64([]byte("sealed"))}}}
	validate(t, "Reminders", mustJSON(t, body))

	fails(t, h.do(http.MethodPut, "/api/v1/reminders", "", body), http.StatusUnauthorized, codeUnauthorized)
	ok(t, h.do(http.MethodPut, "/api/v1/reminders", s.Token, body), http.StatusNoContent, "")
	h.clock.advance(time.Minute)
	due, err := h.store.DueReminders(t.Context(), h.clock.now().Add(-time.Hour), 10)
	if err != nil || len(due) != 1 || due[0].ID != "r1" || string(due[0].Data) != "sealed" {
		t.Fatalf("due = %+v, %v", due, err)
	}

	ok(t, h.do(http.MethodPut, "/api/v1/reminders", s.Token, map[string]any{"reminders": []any{}}), http.StatusNoContent, "")
	if due, _ := h.store.DueReminders(t.Context(), h.clock.now().Add(-time.Hour), 10); len(due) != 0 {
		t.Errorf("due after replacing with none = %+v", due)
	}
}

func TestReminderLimits(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	s := h.session(newAccount(t))
	put := func(reminders ...map[string]any) *httptest.ResponseRecorder {
		return h.do(http.MethodPut, "/api/v1/reminders", s.Token, map[string]any{"reminders": reminders})
	}
	one := func(id, data string) map[string]any { return map[string]any{"id": id, "at": 1, "data": data} }

	fails(t, put(one("has space", b64([]byte("x")))), http.StatusBadRequest, codeBadRequest)
	fails(t, put(one("a", "")), http.StatusBadRequest, codeBadRequest)
	fails(t, put(one("a", b64(make([]byte, maxReminderData+1)))), http.StatusRequestEntityTooLarge, codeTooLarge)
	ok(t, put(one("a", b64(make([]byte, maxReminderData)))), http.StatusNoContent, "")

	many := make([]map[string]any, maxReminders+1)
	for i := range many {
		many[i] = one(itoa(int64(i)), b64([]byte("x")))
	}
	fails(t, put(many...), http.StatusBadRequest, codeBadRequest)
	ok(t, put(many[:maxReminders]...), http.StatusNoContent, "")
}
