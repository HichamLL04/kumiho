package binary

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkplugin "github.com/kumiho-plugin/kumiho-plugin-sdk/plugin"
	sdkservice "github.com/kumiho-plugin/kumiho-plugin-sdk/service"
)

const (
	EnvPluginHost    = "KUMIHO_PLUGIN_HOST"
	EnvPluginPort    = "KUMIHO_PLUGIN_PORT"
	maxStartAttempts = 3
)

type processState struct {
	cmd     *exec.Cmd
	cancel  context.CancelFunc
	baseURL string
	exited  chan error
	ready   chan error
}

// Runtime starts plugin binaries as child processes and probes them over the
// SDK HTTP contract. This is the Phase 1 minimal BinaryRuntime bridge.
type Runtime struct {
	client    *http.Client
	stopGrace time.Duration

	mu        sync.RWMutex
	processes map[string]processState
}

func NewRuntime() *Runtime {
	return &Runtime{
		client: &http.Client{
			Timeout: healthcheck.DefaultTimeout,
		},
		stopGrace: 3 * time.Second,
		processes: make(map[string]processState),
	}
}

func (r *Runtime) Type() sdkmanifest.RuntimeType {
	return sdkmanifest.RuntimeTypeBinary
}

func (r *Runtime) Start(ctx context.Context, inst runtime.Instance) error {
	if inst.InstallPath == "" {
		return errors.New("install path is required")
	}
	if inst.Manifest.RuntimeType != "" && inst.Manifest.RuntimeType != sdkmanifest.RuntimeTypeBinary {
		return fmt.Errorf("plugin runtime type %q is not binary", inst.Manifest.RuntimeType)
	}

	r.mu.Lock()
	if state, alreadyRunning := r.processes[inst.ID]; alreadyRunning {
		r.mu.Unlock()
		if state.ready != nil {
			return waitForStart(ctx, state.ready)
		}
		return nil
	}
	exited := make(chan error, 1)
	ready := make(chan error, 1)
	r.processes[inst.ID] = processState{exited: exited, ready: ready}
	r.mu.Unlock()

	absPath, err := filepath.Abs(inst.InstallPath)
	if err != nil {
		r.finishStart(inst.ID, fmt.Errorf("resolve install path: %w", err))
		r.remove(inst.ID)
		return fmt.Errorf("resolve install path: %w", err)
	}
	if _, statErr := os.Stat(absPath); statErr != nil {
		r.finishStart(inst.ID, fmt.Errorf("stat install path: %w", statErr))
		r.remove(inst.ID)
		return fmt.Errorf("stat install path: %w", statErr)
	}

	var lastErr error
	for attempt := 1; attempt <= maxStartAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			r.finishStart(inst.ID, err)
			r.remove(inst.ID)
			return err
		}

		host := "127.0.0.1"
		port, err := allocatePort(host)
		if err != nil {
			lastErr = fmt.Errorf("allocate plugin port: %w", err)
			break
		}
		baseURL := fmt.Sprintf("http://%s:%d", host, port)

		procCtx, cancel := context.WithCancel(context.Background())
		cmd := exec.CommandContext(procCtx, absPath)
		cmd.Env = append(os.Environ(),
			EnvPluginHost+"="+host,
			EnvPluginPort+"="+strconv.Itoa(port),
		)
		cmd.Stdout = log.Writer()
		cmd.Stderr = log.Writer()

		if err := cmd.Start(); err != nil {
			cancel()
			lastErr = fmt.Errorf("start plugin process: %w", err)
			break
		}

		r.mu.Lock()
		r.processes[inst.ID] = processState{cmd: cmd, cancel: cancel, baseURL: baseURL, exited: exited, ready: ready}
		r.mu.Unlock()

		cmdExited := exited
		go func(cmd *exec.Cmd, exited chan error) {
			err := cmd.Wait()
			exited <- err
			close(exited)
			r.mu.Lock()
			delete(r.processes, inst.ID)
			r.mu.Unlock()
			if err != nil {
				log.Printf("plugin process %s exited: %v", inst.ID, err)
			}
		}(cmd, cmdExited)

		if err := r.waitUntilReady(ctx, inst.ID, baseURL, inst.Manifest.ID); err == nil {
			r.finishStart(inst.ID, nil)
			return nil
		} else {
			lastErr = err
			_ = r.Stop(context.Background(), inst)
			if attempt < maxStartAttempts {
				r.mu.Lock()
				r.processes[inst.ID] = processState{exited: make(chan error, 1), ready: ready}
				exited = r.processes[inst.ID].exited
				r.mu.Unlock()
				time.Sleep(150 * time.Millisecond)
				continue
			}
		}
	}

	r.finishStart(inst.ID, lastErr)
	r.remove(inst.ID)
	return lastErr
}

