package api

import (
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

// static serves the web app from fsys, falling back to index.html for paths
// that aren't files. API paths and a missing index.html give 404.
func init() {
	// Not in Go's built-in table, and the distroless image has no /etc/mime.types.
	_ = mime.AddExtensionType(".woff", "font/woff")
	_ = mime.AddExtensionType(".woff2", "font/woff2")
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

func static(fsys fs.FS) http.Handler {
	hasIndex := false
	if fsys != nil {
		_, err := fs.Stat(fsys, "index.html")
		hasIndex = err == nil
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeError(w, http.StatusNotFound, codeNotFound, "no such endpoint")
			return
		}
		if !hasIndex {
			http.NotFound(w, r)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if serveFile(w, r, fsys, name) {
			return
		}
		if strings.HasPrefix(name, "assets/") {
			http.NotFound(w, r)
			return
		}
		serveFile(w, r, fsys, "index.html")
	})
}

// serveFile serves the regular file name from fsys and reports whether it exists.
func serveFile(w http.ResponseWriter, r *http.Request, fsys fs.FS, name string) bool {
	if name == "" || name == "." {
		name = "index.html"
	}
	f, err := fsys.Open(name)
	if err != nil {
		return false
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		return false
	}
	content, ok := f.(io.ReadSeeker)
	if !ok {
		return false
	}
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeContent(w, r, name, info.ModTime(), content)
	return true
}
