package persona

import (
	"context"
	"errors"
	"strings"

	"github.com/Burak-ML/rove/internal/provider"
	"github.com/Burak-ML/rove/internal/store"
	"github.com/Burak-ML/rove/internal/types"
)

// Resolved is the persona in effect for a session after combining the
// session's own choice, its profile, the character and the default profile.
type Resolved struct {
	SessionID   types.ID `json:"sessionId"`
	Source      string   `json:"source"` // none | character | profile | default-profile | features
	CharacterID string   `json:"characterId,omitempty"`
	ProfileID   types.ID `json:"profileId,omitempty"`
	Name        string   `json:"name,omitempty"`
	Title       string   `json:"title,omitempty"`
	// unassigned: an agent with nothing but its name to go on
	unassigned bool
	// Features is nil when nothing restricts the session (all tools on).
	Features    []string `json:"features"`
	ExtraPrompt string   `json:"extraPrompt,omitempty"`
	Prompt      string   `json:"prompt,omitempty"`
	Model       string   `json:"model,omitempty"`
	Provider    string   `json:"provider,omitempty"`
	// Integrations are the MCP servers the profile may use; nil: all.
	Integrations []string `json:"integrations,omitempty"`
}

// Resolve works out the persona for sessionID.
func Resolve(ctx context.Context, st *store.Store, sessionID types.ID) (Resolved, error) {
	r := Resolved{SessionID: sessionID, Source: "none"}
	sp, err := st.GetSessionPersona(ctx, sessionID)
	switch {
	case errors.Is(err, store.ErrNotFound):
		def, derr := st.GetDefaultProfile(ctx)
		if derr != nil || def == nil {
			return r, derr
		}
		r.fromProfile(*def, nil)
		r.Source = "default-profile"
	case err != nil:
		return r, err
	case sp.ProfileID != "":
		p, perr := st.GetAgentProfile(ctx, sp.ProfileID)
		if perr != nil {
			return r, perr
		}
		r.fromProfile(p, sp.Features)
		r.Source = "profile"
	case sp.CharacterID != "":
		if c, ok := CharacterByID(sp.CharacterID); ok {
			r.CharacterID, r.Name = c.ID, c.Name
			r.Prompt = c.Prompt
			r.Features = pick(sp.Features, c.Features)
			r.Source = "character"
		}
	default:
		if sp.Features != nil {
			r.Features = sp.Features
			r.Source = "features"
		}
	}
	if err == nil {
		r.ExtraPrompt = strings.TrimSpace(sp.ExtraPrompt)
	}
	r.Prompt = compose(r.Prompt, r.Features, r.ExtraPrompt)
	return r, nil
}

func (r *Resolved) fromProfile(p types.AgentProfile, override []string) {
	r.ProfileID, r.Name, r.Title, r.Model, r.Provider = p.ID, p.Name, p.Title, p.Model, p.Provider
	r.Integrations = p.Integrations
	// the character it was once started from only marks it now: an agent's
	// job comes from its name, its title and what the user wrote
	if c, ok := CharacterByID(p.CharacterID); ok {
		r.CharacterID = c.ID
	}
	base := strings.TrimSpace(p.SystemPrompt)
	r.unassigned = base == "" && p.Title == ""
	r.Prompt = base
	switch {
	case override != nil:
		r.Features = override
	case p.Features != nil:
		r.Features = p.Features
	case base != "":
		r.Features = DefaultFeatures
	}
}

// Identity tells an agent who it is. An agent may be made from a name alone:
// a name that says a job is its job, and one that does not is a reason to
// ask. Questions with set answers go in an ask block, which the app shows as
// a card to click (see lib/ask.ts); it works with every model, tools or not.
func (r Resolved) Identity() string {
	who := r.Name
	if r.Title != "" {
		who += ", " + r.Title
	}
	var b strings.Builder
	b.WriteString("## Who you are\nYou are " + who + ".\n")
	if r.unassigned {
		b.WriteString("Nobody has told you your job. If your name says it, take it as your role and work as a specialist in it. " +
			"If it does not (a person's name, a made-up word), find out what the user wants from you before anything else.\n")
	}
	b.WriteString("You do not write code or change files, and you have no tools for it. If you are asked to, say so and point the user to the Code space.\n\n" +
		"## Asking the user\nWhen the user should choose between a few directions, end your reply with this block and wait. " +
		"Two to five short options, in the user's language; the app adds a way to answer freely, so leave that out:\n" +
		"```ask\nThe question?\n- first option\n- second option\n```")
	return b.String()
}

