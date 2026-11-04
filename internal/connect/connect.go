// Package connect is the list of systems a user can connect their own
// account to — agent systems on this computer that sign in through the
// browser, model APIs that take a key, and local servers — with what it
// takes to install, sign in and use each. It finds what is already
// installed and signed in, and opens a terminal for the steps a person has
// to take themselves (an install, a browser sign-in).
package connect

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/Burak-ML/rove/internal/provider"
	"gopkg.in/yaml.v3"
)

// Kind of connection.
const (
	KindAgent = "agent" // a program on this computer, signed in with the user's account
	KindAPI   = "api"   // a model API that takes a key
	KindLocal = "local" // a server on this computer
)

// System is one entry of the catalog. Commands here are fixed: the app
// only ever runs these, picked by ID, never a command sent by a client.
type System struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Kind  string `json:"kind"`
	Blurb string `json:"blurb"`
	// agent systems
	Bin     string `json:"bin,omitempty"`
	Install string `json:"install,omitempty"`
	Login   string `json:"login,omitempty"`
	// Logout signs the account out, so another one can sign in
	Logout string `json:"logout,omitempty"`
	// TokenCmd makes a long-lived token the user pastes into Rove, and
	// TokenEnv is how the system is given it.
	TokenCmd string `json:"tokenCmd,omitempty"`
	TokenEnv string `json:"-"`
	// BrowserLogin signs in by itself in the browser: Rove runs Login in the
	// background, with no terminal.
	BrowserLogin bool `json:"browserLogin,omitempty"`
	// api and local servers: an OpenAI-compatible endpoint
	BaseURL string `json:"baseUrl,omitempty"`
	NeedKey bool   `json:"needKey,omitempty"`
	// KeyURL is where the user gets a key (opened in the system browser);
	// Docs is where to read more.
	KeyURL string   `json:"keyUrl,omitempty"`
	Docs   string   `json:"docs,omitempty"`
	Models []string `json:"models,omitempty"`
	// Free works with no account at all; signing in only adds more models.
	Free bool `json:"free,omitempty"`
}