func (r *Runtime) Stop(ctx context.Context, inst runtime.Instance) error {
	state, ok := r.get(inst.ID)
	if !ok {
		return nil
	}

	if state.cmd == nil || state.cmd.Process == nil {
		r.mu.Lock()
		delete(r.processes, inst.ID)
		r.mu.Unlock()
		return nil
	}

	_ = state.cmd.Process.Signal(syscall.SIGTERM)

	timeout := r.stopGrace
	if deadline, ok := ctx.Deadline(); ok {
		if until := time.Until(deadline); until > 0 && until < timeout {
			timeout = until
		}
	}

	select {
	case <-ctx.Done():
		state.cancel()
		_ = state.cmd.Process.Kill()
		<-state.exited
		return ctx.Err()
	case <-time.After(timeout):
		state.cancel()
		_ = state.cmd.Process.Kill()
		<-state.exited
	case <-state.exited:
	}
	return nil
}

func (r *Runtime) Healthcheck(ctx context.Context, inst runtime.Instance) (*healthcheck.Response, error) {
	state, ok := r.get(inst.ID)
	if !ok || state.baseURL == "" {
		return nil, runtime.ErrNotRunning
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, state.baseURL+sdkservice.PathHealth, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set(sdkservice.HeaderAccept, sdkservice.ContentTypeJSON)

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != sdkservice.StatusOK {
		return nil, fmt.Errorf("healthcheck returned status %d", resp.StatusCode)
	}

	var payload healthcheck.Response
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	return &payload, nil
}

func (r *Runtime) waitUntilReady(ctx context.Context, id string, baseURL string, expectedManifestID string) error {
	deadline := time.Now().Add(sdkplugin.StartupTimeout)
	for time.Now().Before(deadline) {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := r.exitedError(id); err != nil {
			return fmt.Errorf("plugin process exited before readiness: %w", err)
		}

		checkCtx, cancel := context.WithTimeout(ctx, healthcheck.DefaultTimeout)
		health, err := r.Healthcheck(checkCtx, runtime.Instance{ID: id})
		cancel()
		if err == nil && health != nil {
			if expectedManifestID != "" {
				if err := r.validateManifest(ctx, id, expectedManifestID); err != nil {
					return err
				}
			}
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}

	return fmt.Errorf("plugin did not become ready within %s: %s", sdkplugin.StartupTimeout, baseURL)
}

func (r *Runtime) validateManifest(parent context.Context, id string, expectedID string) error {
	state, ok := r.get(id)
	if !ok || state.baseURL == "" {
		return runtime.ErrNotRunning
	}

	ctx, cancel := context.WithTimeout(parent, healthcheck.DefaultTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, state.baseURL+sdkservice.PathManifest, nil)
	if err != nil {
		return err
	}
	req.Header.Set(sdkservice.HeaderAccept, sdkservice.ContentTypeJSON)

	resp, err := r.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != sdkservice.StatusOK {
		return fmt.Errorf("manifest returned status %d", resp.StatusCode)
	}

	var payload sdkmanifest.Manifest
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return err
	}
	if payload.ID != expectedID {
		return fmt.Errorf("manifest id mismatch: got %q want %q", payload.ID, expectedID)
	}
	return nil
}

func (r *Runtime) get(id string) (processState, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	state, ok := r.processes[id]
	return state, ok
}

func (r *Runtime) finishStart(id string, err error) {
	r.mu.Lock()
	state, ok := r.processes[id]
	if !ok || state.ready == nil {
		r.mu.Unlock()
		return
	}

	ready := state.ready
	state.ready = nil
	r.processes[id] = state
	r.mu.Unlock()

	ready <- err
	close(ready)
}

func (r *Runtime) remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.processes, id)
}

func (r *Runtime) exitedError(id string) error {
	state, ok := r.get(id)
	if !ok {
		return runtime.ErrNotRunning
	}

	select {
	case err, ok := <-state.exited:
		if !ok {
			return runtime.ErrNotRunning
		}
		if err == nil {
			return runtime.ErrNotRunning
		}
		return err
	default:
		return nil
	}
}

func waitForStart(ctx context.Context, ready <-chan error) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err, ok := <-ready:
		if !ok {
			return nil
		}
		return err
	}
}

func allocatePort(host string) (int, error) {
	ln, err := net.Listen("tcp", net.JoinHostPort(host, "0"))
	if err != nil {
		return 0, err
	}
	defer func() { _ = ln.Close() }()

	tcpAddr, ok := ln.Addr().(*net.TCPAddr)
	if !ok {
		return 0, errors.New("unexpected listener address type")
	}
	return tcpAddr.Port, nil
}
