package service

import (
	"context"
	"errors"
	"net/http"
	"testing"

	pluginerrors "github.com/kumiho-plugin/kumiho-plugin-sdk/errors"
)

func TestNewPluginAuthServiceUsesTimeoutForDefaultClient(t *testing.T) {
	service := NewPluginAuthService(nil)
	if service.client == nil {
		t.Fatal("client = nil, want default client")
	}
	if service.client.Timeout != defaultPluginAuthTimeout {
		t.Fatalf("timeout = %v, want %v", service.client.Timeout, defaultPluginAuthTimeout)
	}
}

func TestNewPluginAuthServiceKeepsProvidedClient(t *testing.T) {
	client := &http.Client{}
	service := NewPluginAuthService(client)
	if service.client != client {
		t.Fatal("client was replaced unexpectedly")
	}
}

type timeoutNetError struct{}

func (timeoutNetError) Error() string   { return "timeout" }
func (timeoutNetError) Timeout() bool   { return true }
func (timeoutNetError) Temporary() bool { return false }

func TestClassifyPluginAuthErrorReturnsTimeoutForDeadlineExceeded(t *testing.T) {
	err := classifyPluginAuthError(context.DeadlineExceeded)

	var pluginErr *pluginerrors.PluginError
	if !errors.As(err, &pluginErr) {
		t.Fatalf("error = %T, want *PluginError", err)
	}
	if pluginErr.Code != pluginerrors.ErrCodeTimeout {
		t.Fatalf("code = %q, want %q", pluginErr.Code, pluginerrors.ErrCodeTimeout)
	}
}

func TestClassifyPluginAuthErrorReturnsTimeoutForTimeoutNetError(t *testing.T) {
	err := classifyPluginAuthError(timeoutNetError{})

	var pluginErr *pluginerrors.PluginError
	if !errors.As(err, &pluginErr) {
		t.Fatalf("error = %T, want *PluginError", err)
	}
	if pluginErr.Code != pluginerrors.ErrCodeTimeout {
		t.Fatalf("code = %q, want %q", pluginErr.Code, pluginerrors.ErrCodeTimeout)
	}
}

func TestClassifyPluginAuthErrorReturnsProviderErrorForNonTimeoutNetworkError(t *testing.T) {
	err := classifyPluginAuthError(errors.New("connection refused"))

	var pluginErr *pluginerrors.PluginError
	if !errors.As(err, &pluginErr) {
		t.Fatalf("error = %T, want *PluginError", err)
	}
	if pluginErr.Code != pluginerrors.ErrCodeProviderError {
		t.Fatalf("code = %q, want %q", pluginErr.Code, pluginerrors.ErrCodeProviderError)
	}
}