// Catalog lists what can be connected.
var Catalog = []System{
	{ID: provider.SysClaudeCode, Name: "Claude Code", Kind: KindAgent, Bin: "claude",
		Blurb:   "Claude aboneliğin (Pro/Max) ya da Anthropic Console hesabınla; Claude Code kendi araçlarıyla sohbetin klasöründe çalışır.",
		Install: "curl -fsSL https://claude.ai/install.sh | bash", Login: "claude auth login", Logout: "claude auth logout",
		TokenCmd: "claude setup-token", TokenEnv: "CLAUDE_CODE_OAUTH_TOKEN",
		Docs: "https://docs.claude.com/en/docs/claude-code/overview", Models: []string{"default", "opus", "sonnet", "haiku"}},
	{ID: provider.SysCodex, Name: "Codex", Kind: KindAgent, Bin: "codex",
		Blurb:   "ChatGPT hesabın (Plus/Pro/Business) ya da OpenAI anahtarınla; Codex sohbetin klasöründe çalışır.",
		Install: "npm install -g @openai/codex", Login: "codex login", Logout: "codex logout", BrowserLogin: true,
		Docs: "https://developers.openai.com/codex/cli", Models: []string{"default"}},
	{ID: provider.SysAntigravity, Name: "Antigravity", Kind: KindAgent, Bin: "agy",
		Blurb:   "Google hesabınla Antigravity CLI; Gemini ve hesabındaki diğer modellerle sohbetin klasöründe çalışır.",
		Install: "curl -fsSL https://antigravity.google/cli/install.sh | bash", Login: "agy",
		Docs: "https://antigravity.google/docs/cli/best-practices/", Models: []string{"default"}},
	{ID: provider.SysHermes, Name: "Hermes Agent", Kind: KindAgent, Bin: "hermes",
		Blurb: "Nous Research'ün Hermes ajanı, kendi kurduğun sağlayıcı ve hesaplarla.",
		Login: "hermes model", Docs: "https://github.com/NousResearch/hermes-agent", Models: []string{"default"}},
	{ID: provider.SysOpenCode, Name: "OpenCode", Kind: KindAgent, Bin: "opencode", Free: true,
		Blurb:   "OpenCode'un ücretsiz modelleri hesap gerekmeden çalışır; istersen kendi sağlayıcılarını da ekleyebilirsin.",
		Install: "curl -fsSL https://opencode.ai/install | bash", Login: "opencode auth login", Logout: "opencode auth logout",
		Docs: "https://opencode.ai/docs", Models: []string{"default"}},
	{ID: "openclaw", Name: "OpenClaw", Kind: KindLocal, BaseURL: "http://127.0.0.1:18789/v1", NeedKey: true,
		Blurb: "Bilgisayarındaki OpenClaw gateway'i (OpenAI uyumlu uç nokta açık olmalı: gateway.http.endpoints.chatCompletions.enabled); anahtar olarak gateway token'ı."},
	{ID: "ollama", Name: "Ollama", Kind: KindLocal, BaseURL: "http://localhost:11434/v1",
		Blurb: "Bilgisayarında çalışan yerel modeller; anahtar gerekmez.", Docs: "https://ollama.com/download"},
	{ID: "openai", Name: "OpenAI", Kind: KindAPI, BaseURL: "https://api.openai.com/v1", NeedKey: true,
		Blurb: "OpenAI API anahtarınla GPT modelleri.", KeyURL: "https://platform.openai.com/api-keys"},
	{ID: "anthropic", Name: "Anthropic API", Kind: KindAPI, BaseURL: "https://api.anthropic.com/v1/", NeedKey: true,
		Blurb: "Anthropic Console anahtarınla Claude modelleri.", KeyURL: "https://console.anthropic.com/settings/keys"},
	{ID: "gemini", Name: "Google Gemini", Kind: KindAPI, BaseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", NeedKey: true,
		Blurb: "Google AI Studio anahtarınla Gemini modelleri.", KeyURL: "https://aistudio.google.com/apikey"},
	{ID: "openrouter", Name: "OpenRouter", Kind: KindAPI, BaseURL: "https://openrouter.ai/api/v1", NeedKey: true,
		Blurb: "Tek anahtarla birçok sağlayıcının modelleri.", KeyURL: "https://openrouter.ai/keys"},
	{ID: "deepseek", Name: "DeepSeek", Kind: KindAPI, BaseURL: "https://api.deepseek.com/v1", NeedKey: true,
		Blurb: "DeepSeek API anahtarınla.", KeyURL: "https://platform.deepseek.com/api_keys"},
	{ID: "xai", Name: "xAI Grok", Kind: KindAPI, BaseURL: "https://api.x.ai/v1", NeedKey: true,
		Blurb: "xAI anahtarınla Grok modelleri.", KeyURL: "https://console.x.ai"},
	{ID: "groq", Name: "Groq", Kind: KindAPI, BaseURL: "https://api.groq.com/openai/v1", NeedKey: true,
		Blurb: "Groq anahtarınla hızlı açık modeller.", KeyURL: "https://console.groq.com/keys"},
	{ID: "mistral", Name: "Mistral", Kind: KindAPI, BaseURL: "https://api.mistral.ai/v1", NeedKey: true,
		Blurb: "Mistral anahtarınla.", KeyURL: "https://console.mistral.ai/api-keys"},
}

// Find returns a catalog entry by ID.
func Find(id string) (System, bool) {
	for _, s := range Catalog {
		if s.ID == id {
			return s, true
		}
	}
	return System{}, false
}

