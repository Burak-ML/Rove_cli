package rpc

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/Burak-ML/rove/internal/config"
	"github.com/Burak-ML/rove/internal/connect"
	"github.com/Burak-ML/rove/internal/core"
	"github.com/Burak-ML/rove/internal/provider"
	"github.com/Burak-ML/rove/pkg/protocol"
)

func TestConnectToken(t *testing.T) {
	app, err := core.Open(config.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	s := New(app)
	call := func(params any) string {
		raw, _ := json.Marshal(params)
		return s.Dispatch(context.Background(), protocol.Request{Method: protocol.MethodConnectToken, Token: app.Token, Params: raw}).Error
	}
	id := provider.SysClaudeCode
	if e := call(map[string]string{"id": "codex", "token": "x"}); e == "" {
		t.Fatal("codex takes no token")
	}
	if e := call(map[string]string{"id": id, "token": "two words"}); e == "" {
		t.Fatal("a pasted sentence is not a token")
	}
	if e := call(map[string]string{"id": id, "token": "  test-token\n"}); e != "" {
		t.Fatal(e)
	}
	if env := connect.TokenEnv(id, app.Secrets.Get); len(env) != 1 || env[0] != "CLAUDE_CODE_OAUTH_TOKEN=test-token" {
		t.Fatalf("env = %v", env)
	}
	if e := call(map[string]string{"id": id, "token": ""}); e != "" {
		t.Fatal(e)
	}
	if env := connect.TokenEnv(id, app.Secrets.Get); env != nil {
		t.Fatalf("the token must be gone: %v", env)
	}
}
