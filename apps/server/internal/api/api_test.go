package api

import (
	"bufio"
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestHealth(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	rec := h.do(http.MethodGet, "/api/health", "", nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("content type = %q", ct)
	}
	if body := decodeBody[map[string]string](t, rec); body["status"] != "ok" {
		t.Errorf("status field = %q, want ok", body["status"])
	}
}

func TestHealthRejectsOtherMethods(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	rec := h.do(http.MethodPost, "/api/health", "", nil)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestInfo(t *testing.T) {
	h := newHarness(t, Config{Registration: RegistrationInvite}, nil)
	rec := h.do(http.MethodGet, "/api/v1/info", "", nil)
	ok(t, rec, http.StatusOK, "Info")
	if got := decodeBody[map[string]any](t, rec)["registration"]; got != "invite" {
		t.Errorf("registration = %v", got)
	}
}

func TestSessionOpen(t *testing.T) {
	h := newHarness(t, Config{Registration: RegistrationOpen}, nil)
	a := newAccount(t)

	first := h.session(a)
	if !first.Created || first.Account != a.key() {
		t.Errorf("first session = %+v", first)
	}
	second := h.session(a)
	if second.Created || second.DeviceID == first.DeviceID || second.Token == first.Token {
		t.Errorf("second session = %+v, first %+v", second, first)
	}
}

func TestSessionInvite(t *testing.T) {
	h := newHarness(t, Config{Registration: RegistrationInvite}, nil)
	codes, err := h.store.CreateInvites(t.Context(), 1)
	if err != nil {
		t.Fatal(err)
	}
	a, b := newAccount(t), newAccount(t)

	fails(t, h.signIn(a, ""), http.StatusForbidden, codeInviteRequired)
	fails(t, h.signIn(a, "nope-nope"), http.StatusForbidden, codeInvalidInvite)

	rec := h.signIn(a, codes[0])
	ok(t, rec, http.StatusOK, "Session")
	if !decodeBody[session](t, rec).Created {
		t.Error("account not created")
	}

	fails(t, h.signIn(b, codes[0]), http.StatusForbidden, codeInvalidInvite)
	if h.session(a).Created {
		t.Error("existing account created again")
	}
}

func TestSessionClosed(t *testing.T) {
	allowed, other := newAccount(t), newAccount(t)
	h := newHarness(t, Config{Registration: RegistrationClosed, Allowlist: []string{allowed.key()}}, nil)

	fails(t, h.signIn(other, ""), http.StatusForbidden, codeRegistrationClosed)
	if !h.session(allowed).Created {
		t.Error("allowlisted account not created")
	}
}

func TestSessionRejectsBadAuth(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	a, b := newAccount(t), newAccount(t)

	t.Run("wrong key", func(t *testing.T) {
		req := a.sessionRequest(h.nonce(), "")
		req["publicKey"] = b.key()
		fails(t, h.do(http.MethodPost, "/api/v1/session", "", req), http.StatusUnauthorized, codeUnauthorized)
	})
	t.Run("wrong message", func(t *testing.T) {
		nonce := h.nonce()
		req := a.sessionRequest(nonce, "")
		req["signature"] = a.sessionRequest(h.nonce(), "")["signature"]
		fails(t, h.do(http.MethodPost, "/api/v1/session", "", req), http.StatusUnauthorized, codeUnauthorized)
	})
	t.Run("reused nonce", func(t *testing.T) {
		req := a.sessionRequest(h.nonce(), "")
		ok(t, h.do(http.MethodPost, "/api/v1/session", "", req), http.StatusOK, "Session")
		fails(t, h.do(http.MethodPost, "/api/v1/session", "", req), http.StatusUnauthorized, codeUnauthorized)
	})
	t.Run("unknown nonce", func(t *testing.T) {
		req := a.sessionRequest(b64(bytes.Repeat([]byte{7}, 32)), "")
		fails(t, h.do(http.MethodPost, "/api/v1/session", "", req), http.StatusUnauthorized, codeUnauthorized)
	})
	t.Run("expired nonce", func(t *testing.T) {
		req := a.sessionRequest(h.nonce(), "")
		h.clock.advance(challengeTTL)
		fails(t, h.do(http.MethodPost, "/api/v1/session", "", req), http.StatusUnauthorized, codeUnauthorized)
	})
	t.Run("malformed", func(t *testing.T) {
		req := a.sessionRequest(h.nonce(), "")
		req["publicKey"] = "short"
		fails(t, h.do(http.MethodPost, "/api/v1/session", "", req), http.StatusBadRequest, codeBadRequest)
		req = a.sessionRequest(h.nonce(), "")
		req["device"] = map[string]string{"name": ""}
		fails(t, h.do(http.MethodPost, "/api/v1/session", "", req), http.StatusBadRequest, codeBadRequest)
		fails(t, h.do(http.MethodPost, "/api/v1/session", "", "{"), http.StatusBadRequest, codeBadRequest)
	})
}

func TestUnauthorized(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	fails(t, h.do(http.MethodGet, "/api/v1/devices", "", nil), http.StatusUnauthorized, codeUnauthorized)
	fails(t, h.do(http.MethodGet, "/api/v1/devices", "bogus", nil), http.StatusUnauthorized, codeUnauthorized)
}

func TestDevices(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	a := newAccount(t)
	first, second := h.session(a), h.session(a)
	h.clock.advance(2 * time.Minute)

	rec := h.do(http.MethodGet, "/api/v1/devices", second.Token, nil)
	ok(t, rec, http.StatusOK, "Devices")
	devices := decodeBody[struct{ Devices []deviceJSON }](t, rec).Devices
	if len(devices) != 2 {
		t.Fatalf("devices = %+v", devices)
	}
	for _, d := range devices {
		if d.Current != (d.ID == second.DeviceID) {
			t.Errorf("device %s current = %v", d.ID, d.Current)
		}
		if d.ID == second.DeviceID && d.LastSeen != h.clock.now().UnixMilli() {
			t.Errorf("lastSeen = %d, want now", d.LastSeen)
		}
	}

	other := h.session(newAccount(t))
	fails(t, h.do(http.MethodDelete, "/api/v1/devices/"+first.DeviceID, other.Token, nil), http.StatusNotFound, codeNotFound)

	ok(t, h.do(http.MethodDelete, "/api/v1/devices/"+first.DeviceID, second.Token, nil), http.StatusNoContent, "")
	fails(t, h.do(http.MethodGet, "/api/v1/devices", first.Token, nil), http.StatusUnauthorized, codeUnauthorized)
	fails(t, h.do(http.MethodDelete, "/api/v1/devices/"+first.DeviceID, second.Token, nil), http.StatusNotFound, codeNotFound)

	ok(t, h.do(http.MethodDelete, "/api/v1/session", second.Token, nil), http.StatusNoContent, "")
	fails(t, h.do(http.MethodGet, "/api/v1/devices", second.Token, nil), http.StatusUnauthorized, codeUnauthorized)
}

func (h *harness) push(token, id string, data []byte) int64 {
	h.t.Helper()
	req := map[string]string{"id": id, "data": b64(data)}
	validate(h.t, "BatchPush", mustJSON(h.t, req))
	rec := h.do(http.MethodPost, "/api/v1/batches", token, req)
	ok(h.t, rec, http.StatusOK, "BatchPushed")
	return decodeBody[struct{ Seq int64 }](h.t, rec).Seq
}

type batchesJSON struct {
	Batches       []dataJSON
	More          bool
	SinceSnapshot int64
}

func (h *harness) pull(token, query string) batchesJSON {
	h.t.Helper()
	rec := h.do(http.MethodGet, "/api/v1/batches"+query, token, nil)
	ok(h.t, rec, http.StatusOK, "Batches")
	return decodeBody[batchesJSON](h.t, rec)
}

func TestBatches(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	s := h.session(newAccount(t))
	other := h.session(newAccount(t))

	if got := h.pull(s.Token, ""); len(got.Batches) != 0 || got.More || got.SinceSnapshot != 0 {
		t.Errorf("empty pull = %+v", got)
	}

	seqs := []int64{h.push(s.Token, "a", []byte{1}), h.push(s.Token, "b", []byte{2})}
	h.push(other.Token, "a", []byte{9})
	seqs = append(seqs, h.push(s.Token, "c", []byte{3}))
	if again := h.push(s.Token, "b", []byte{2}); again != seqs[1] {
		t.Errorf("repeated push seq = %d, want %d", again, seqs[1])
	}
	if seqs[0] >= seqs[1] || seqs[1] >= seqs[2] {
		t.Errorf("seqs not increasing: %v", seqs)
	}

	page := h.pull(s.Token, "?limit=2")
	if len(page.Batches) != 2 || !page.More || page.SinceSnapshot != 3 || page.Batches[1].Seq != seqs[1] {
		t.Fatalf("first page = %+v", page)
	}
	page = h.pull(s.Token, "?limit=2&after="+itoa(seqs[1]))
	if len(page.Batches) != 1 || page.More || page.Batches[0].Seq != seqs[2] || page.Batches[0].Data != b64([]byte{3}) {
		t.Fatalf("second page = %+v", page)
	}

	for _, q := range []string{"?after=-1", "?after=x", "?limit=0"} {
		fails(t, h.do(http.MethodGet, "/api/v1/batches"+q, s.Token, nil), http.StatusBadRequest, codeBadRequest)
	}
	for _, req := range []string{`{"id":"has space","data":"AQ=="}`, `{"id":"a","data":""}`, `{"id":"a","data":"not base64!"}`} {
		fails(t, h.do(http.MethodPost, "/api/v1/batches", s.Token, req), http.StatusBadRequest, codeBadRequest)
	}
}

func TestBatchLimitCapped(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	s := h.session(newAccount(t))
	for i := range maxLimit + 1 {
		if _, _, err := h.store.PushBatch(t.Context(), s.Account, "b"+itoa(int64(i)), []byte{1}); err != nil {
			t.Fatal(err)
		}
	}
	if page := h.pull(s.Token, "?limit=5000"); len(page.Batches) != maxLimit || !page.More {
		t.Errorf("got %d batches, more %v", len(page.Batches), page.More)
	}
	if page := h.pull(s.Token, ""); len(page.Batches) != defaultLimit || !page.More {
		t.Errorf("got %d batches, more %v", len(page.Batches), page.More)
	}
}

func TestSnapshot(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	s := h.session(newAccount(t))
	fails(t, h.do(http.MethodGet, "/api/v1/snapshot", s.Token, nil), http.StatusNotFound, codeNotFound)

	var seqs []int64
	for _, id := range []string{"a", "b", "c"} {
		seqs = append(seqs, h.push(s.Token, id, []byte(id)))
	}
	put := func(seq int64) *httptest.ResponseRecorder {
		req := dataJSON{Seq: seq, Data: b64([]byte("snap"))}
		validate(t, "Snapshot", mustJSON(t, req))
		return h.do(http.MethodPut, "/api/v1/snapshot", s.Token, req)
	}

	fails(t, put(seqs[2]+1), http.StatusBadRequest, codeBadRequest)
	fails(t, h.do(http.MethodPut, "/api/v1/snapshot", s.Token, `{"seq":0,"data":"AQ=="}`), http.StatusBadRequest, codeBadRequest)
	ok(t, put(seqs[1]), http.StatusNoContent, "")
	fails(t, put(seqs[1]), http.StatusConflict, codeStaleSnapshot)
	fails(t, put(seqs[0]), http.StatusConflict, codeStaleSnapshot)

	rec := h.do(http.MethodGet, "/api/v1/snapshot", s.Token, nil)
	ok(t, rec, http.StatusOK, "Snapshot")
	if got := decodeBody[dataJSON](t, rec); got.Seq != seqs[1] || got.Data != b64([]byte("snap")) {
		t.Errorf("snapshot = %+v", got)
	}

	fails(t, h.do(http.MethodGet, "/api/v1/batches", s.Token, nil), http.StatusGone, codeCursorPruned)
	fails(t, h.do(http.MethodGet, "/api/v1/batches?after="+itoa(seqs[0]), s.Token, nil), http.StatusGone, codeCursorPruned)
	page := h.pull(s.Token, "?after="+itoa(seqs[1]))
	if len(page.Batches) != 1 || page.Batches[0].Seq != seqs[2] || page.SinceSnapshot != 1 {
		t.Errorf("after snapshot = %+v", page)
	}

	ok(t, put(seqs[2]), http.StatusNoContent, "")
	if page := h.pull(s.Token, "?after="+itoa(seqs[2])); len(page.Batches) != 0 || page.SinceSnapshot != 0 {
		t.Errorf("after full snapshot = %+v", page)
	}
	seq := h.push(s.Token, "d", []byte{4})
	if seq <= seqs[2] {
		t.Errorf("seq after pruning = %d, want > %d", seq, seqs[2])
	}
}

func TestSizeLimits(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	s := h.session(newAccount(t))

	ok(t, h.do(http.MethodPost, "/api/v1/batches", s.Token, map[string]string{"id": "max", "data": b64(make([]byte, maxBatch))}), http.StatusOK, "BatchPushed")
	fails(t, h.do(http.MethodPost, "/api/v1/batches", s.Token, map[string]string{"id": "big", "data": b64(make([]byte, maxBatch+1))}), http.StatusRequestEntityTooLarge, codeTooLarge)
	fails(t, h.do(http.MethodPost, "/api/v1/batches", s.Token, `{"id":"huge","data":"`+strings.Repeat("A", 2*maxBatch)+`"}`), http.StatusRequestEntityTooLarge, codeTooLarge)
	fails(t, h.do(http.MethodPost, "/api/v1/links", s.Token, map[string]string{"data": b64(make([]byte, maxLink+1))}), http.StatusRequestEntityTooLarge, codeTooLarge)
	fails(t, h.do(http.MethodPut, "/api/v1/snapshot", s.Token, dataJSON{Seq: 1, Data: b64(make([]byte, maxSnapshot+1))}), http.StatusRequestEntityTooLarge, codeTooLarge)
}

func TestLinks(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	s := h.session(newAccount(t))

	fails(t, h.do(http.MethodPost, "/api/v1/links", "", map[string]string{"data": "AQ=="}), http.StatusUnauthorized, codeUnauthorized)

	create := func() string {
		req := map[string]string{"data": b64([]byte("seed"))}
		validate(t, "LinkCreate", mustJSON(t, req))
		rec := h.do(http.MethodPost, "/api/v1/links", s.Token, req)
		ok(t, rec, http.StatusCreated, "LinkCreated")
		created := decodeBody[struct {
			ID      string
			Expires int64
		}](t, rec)
		if want := h.clock.now().Add(linkTTL).UnixMilli(); created.Expires != want {
			t.Errorf("expires = %d, want %d", created.Expires, want)
		}
		return created.ID
	}

	id := create()
	rec := h.do(http.MethodGet, "/api/v1/links/"+id, "", nil)
	ok(t, rec, http.StatusOK, "Link")
	if got := decodeBody[map[string]string](t, rec)["data"]; got != b64([]byte("seed")) {
		t.Errorf("data = %q", got)
	}
	fails(t, h.do(http.MethodGet, "/api/v1/links/"+id, "", nil), http.StatusNotFound, codeNotFound)

	id = create()
	h.clock.advance(linkTTL)
	fails(t, h.do(http.MethodGet, "/api/v1/links/"+id, "", nil), http.StatusNotFound, codeNotFound)
	fails(t, h.do(http.MethodGet, "/api/v1/links/unknown", "", nil), http.StatusNotFound, codeNotFound)
}

func TestEvents(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	srv := httptest.NewServer(h.handler)
	defer srv.Close()
	a := newAccount(t)
	s, other := h.session(a), h.session(newAccount(t))

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/api/v1/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+s.Token)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); res.StatusCode != http.StatusOK || ct != "text/event-stream" {
		t.Fatalf("status %d, content type %q", res.StatusCode, ct)
	}

	h.push(other.Token, "x", []byte{1})
	seq := h.push(h.session(a).Token, "y", []byte{2})

	lines := bufio.NewScanner(res.Body)
	var got []string
	for len(got) < 3 && lines.Scan() {
		got = append(got, lines.Text())
	}
	want := []string{"event: batch", `data: {"seq":` + itoa(seq) + `}`, ""}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("stream = %q, want %q", got, want)
	}
	validate(t, "BatchEvent", []byte(strings.TrimPrefix(got[1], "data: ")))
}

