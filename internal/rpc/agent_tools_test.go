package rpc

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/Burak-ML/rove/internal/agentlink"
	"github.com/Burak-ML/rove/internal/config"
	"github.com/Burak-ML/rove/internal/core"
	"github.com/Burak-ML/rove/internal/team"
	"github.com/Burak-ML/rove/internal/types"
	"github.com/Burak-ML/rove/pkg/protocol"
)

// An agent of the Agent space talks and reads; writing code is the Code
// space's work. This is checked on what each chat is really offered.
func TestAgentAndCodeChatsGetDifferentTools(t *testing.T) {
	app, err := core.Open(config.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	s := New(app)
	ctx := context.Background()
	call := func(method string, params, out any) {
		t.Helper()
		raw, _ := json.Marshal(params)
		resp := s.Dispatch(ctx, protocol.Request{Method: method, Token: app.Token, Params: raw})
		if resp.Error != "" {
			t.Fatalf("%s: %s", method, resp.Error)
		}
		if out != nil {
			_ = json.Unmarshal(resp.Result, out)
		}
	}
	var agent types.AgentProfile
	call(protocol.MethodProfileUpsert, map[string]any{"name": "Siber güvenlik"}, &agent)
	var office, code types.Session
	call(protocol.MethodSessionCreate, map[string]any{"space": "office", "profileIds": []types.ID{agent.ID}}, &office)
	call(protocol.MethodSessionCreate, map[string]any{"space": "chat"}, &code)

	offered := func(sid types.ID, name string) bool { return app.Agents.PersonaFor(ctx, sid).Allows(name) }
	for _, name := range []string{"write_file", "patch_file", "shell", "git_commit", team.DelegateName} {
		if offered(office.ID, name) {
			t.Errorf("an agent must not get %s", name)
		}
		if !offered(code.ID, name) {
			t.Errorf("a Code chat must get %s", name)
		}
	}
	for _, name := range []string{"read_file", "list_dir", agentlink.MessageName, agentlink.CreateName} {
		if !offered(office.ID, name) {
			t.Errorf("an agent must get %s", name)
		}
	}
	for _, name := range []string{agentlink.MessageName, agentlink.CreateName} {
		if offered(code.ID, name) {
			t.Errorf("a Code chat has no use for %s", name)
		}
	}
}
