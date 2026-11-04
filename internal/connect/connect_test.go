package connect

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/Burak-ML/rove/internal/provider"
)

func TestCatalog(t *testing.T) {
	seen := map[string]bool{}
	for _, s := range Catalog {
		if seen[s.ID] {
			t.Fatalf("duplicate id %q", s.ID)
		}
		seen[s.ID] = true
		switch s.Kind {
		case KindAgent:
			if s.Bin == "" || s.Login == "" || len(s.Models) == 0 {
				t.Errorf("%s: an agent system needs a program, a sign-in and models", s.ID)
			}
		case KindAPI, KindLocal:
			if s.BaseURL == "" {
				t.Errorf("%s: an API needs its endpoint", s.ID)
			}
			if s.Kind == KindAPI && s.KeyURL == "" {
				t.Errorf("%s: where to get a key", s.ID)
			}
		default:
			t.Errorf("%s: kind %q", s.ID, s.Kind)
		}
	}
	for _, id := range []string{"claude-code", "codex", "antigravity", "kimi", "grok", "hermes", "openclaw"} {
		if !seen[id] {
			t.Errorf("missing %s", id)
		}
	}
}

// Only catalog agent systems open a terminal: never a command from outside,
// never an API entry.
func TestOpenTerminalRefuses(t *testing.T) {
	if err := OpenTerminal("rm -rf /", StepLogin); err == nil {
		t.Fatal("an unknown id must be refused")
	}
	if err := OpenTerminal("openai", StepLogin); err == nil {
		t.Fatal("an API entry has no terminal step")
	}
	if err := OpenTerminal("hermes", StepToken); err == nil {
		t.Fatal("a step the catalog does not give must be refused")
	}
}

func TestDetectCoversCatalog(t *testing.T) {
	st := Detect(context.Background(), nil)
	if len(st) != len(Catalog) {
		t.Fatalf("detect = %d, catalog = %d", len(st), len(Catalog))
	}
	for _, s := range st {
		if s.Kind != KindAgent && s.Installed {
			t.Errorf("%s: only programs are looked for", s.ID)
		}
	}
}

// Codex's models are the account's: read from its cache, hidden ones left
// out, the account's own default first.
func TestAccountModels(t *testing.T) {
	home := t.TempDir()
	t.Setenv("CODEX_HOME", home)
	cache := `{"models":[{"slug":"gpt-6.1-sol","visibility":"list"},{"slug":"gpt-reserve","visibility":"hide"},{"slug":"gpt-5.5","visibility":"list"}]}`
	if err := os.WriteFile(filepath.Join(home, "models_cache.json"), []byte(cache), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(AccountModels("codex"), ","); got != "default,gpt-6.1-sol,gpt-5.5" {
		t.Fatalf("codex models = %s", got)
	}
	// no catalog cached yet: the catalog's names stand in
	t.Setenv("CLAUDE_CONFIG_DIR", t.TempDir())
	if got := strings.Join(AccountModels("claude-code"), ","); got != "default,opus,sonnet,haiku" {
		t.Fatalf("claude models = %s", got)
	}
	t.Setenv("CODEX_HOME", t.TempDir())
	if got := strings.Join(AccountModels("codex"), ","); got != "default" {
		t.Fatalf("no cache: %s", got)
	}
}

func TestClaudeAndHermesModels(t *testing.T) {
	cl := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", cl)
	dir := filepath.Join(cl, "cache", "model-catalog")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	cat := `{"catalog":{"surface":"cc","config":{"models":[{"id":"claude-old","section":"overflow"},{"id":"claude-new","section":"main"}]}}}`
	_ = os.WriteFile(filepath.Join(dir, "acct-cc.json"), []byte(cat), 0o600)
	_ = os.WriteFile(filepath.Join(dir, "acct-ccd.json"), []byte(`{"catalog":{"config":{"models":[{"id":"desktop-only"}]}}}`), 0o600)
	if got := AccountModels(provider.SysClaudeCode); !slices.Equal(got, []string{"default", "claude-new", "claude-old"}) {
		t.Fatalf("claude = %v", got)
	}

	hm := t.TempDir()
	t.Setenv("HERMES_HOME", hm)
	_ = os.WriteFile(filepath.Join(hm, "config.yaml"), []byte("model:\n  default: m2\n  provider: p1\n"), 0o600)
	_ = os.WriteFile(filepath.Join(hm, "provider_models_cache.json"), []byte(`{"p1":{"models":["m1","m2"]},"p2":{"models":["x"]}}`), 0o600)
	if got := AccountModels(provider.SysHermes); !slices.Equal(got, []string{"default", "m2", "m1"}) {
		t.Fatalf("hermes = %v", got)
	}
}

func TestTokenEnv(t *testing.T) {
	keys := func(id string) (string, error) {
		if id == TokenSecret(provider.SysClaudeCode) {
			return "tok", nil
		}
		return "", os.ErrNotExist
	}
	if got := TokenEnv(provider.SysClaudeCode, keys); !slices.Equal(got, []string{"CLAUDE_CODE_OAUTH_TOKEN=tok"}) {
		t.Fatalf("env = %v", got)
	}
	if got := TokenEnv(provider.SysCodex, keys); got != nil {
		t.Fatalf("codex takes no token: %v", got)
	}
	if got := TokenEnv(provider.SysClaudeCode, func(string) (string, error) { return "", os.ErrNotExist }); got != nil {
		t.Fatalf("no token saved: %v", got)
	}
}

// Stand-in for `codex login`: says where to go, then waits for the person.
func TestBrowserLogin(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script stand-in")
	}
	dir := t.TempDir()
	log := filepath.Join(dir, "log")
	script := "#!/bin/sh\necho \"$1\" >> " + log + "\nif [ \"$1\" = login ]; then echo 'Open https://auth.example/x?y=1 to sign in'; sleep 1; fi\n"
	if err := os.WriteFile(filepath.Join(dir, "codex"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	u, err := BrowserLogin(provider.SysCodex, true)
	if err != nil || u != "https://auth.example/x?y=1" {
		t.Fatalf("url = %q, err = %v", u, err)
	}
	// a second click while it waits joins the same sign-in
	if again, err := BrowserLogin(provider.SysCodex, false); err != nil || again != u {
		t.Fatalf("again = %q, err = %v", again, err)
	}
	b, _ := os.ReadFile(log)
	if string(b) != "logout\nlogin\n" {
		t.Fatalf("ran: %q", b)
	}
	if _, err := BrowserLogin("openai", false); err == nil {
		t.Fatal("only a browser-login system can do this")
	}
	for i := 0; i < 40; i++ {
		loginMu.Lock()
		_, on := logins[provider.SysCodex]
		loginMu.Unlock()
		if !on {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("the finished sign-in must be forgotten")
}