// agentDenied are the tools an agent of the Agent space never gets, whatever
// its permissions say: writing code is the Code space's work.
var agentDenied = map[string]bool{"write_file": true, "patch_file": true, "shell": true, "git_commit": true}

// AgentMayUse reports whether an agent of the Agent space may have a tool.
func AgentMayUse(name string) bool { return !agentDenied[name] }

func pick(override, fallback []string) []string {
	if override != nil {
		return override
	}
	if fallback != nil {
		return fallback
	}
	return DefaultFeatures
}

// compose appends the enabled behavior rules and any extra instructions.
func compose(prompt string, features []string, extra string) string {
	var rules []string
	for _, k := range features {
		if f, ok := FeatureByKey(k); ok && f.Rule != "" {
			rules = append(rules, "- "+f.Rule)
		}
	}
	out := strings.TrimSpace(prompt)
	if len(rules) > 0 {
		if out != "" {
			out += "\n\n"
		}
		out += "Working rules:\n" + strings.Join(rules, "\n")
	}
	if extra != "" {
		if out != "" {
			out += "\n\n"
		}
		out += extra
	}
	return out
}

// AllowIntegration reports whether an MCP tool ("mcp_<server>_<tool>")
// comes from a server this persona may use. Other tools pass.
func (r Resolved) AllowIntegration(name string) bool {
	if r.Integrations == nil || !strings.HasPrefix(name, "mcp_") {
		return true
	}
	for _, s := range r.Integrations {
		if strings.TrimSpace(s) != "" && strings.HasPrefix(name, "mcp_"+types.MCPSlug(s)+"_") {
			return true
		}
	}
	return false
}

// AllowTool reports whether a tool may be offered to the model. Tools that
// belong to no known feature stay available, so new tools are not silently
// hidden.

func (r Resolved) AllowTool(name string) bool {
	if r.Features == nil {
		return true
	}
	on := map[string]bool{}
	for _, k := range r.Features {
		on[k] = true
	}
	for _, f := range Features {
		if f.Group != "tools" {
			continue
		}
		owns := f.Prefix != "" && strings.HasPrefix(name, f.Prefix)
		for _, t := range f.Tools {
			if t == name {
				owns = true
			}
		}
		if owns {
			return on[f.Key]
		}
	}
	return true
}

// Cost estimates the tokens the persona adds to every model request: its
// system prompt plus the schemas of the tools it leaves on.
type Cost struct {
	Prompt int `json:"prompt"`
	Tools  int `json:"tools"`
	Total  int `json:"total"`
	// ToolsOff counts tool schemas this persona keeps out of every request.
	ToolsOff int `json:"toolsOff"`
}

func (r Resolved) Cost(specs []provider.ToolSpec) Cost {
	c := Cost{Prompt: tokens(r.Prompt)}
	for _, s := range specs {
		n := tokens(s.Name) + tokens(s.Description) + tokens(string(s.Parameters))
		if r.AllowTool(s.Name) {
			c.Tools += n
		} else {
			c.ToolsOff++
		}
	}
	c.Total = c.Prompt + c.Tools
	return c
}

func tokens(s string) int { return (len([]rune(s)) + 3) / 4 }

// Match finds a character by id, name or tag prefix, for `/character go`.
func Match(q string) (Character, bool) {
	q = strings.ToLower(strings.TrimSpace(q))
	if q == "" {
		return Character{}, false
	}
	for _, c := range Characters {
		if c.ID == q || strings.ToLower(c.Name) == q {
			return c, true
		}
	}
	for _, c := range Characters {
		if strings.HasPrefix(c.ID, q) || strings.Contains(strings.ToLower(c.Name), q) {
			return c, true
		}
		for _, t := range c.Tags {
			if t == q {
				return c, true
			}
		}
	}
	return Character{}, false
}
