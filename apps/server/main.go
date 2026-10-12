// Command server runs the Ergon sync server.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"ergon/server/internal/api"
	"ergon/server/internal/push"
	"ergon/server/internal/store"
	"ergon/server/internal/web"
)

// pushInterval is how often due reminders are sent.
const pushInterval = 15 * time.Second

func main() {
	if err := run(); err != nil {
		slog.Error("server", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(ctx, env("ERGON_DB", "ergon.db"), time.Now)
	if err != nil {
		return err
	}
	defer func() {
		if err := st.Close(); err != nil {
			slog.Error("close database", "err", err)
		}
	}()

	switch cmd := os.Args[1:]; {
	case len(cmd) == 0:
		return serve(ctx, st)
	case cmd[0] == "invite" && len(cmd) <= 2:
		n := 1
		if len(cmd) == 2 {
			if n, err = strconv.Atoi(cmd[1]); err != nil || n < 1 {
				return fmt.Errorf("invite: count must be a positive integer, got %q", cmd[1])
			}
		}
		codes, err := st.CreateInvites(ctx, n)
		if err != nil {
			return err
		}
		fmt.Println(strings.Join(codes, "\n"))
		return nil
	default:
		return fmt.Errorf("usage: %s [invite [n]]", os.Args[0])
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func serve(ctx context.Context, st *store.Store) error {
	addr := env("ERGON_ADDR", ":8080")
	cfg := api.Config{Registration: api.Registration(env("ERGON_REGISTRATION", string(api.RegistrationInvite)))}
	pusher, err := push.New(ctx, st, env("ERGON_VAPID_SUBJECT", "mailto:ergon@localhost"), nil, nil)
	if err != nil {
		return err
	}
	cfg.VAPID = pusher.PublicKey()
	switch cfg.Registration {
	case api.RegistrationOpen, api.RegistrationClosed:
	case api.RegistrationInvite:
		code, err := st.BootstrapInvite(ctx)
		if err != nil {
			return err
		}
		if code != "" {
			slog.Info("no accounts yet; register the first one with this invite", "invite", code)
		}
	default:
		return fmt.Errorf("ERGON_REGISTRATION must be open, invite or closed, got %q", cfg.Registration)
	}
	for key := range strings.SplitSeq(os.Getenv("ERGON_ALLOWLIST"), ",") {
		if key = strings.TrimSpace(key); key != "" {
			cfg.Allowlist = append(cfg.Allowlist, key)
		}
	}

	// Cancelled on shutdown so long-lived event streams end.
	baseCtx, cancelRequests := context.WithCancel(context.Background())
	defer cancelRequests()
	srv := &http.Server{
		Addr:              addr,
		Handler:           api.New(cfg, st, web.FS()),
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return baseCtx },
	}
	srv.RegisterOnShutdown(cancelRequests)
	go pusher.Run(ctx, pushInterval)

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			slog.Error("shutdown", "err", err)
		}
	}()

	slog.Info("listening", "addr", addr, "registration", cfg.Registration)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