// Status is a catalog entry with what was found on this computer.
type Status struct {
	System
	Installed bool   `json:"installed"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
	// LoggedIn is nil when the system has no way to ask
	LoggedIn *bool  `json:"loggedIn,omitempty"`
	Account  string `json:"account,omitempty"`
	// TokenSaved says a token is kept for it in Rove
	TokenSaved bool `json:"tokenSaved,omitempty"`
}

// Keys reads a stored secret: secrets.Store.Get.
type Keys func(id string) (string, error)

// TokenSecret is where a system's token is kept.
func TokenSecret(id string) string { return id + "-token" }

// TokenEnv is what a system's process gets for the token saved for it.
func TokenEnv(id string, keys Keys) []string {
	s, ok := Find(id)
	if !ok || s.TokenEnv == "" || keys == nil {
		return nil
	}
	v, err := keys(TokenSecret(id))
	if err != nil || v == "" {
		return nil
	}
	return []string{s.TokenEnv + "=" + v}
}

// Detect looks at every agent system: installed, which version, signed in.
// Each check is short; they run side by side.
func Detect(ctx context.Context, keys Keys) []Status {
	out := make([]Status, len(Catalog))
	var wg sync.WaitGroup
	for i, s := range Catalog {
		out[i] = Status{System: s}
		if s.Kind != KindAgent {
			continue
		}
		wg.Add(1)
		go func(st *Status) {
			defer wg.Done()
			st.Path = provider.FindBin(st.Bin)
			if st.Path == "" {
				return
			}
			st.Installed = true
			st.Version = firstLine(run(ctx, nil, st.Path, "--version"))
			env := TokenEnv(st.ID, keys)
			st.TokenSaved = len(env) > 0
			st.LoggedIn, st.Account = signedIn(ctx, st.ID, st.Path, env)
		}(&out[i])
	}
	wg.Wait()
	return out
}

func signedIn(ctx context.Context, id, bin string, env []string) (*bool, string) {
	yes, no := true, false
	switch id {
	case provider.SysClaudeCode:
		var st struct {
			LoggedIn   bool   `json:"loggedIn"`
			AuthMethod string `json:"authMethod"`
			Email      string `json:"email"`
		}
		if json.Unmarshal([]byte(run(ctx, env, bin, "auth", "status", "--json")), &st) != nil {
			return nil, ""
		}
		if !st.LoggedIn {
			return &no, ""
		}
		return &yes, strings.TrimSpace(st.Email + " " + st.AuthMethod)
	case provider.SysCodex:
		s := run(ctx, nil, bin, "login", "status")
		switch {
		case strings.Contains(strings.ToLower(s), "not logged in"):
			return &no, ""
		case strings.Contains(strings.ToLower(s), "logged in"):
			return &yes, firstLine(s)
		}
	case provider.SysHermes:
		// it signs in by setting up a provider of its own
		if p := hermesProvider(); p != "" {
			return &yes, p
		}
		return &no, ""
	case provider.SysOpenCode:
		// nothing to sign in to for the free models: only a saved account shows
		if s := run(ctx, nil, bin, "auth", "list"); s != "" && !strings.Contains(s, "No authenticated") {
			return &yes, firstLine(s)
		}
	}
	return nil, ""
}

func run(ctx context.Context, env []string, bin string, args ...string) string {
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Env = append(append(os.Environ(), "PATH="+provider.PathFor(bin), "NO_COLOR=1"), env...)
	b, _ := cmd.CombinedOutput()
	return strings.TrimSpace(string(b))
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

// Step is what a person does in a terminal: install the system, sign in
// (which opens their browser), sign out, or sign out and in with another
// account.
const (
	StepInstall = "install"
	StepLogin   = "login"
	StepLogout  = "logout"
	StepSwitch  = "switch"
	StepToken   = "token"
)

// ValidStep reports whether a client may ask for this step.
func ValidStep(step string) bool {
	switch step {
	case StepInstall, StepLogin, StepLogout, StepSwitch, StepToken:
		return true
	}
	return false
}

// OpenTerminal runs a catalog system's install or sign-in command in a new
// window of the system terminal, where the person can follow and answer it.
func OpenTerminal(id, step string) error {
	s, ok := Find(id)
	if !ok || s.Kind != KindAgent {
		return fmt.Errorf("unknown agent system %q", id)
	}
	// the program by its full path: a terminal's PATH may not have it
	withBin := func(c string) string {
		if bin := provider.FindBin(s.Bin); bin != "" && c != "" {
			return strings.Replace(c, s.Bin, shellQuote(bin), 1)
		}
		return c
	}
	var cmd string
	switch step {
	case StepInstall:
		cmd = s.Install
	case StepLogin:
		cmd = withBin(s.Login)
	case StepLogout:
		cmd = withBin(s.Logout)
	case StepToken:
		cmd = withBin(s.TokenCmd)
	case StepSwitch:
		if s.Logout != "" && s.Login != "" {
			sep := " && "
			if runtime.GOOS == "windows" {
				sep = " & "
			}
			cmd = withBin(s.Logout) + sep + withBin(s.Login)
		}
	}
	if cmd == "" {
		return errors.New("this step is not available for " + s.Name)
	}
	switch runtime.GOOS {
	case "darwin":
		script := fmt.Sprintf(`tell application "Terminal"
activate
do script %q
end tell`, cmd)
		return exec.Command("osascript", "-e", script).Start()
	case "windows":
		return exec.Command("cmd", "/c", "start", "cmd", "/k", cmd).Start()
	default:
		for _, t := range []string{"x-terminal-emulator", "gnome-terminal", "konsole", "xterm"} {
			if p, err := exec.LookPath(t); err == nil {
				if t == "gnome-terminal" {
					return exec.Command(p, "--", "sh", "-c", cmd+"; exec $SHELL").Start()
				}
				return exec.Command(p, "-e", "sh", "-c", cmd+"; exec $SHELL").Start()
			}
		}
		return errors.New("no terminal found; run this yourself: " + cmd)
	}
}

// How long a browser sign-in may wait for the person, and for the program
// to say where the browser should go.
const (
	browserLoginWait = 10 * time.Minute
	browserURLWait   = 4 * time.Second
)

var (
	loginMu sync.Mutex
	// the sign-ins under way, by system, and the address each one gave
	logins = map[string]string{}
	urlRe  = regexp.MustCompile(`https://\S+`)
)

