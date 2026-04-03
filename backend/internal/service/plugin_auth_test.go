package service

import (
	"net/http"
	"testing"
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
