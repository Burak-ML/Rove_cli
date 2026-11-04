package agentlink

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Burak-ML/rove/internal/agent"
	"github.com/Burak-ML/rove/internal/session"
	"github.com/Burak-ML/rove/internal/store"
	"github.com/Burak-ML/rove/internal/tool"
	"github.com/Burak-ML/rove/internal/types"
)

func setup(t *testing.T) (*Desk, *store.Store, types.ID) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ctx := context.Background()
	d := New(st, session.New(st, nil), nil)
	d.DefaultAgent = func(context.Context) (types.ID, error) { return "ag", nil }
	me, err := d.Create(ctx, "Ayşe", "", "")
	if err != nil {
		t.Fatal(err)
	}
	s, err := d.sess.CreateIn(ctx, types.SpaceOffice, "x", "ag", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.PutSessionPersona(ctx, types.SessionPersona{SessionID: s.ID, ProfileID: me.ID, UpdatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	return d, st, s.ID
}

func args(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestMessageRunsInTheOtherAgentsChat(t *testing.T) {
	d, _, chat := setup(t)
	ctx := context.Background()
	if _, err := d.Create(ctx, "Mert", "", ""); err != nil {
		t.Fatal(err)
	}
	var got agent.RunRequest
	d.Run = func(_ context.Context, r agent.RunRequest) (agent.RunResult, error) {
		got = r
		// while it answers, it cannot go on to message someone else
		res, _ := MessageTool{D: d}.Call(ctx, tool.Context{SessionID: r.SessionID}, args(t, map[string]string{"agent": "Ayşe", "message": "x"}))
		if !res.IsError {
			t.Fatal("an agent that is answering must not message on")
		}
		return agent.RunResult{Assistant: "tamam"}, nil
	}
	res, err := MessageTool{D: d}.Call(ctx, tool.Context{SessionID: chat}, args(t, map[string]string{"agent": "mert", "message": "Rapor hazır mı?"}))
	if err != nil || res.IsError {
		t.Fatalf("res = %+v, err = %v", res, err)
	}
	if !strings.Contains(res.Content, "tamam") || !strings.Contains(got.UserMessage, "Ayşe") || got.SessionID == chat {
		t.Fatalf("res = %q, run = %+v", res.Content, got)
	}
	if d.Answering(got.SessionID) {
		t.Fatal("the mark must clear with the answer")
	}
	// the next message goes to the same chat
	first := got.SessionID
	if _, err := (MessageTool{D: d}).Call(ctx, tool.Context{SessionID: chat}, args(t, map[string]string{"agent": "Mert", "message": "Bir de bu"})); err != nil {
		t.Fatal(err)
	}
	if got.SessionID != first {
		t.Fatalf("second message went to %s, not %s", got.SessionID, first)
	}
}

func TestMessageWaitsForNobody(t *testing.T) {
	d, _, chat := setup(t)
	ctx := context.Background()
	if _, err := d.Create(ctx, "Mert", "", ""); err != nil {
		t.Fatal(err)
	}
	d.Running = func(types.ID) bool { return true }
	d.Run = func(context.Context, agent.RunRequest) (agent.RunResult, error) {
		t.Fatal("a busy agent must not be run")
		return agent.RunResult{}, nil
	}
	res, _ := MessageTool{D: d}.Call(ctx, tool.Context{SessionID: chat}, args(t, map[string]string{"agent": "Mert", "message": "x"}))
	if !res.IsError || !strings.Contains(res.Content, "busy") {
		t.Fatalf("res = %+v", res)
	}
	res, _ = MessageTool{D: d}.Call(ctx, tool.Context{SessionID: chat}, args(t, map[string]string{"agent": "Ayşe", "message": "x"}))
	if !res.IsError {
		t.Fatal("an agent does not message itself")
	}
}

func TestCreate(t *testing.T) {
	d, st, chat := setup(t)
	ctx := context.Background()
	res, err := CreateTool{D: d}.Call(ctx, tool.Context{SessionID: chat}, args(t, map[string]string{"name": "Kapak tasarımcısı", "title": "Tasarımcı", "instructions": "Kısa yaz."}))
	if err != nil || res.IsError {
		t.Fatalf("res = %+v, err = %v", res, err)
	}
	all, _ := st.ListAgentProfiles(ctx)
	if len(all) != 2 {
		t.Fatalf("agents = %d", len(all))
	}
	res, _ = CreateTool{D: d}.Call(ctx, tool.Context{SessionID: chat}, args(t, map[string]string{"name": "kapak TASARIMCISI"}))
	if !res.IsError {
		t.Fatal("two agents cannot share a name")
	}
	res, _ = CreateTool{D: d}.Call(ctx, tool.Context{SessionID: "other"}, args(t, map[string]string{"name": "Yeni"}))
	if !res.IsError {
		t.Fatal("a chat without an agent cannot make one")
	}
}