// BrowserLogin signs a system in without a terminal: its own login command
// runs in the background, opens the browser and finishes by itself when the
// person approves. The address it printed comes back, for a browser that did
// not open. With fresh set it signs out first, to use another account.
func BrowserLogin(id string, fresh bool) (string, error) {
	s, ok := Find(id)
	if !ok || !s.BrowserLogin {
		return "", fmt.Errorf("%q does not sign in through the browser", id)
	}
	bin := provider.FindBin(s.Bin)
	if bin == "" {
		return "", fmt.Errorf("%s is not installed on this computer", s.Name)
	}
	loginMu.Lock()
	if u, on := logins[id]; on {
		loginMu.Unlock()
		return u, nil // one is waiting for the person already
	}
	logins[id] = ""
	loginMu.Unlock()
	if fresh {
		if err := RunLogout(id); err != nil {
			forget(id)
			return "", err
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), browserLoginWait)
	cmd := exec.CommandContext(ctx, bin, strings.Fields(s.Login)[1:]...)
	cmd.Env = append(os.Environ(), "PATH="+provider.PathFor(bin), "NO_COLOR=1")
	r, w := io.Pipe()
	cmd.Stdout, cmd.Stderr = w, w
	if err := cmd.Start(); err != nil {
		cancel()
		forget(id)
		return "", err
	}
	found := make(chan string, 1)
	go func() {
		sc := bufio.NewScanner(r)
		sent := false
		for sc.Scan() {
			if u := urlRe.FindString(sc.Text()); u != "" && !sent {
				sent = true
				loginMu.Lock()
				logins[id] = u
				loginMu.Unlock()
				found <- u
			}
		}
	}()
	ended := make(chan error, 1)
	go func() {
		err := cmd.Wait()
		w.Close()
		cancel()
		forget(id)
		ended <- err
	}()
	select {
	case u := <-found:
		return u, nil
	case err := <-ended:
		if err != nil {
			return "", fmt.Errorf("%s sign-in stopped: %w", s.Name, err)
		}
		return "", nil
	case <-time.After(browserURLWait):
		return "", nil // still running: the browser may well have opened
	}
}

func forget(id string) {
	loginMu.Lock()
	delete(logins, id)
	loginMu.Unlock()
}

// RunLogout signs a browser-login system out, with no terminal.
func RunLogout(id string) error {
	s, ok := Find(id)
	if !ok || !s.BrowserLogin || s.Logout == "" {
		return fmt.Errorf("%q has no sign-out to run", id)
	}
	bin := provider.FindBin(s.Bin)
	if bin == "" {
		return fmt.Errorf("%s is not installed on this computer", s.Name)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, strings.Fields(s.Logout)[1:]...)
	cmd.Env = append(os.Environ(), "PATH="+provider.PathFor(bin), "NO_COLOR=1")
	return cmd.Run()
}

