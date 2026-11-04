package rpc

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Burak-ML/rove/internal/connect"
	"github.com/Burak-ML/rove/internal/core"
	"github.com/Burak-ML/rove/internal/provider"
	"github.com/Burak-ML/rove/internal/types"
	"github.com/Burak-ML/rove/pkg/protocol"
)

func (s *Server) handleConnect(ctx context.Context, req protocol.Request) (json.RawMessage, error) {
	a := s.app
	var p struct {
		ID     string `json:"id"`
		Step   string `json:"step"`
		Access string `json:"access"`
		// connect.token: the token to keep; empty removes it
		Token string `json:"token"`
	}
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &p); err != nil {
			return nil, err
		}
	}
	switch req.Method {
	case protocol.MethodConnectCatalog:
		return core.MustJSON(connect.Detect(ctx, a.Secrets.Get)), nil
	case protocol.MethodConnectToken:
		sys, ok := connect.Find(p.ID)
		if !ok || sys.TokenEnv == "" {
			return nil, fmt.Errorf("%q takes no token", p.ID)
		}
		token := strings.TrimSpace(p.Token)
		if token == "" {
			_ = a.Secrets.Delete(connect.TokenSecret(p.ID))
			return core.MustJSON(map[string]any{"ok": true}), nil
		}
		if strings.ContainsAny(token, " \t\r\n") {
			return nil, fmt.Errorf("that does not look like a token: it has spaces in it")
		}
		if err := a.Secrets.Put(connect.TokenSecret(p.ID), token); err != nil {
			return nil, err
		}
		return core.MustJSON(map[string]any{"ok": true}), nil
	case protocol.MethodConnectBrowser:
		if p.Step == connect.StepLogout {
			if err := connect.RunLogout(p.ID); err != nil {
				return nil, err
			}
			return core.MustJSON(map[string]any{"ok": true}), nil
		}
		url, err := connect.BrowserLogin(p.ID, p.Step == connect.StepSwitch)
		if err != nil {
			return nil, err
		}
		return core.MustJSON(map[string]any{"url": url}), nil
	case protocol.MethodConnectTerminal:
		if !connect.ValidStep(p.Step) {
			return nil, fmt.Errorf("unknown step %q", p.Step)
		}
		if err := connect.OpenTerminal(p.ID, p.Step); err != nil {
			return nil, err
		}
		return core.MustJSON(map[string]any{"ok": true}), nil
	case protocol.MethodConnectAdd:
		sys, ok := connect.Find(p.ID)
		if !ok || sys.Kind != connect.KindAgent {
			return nil, fmt.Errorf("unknown agent system %q", p.ID)
		}
		if provider.FindBin(sys.Bin) == "" {
			return nil, fmt.Errorf("%s is not installed on this computer", sys.Name)
		}
		// one provider per system: adding again updates it
		list, err := a.Store.ListProviders(ctx)
		if err != nil {
			return nil, err
		}
		pv := types.Provider{Name: sys.Name, Kind: types.ProviderAgentCLI}
		for _, x := range list {
			if x.Kind == types.ProviderAgentCLI {
				if system, _, ok := provider.ParseAgentURL(x.BaseURL); ok && system == sys.ID {
					pv = x
				}
			}
		}
		access := p.Access
		if sys.FullOnly {
			access = "full"
		}
		pv.BaseURL = provider.AgentURL(sys.ID, access)
		pv.Models = nil
		out, err := a.SaveProvider(ctx, pv)
		return core.MustJSON(out), err
	}
	return nil, fmt.Errorf("unknown method %s", req.Method)
}
