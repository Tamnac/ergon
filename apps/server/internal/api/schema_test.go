package api

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

const schemaURL = "https://ergon.invalid/protocol/v1.schema.json"

// skippedFixtures lists fixtures known to be wrong, keyed by "Def/valid|invalid/index", with the reason.
var skippedFixtures = map[string]string{}

// protocolDir finds the repository's protocol directory above the working directory.
func protocolDir(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		p := filepath.Join(dir, "protocol")
		if _, err := os.Stat(filepath.Join(p, "v1.schema.json")); err == nil {
			return p
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("protocol/v1.schema.json not found above the working directory")
		}
		dir = parent
	}
}

var (
	schemaOnce sync.Once
	schemaErr  error
	compiler   *jsonschema.Compiler
	schemaMu   sync.Mutex
	schemas    = map[string]*jsonschema.Schema{}
)

func schema(t *testing.T, def string) *jsonschema.Schema {
	t.Helper()
	schemaOnce.Do(func() {
		var f *os.File
		if f, schemaErr = os.Open(filepath.Join(protocolDir(t), "v1.schema.json")); schemaErr != nil {
			return
		}
		defer f.Close()
		var doc any
		if doc, schemaErr = jsonschema.UnmarshalJSON(f); schemaErr != nil {
			return
		}
		compiler = jsonschema.NewCompiler()
		schemaErr = compiler.AddResource(schemaURL, doc)
	})
	if schemaErr != nil {
		t.Fatal(schemaErr)
	}
	schemaMu.Lock()
	defer schemaMu.Unlock()
	if s, ok := schemas[def]; ok {
		return s
	}
	s, err := compiler.Compile(schemaURL + "#/$defs/" + def)
	if err != nil {
		t.Fatal(err)
	}
	schemas[def] = s
	return s
}

// validate checks a JSON body against the protocol's $defs entry def.
func validate(t *testing.T, def string, body []byte) {
	t.Helper()
	v, err := jsonschema.UnmarshalJSON(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("%s: %v in %s", def, err, body)
	}
	if err := schema(t, def).Validate(v); err != nil {
		t.Errorf("%s doesn't match the schema: %v\nbody: %s", def, err, body)
	}
}

func TestFixtures(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(protocolDir(t), "fixtures", "v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixtures map[string]map[string][]json.RawMessage
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	defs := make([]string, 0, len(fixtures))
	for def := range fixtures {
		defs = append(defs, def)
	}
	sort.Strings(defs)
	for _, def := range defs {
		for _, kind := range []string{"valid", "invalid"} {
			for i, fixture := range fixtures[def][kind] {
				name := def + "/" + kind + "/" + strconv.Itoa(i)
				t.Run(name, func(t *testing.T) {
					if reason, ok := skippedFixtures[name]; ok {
						t.Skip(reason)
					}
					v, err := jsonschema.UnmarshalJSON(bytes.NewReader(fixture))
					if err != nil {
						t.Fatal(err)
					}
					err = schema(t, def).Validate(v)
					if kind == "valid" && err != nil {
						t.Errorf("valid fixture rejected: %v\n%s", err, fixture)
					}
					if kind == "invalid" && err == nil {
						t.Errorf("invalid fixture accepted: %s", fixture)
					}
				})
			}
		}
	}
}