func shellQuote(s string) string {
	if !strings.ContainsAny(s, " '\"\\$`") {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// AccountModels lists the models a connected agent system offers the
// account it is signed in to, with "default" (the account's own pick)
// first. Each system keeps the list its account was given in a cache of its
// own; when that is not there yet, the names in the catalog stand in.
func AccountModels(id string) []string {
	out := []string{"default"}
	var names []string
	switch id {
	case provider.SysCodex:
		names = codexModels()
	case provider.SysClaudeCode:
		names = claudeModels()
	case provider.SysHermes:
		names = hermesModels()
	case provider.SysOpenCode:
		names = openCodeModels()
	}
	if len(names) > 0 {
		return append(out, names...)
	}
	if s, ok := Find(id); ok {
		for _, m := range s.Models {
			if m != "default" {
				out = append(out, m)
			}
		}
	}
	return out
}

// codexModels reads ~/.codex/models_cache.json (or $CODEX_HOME's): the
// models the signed-in account may pick, in Codex's own order, without the
// ones it hides from its own picker.
func codexModels() []string {
	home := homeDir("CODEX_HOME", ".codex")
	b, err := os.ReadFile(filepath.Join(home, "models_cache.json"))
	if err != nil {
		return nil
	}
	var cache struct {
		Models []struct {
			Slug       string `json:"slug"`
			Visibility string `json:"visibility"`
		} `json:"models"`
	}
	if json.Unmarshal(b, &cache) != nil {
		return nil
	}
	var out []string
	for _, m := range cache.Models {
		if m.Slug != "" && (m.Visibility == "" || m.Visibility == "list") {
			out = append(out, m.Slug)
		}
	}
	return out
}

func homeDir(env, sub string) string {
	if h := os.Getenv(env); h != "" {
		return h
	}
	h, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(h, sub)
}

// claudeModels reads the model catalog Claude Code keeps for the signed-in
// account (~/.claude/cache/model-catalog): the newest one for the CLI, its
// main models first, then the older ones it still offers.
func claudeModels() []string {
	dir := filepath.Join(homeDir("CLAUDE_CONFIG_DIR", ".claude"), "cache", "model-catalog")
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	var newest string
	var newestAt time.Time
	var cat struct {
		Catalog struct {
			Surface string `json:"surface"`
			Config  struct {
				Models []struct {
					ID      string `json:"id"`
					Section string `json:"section"`
				} `json:"models"`
			} `json:"config"`
		} `json:"catalog"`
	}
	for _, f := range files {
		if !strings.HasSuffix(f, "-cc.json") {
			continue
		}
		if fi, err := os.Stat(f); err == nil && fi.ModTime().After(newestAt) {
			newest, newestAt = f, fi.ModTime()
		}
	}
	if newest == "" {
		return nil
	}
	b, err := os.ReadFile(newest)
	if err != nil || json.Unmarshal(b, &cat) != nil {
		return nil
	}
	var main, more []string
	for _, m := range cat.Catalog.Config.Models {
		switch {
		case m.ID == "":
		case m.Section == "main":
			main = append(main, m.ID)
		default:
			more = append(more, m.ID)
		}
	}
	return append(main, more...)
}

// openCodeModels asks OpenCode what it can run now: with no account that is
// its free models. The free ones come first, whatever else is connected.
func openCodeModels() []string {
	bin := provider.FindBin("opencode")
	if bin == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var free, more []string
	for _, l := range strings.Split(run(ctx, nil, bin, "models"), "\n") {
		m := strings.TrimSpace(l)
		switch {
		case !strings.Contains(m, "/") || strings.ContainsAny(m, " \t"):
		case strings.HasPrefix(m, "opencode/"):
			free = append(free, m)
		default:
			more = append(more, m)
		}
	}
	return append(free, more...)
}

// hermesProvider is the provider Hermes is set to use, if it has one yet.
func hermesProvider() string {
	b, err := os.ReadFile(filepath.Join(homeDir("HERMES_HOME", ".hermes"), "config.yaml"))
	if err != nil {
		return ""
	}
	var cfg struct {
		Model struct {
			Provider string `yaml:"provider"`
		} `yaml:"model"`
	}
	if yaml.Unmarshal(b, &cfg) != nil {
		return ""
	}
	return cfg.Model.Provider
}

// hermesModels lists the models of the provider Hermes is set to use
// (~/.hermes/config.yaml), from the list Hermes keeps for it; its own
// default model comes first. A model of another provider would not run
// without switching Hermes over, so those are left out.
func hermesModels() []string {
	home := homeDir("HERMES_HOME", ".hermes")
	b, err := os.ReadFile(filepath.Join(home, "config.yaml"))
	if err != nil {
		return nil
	}
	var cfg struct {
		Model struct {
			Default  string `yaml:"default"`
			Provider string `yaml:"provider"`
		} `yaml:"model"`
	}
	if yaml.Unmarshal(b, &cfg) != nil || cfg.Model.Provider == "" {
		return nil
	}
	var cache map[string]struct {
		Models []string `json:"models"`
	}
	var out []string
	if cb, err := os.ReadFile(filepath.Join(home, "provider_models_cache.json")); err == nil && json.Unmarshal(cb, &cache) == nil {
		out = cache[cfg.Model.Provider].Models
	}
	if d := cfg.Model.Default; d != "" {
		rest := slices.DeleteFunc(slices.Clone(out), func(m string) bool { return m == d })
		out = append([]string{d}, rest...)
	}
	return out
}
