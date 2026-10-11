// Package web embeds the built web app.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:static
var static embed.FS

// FS returns the web app files, rooted at the static directory. It has no
// index.html unless the web build was copied into static before compiling.
func FS() fs.FS {
	sub, err := fs.Sub(static, "static")
	if err != nil {
		panic(err)
	}
	return sub
}
