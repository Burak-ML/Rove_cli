package core

import (
	"context"
	"testing"

	"github.com/Burak-ML/rove/internal/config"
	"github.com/Burak-ML/rove/internal/types"
)

func TestOpenSeedsAndRecoversRunningGoals(t *testing.T) {
	dir := t.TempDir()
	app, err := Open(config.Config{DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	g, err := app.Goals.Create(ctx, types.Goal{Title: "mid-flight"})
	if err != nil {
		t.Fatal(err)
	}
	g.Status = types.GoalRunning
	if err := app.Store.UpsertGoal(ctx, g); err != nil {
		t.Fatal(err)
	}
	// a job of a kind an older version seeded is dropped on the next start
	if _, err := app.Auto.Upsert(ctx, types.AutomationJob{Name: "sweep ready", Kind: "sweep_ready", EverySeconds: 30}); err != nil {
		t.Fatal(err)
	}
	if err := app.Close(); err != nil {
		t.Fatal(err)
	}
	app2, err := Open(config.Config{DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	defer app2.Close()
	got, err := app2.Goals.Get(ctx, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != types.GoalPending {
		t.Fatalf("expected the interrupted goal back to pending, got %s", got.Status)
	}
	if jobs, _ := app2.Auto.List(ctx); len(jobs) != 0 {
		t.Fatalf("old jobs kept: %+v", jobs)
	}
	agents, err := app2.Agents.List(ctx)
	if err != nil || len(agents) == 0 {
		t.Fatalf("expected default agent")
	}
	if app2.Token == "" {
		t.Fatal("expected auth token")
	}
	h := app2.Health()
	if _, ok := h["totalTokens"]; !ok {
		t.Fatalf("health missing tokens: %v", h)
	}
	if _, ok := h["days"]; !ok {
		t.Fatalf("health missing days: %v", h)
	}
	if _, ok := h["activeAgents"]; !ok {
		t.Fatalf("health missing agents: %v", h)
	}
}

func TestApplyProviderHydratesRouterAndRetargetsAgent(t *testing.T) {
	dir := t.TempDir()
	app, err := Open(config.Config{DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	ctx := context.Background()
	if err := app.Secrets.Put("openai-key", "sk-test"); err != nil {
		t.Fatal(err)
	}
	p, err := app.ApplyProvider(ctx, types.Provider{
		Name:     "openai",
		Kind:     "openai_compat",
		BaseURL:  "https://api.openai.com/v1",
		Models:   []string{"gpt-4o"},
		SecretID: "openai-key",
	})
	if err != nil {
		t.Fatal(err)
	}
	if p.Kind != types.ProviderOpenAICompat {
		t.Fatalf("kind = %s", p.Kind)
	}
	c, err := app.Router.Get("openai")
	if err != nil {
		t.Fatal(err)
	}
	if c.Kind() != types.ProviderOpenAICompat {
		t.Fatalf("router kind = %s", c.Kind())
	}
	agents, err := app.Agents.List(ctx)
	if err != nil || len(agents) == 0 {
		t.Fatal(err)
	}
	if agents[0].Provider != "openai" || agents[0].Model != "gpt-4o" {
		t.Fatalf("agent still fake: %+v", agents[0])
	}
	resolved, model, err := app.Router.Resolve("default", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Name() != "openai" {
		t.Fatalf("resolve = %s model=%s", resolved.Name(), model)
	}
}

func TestDeleteProviderForgetsItAndReAddReplaces(t *testing.T) {
	app, err := Open(config.Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	ctx := context.Background()
	// models are given, so nothing is fetched over the network
	add := func(name string) types.Provider {
		if err := app.Secrets.Put(name+"-key", "sk-"+name); err != nil {
			t.Fatal(err)
		}
		p, err := app.ApplyProvider(ctx, types.Provider{Name: name, BaseURL: "http://127.0.0.1:1/v1", SecretID: name + "-key", Models: []string{name + "-m"}})
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	first := add("first")
	add("second")
	if !first.Default {
		t.Fatal("the first real provider should be the default")
	}
	if err := app.DeleteProvider(ctx, first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Router.Get("first"); err == nil {
		t.Fatal("a deleted provider still answers")
	}
	if _, err := app.Secrets.Get("first-key"); err == nil {
		t.Fatal("a deleted provider's key was kept")
	}
	if c, _, err := app.Router.Resolve("default", "", ""); err != nil || c.Name() != "second" {
		t.Fatalf("the default should move to the remaining provider, got %v %v", c, err)
	}
	// connecting the same name again replaces it rather than adding a twin
	add("second")
	list, _ := app.Store.ListProviders(ctx)
	n := 0
	for _, p := range list {
		if p.Name == "second" {
			n++
			if !p.Default {
				t.Fatal("re-adding the default lost its default")
			}
		}
	}
	if n != 1 {
		t.Fatalf("want one provider named second, got %d", n)
	}
}