func TestEventsRequireAuth(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	fails(t, h.do(http.MethodGet, "/api/v1/events", "", nil), http.StatusUnauthorized, codeUnauthorized)
}

func TestCORS(t *testing.T) {
	h := newHarness(t, Config{}, nil)
	rec := h.do(http.MethodOptions, "/api/v1/batches", "", nil)
	ok(t, rec, http.StatusNoContent, "")
	for header, want := range map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
		"Access-Control-Allow-Headers": "Authorization, Content-Type",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	if got := h.do(http.MethodGet, "/api/v1/devices", "", nil).Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("allow origin on error = %q", got)
	}
}

func TestStatic(t *testing.T) {
	web := fstest.MapFS{
		"index.html":       {Data: []byte("<!doctype html>app")},
		"assets/app-1.js":  {Data: []byte("console.log(1)")},
		"assets/f.woff2":   {Data: []byte("font")},
		"favicon.svg":      {Data: []byte("<svg/>")},
		"assets/sub/x.css": {Data: []byte("a{}")},
	}
	h := newHarness(t, Config{}, web)

	for _, tc := range []struct {
		path, body, contentType, cache string
		status                         int
	}{
		{"/", "<!doctype html>app", "text/html; charset=utf-8", "no-cache", 200},
		{"/index.html", "<!doctype html>app", "text/html; charset=utf-8", "no-cache", 200},
		{"/lists/abc", "<!doctype html>app", "text/html; charset=utf-8", "no-cache", 200},
		{"/assets/app-1.js", "console.log(1)", "text/javascript; charset=utf-8", "public, max-age=31536000, immutable", 200},
		{"/assets/f.woff2", "font", "font/woff2", "public, max-age=31536000, immutable", 200},
		{"/assets/sub/x.css", "a{}", "text/css; charset=utf-8", "public, max-age=31536000, immutable", 200},
		{"/favicon.svg", "<svg/>", "image/svg+xml", "no-cache", 200},
		{"/assets/missing.js", "", "", "", http.StatusNotFound},
		{"/assets", "<!doctype html>app", "text/html; charset=utf-8", "no-cache", 200},
	} {
		rec := h.do(http.MethodGet, tc.path, "", nil)
		if rec.Code != tc.status {
			t.Errorf("%s: status = %d, want %d", tc.path, rec.Code, tc.status)
			continue
		}
		if tc.status != 200 {
			continue
		}
		if rec.Body.String() != tc.body || rec.Header().Get("Content-Type") != tc.contentType || rec.Header().Get("Cache-Control") != tc.cache {
			t.Errorf("%s: body %q, content type %q, cache %q", tc.path, rec.Body, rec.Header().Get("Content-Type"), rec.Header().Get("Cache-Control"))
		}
	}

	fails(t, h.do(http.MethodGet, "/api/v1/nope", "", nil), http.StatusNotFound, codeNotFound)
}

func TestStaticWithoutIndex(t *testing.T) {
	for _, web := range []fstest.MapFS{nil, {".gitkeep": {}}} {
		h := newHarness(t, Config{}, web)
		if rec := h.do(http.MethodGet, "/", "", nil); rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404", rec.Code)
		}
		ok(t, h.do(http.MethodGet, "/api/health", "", nil), http.StatusOK, "")
	}
}
