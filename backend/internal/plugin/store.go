package plugin

import (
	"errors"
	"sync"
	"time"

	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
)

var ErrPluginNotFound = errors.New("plugin not found")

// Record is the core-side state snapshot for an installed plugin.
type Record struct {
	ID          string
	Manifest    sdkmanifest.Manifest
	State       sdkstate.State
	InstallPath string
	LastError   string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Store persists plugin state snapshots.
type Store interface {
	Save(record Record) error
	Get(id string) (Record, bool, error)
	List() ([]Record, error)
	Delete(id string) error
}

// MemoryStore is the initial in-memory implementation for Phase 1.
type MemoryStore struct {
	mu      sync.RWMutex
	records map[string]Record
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{records: make(map[string]Record)}
}

func (s *MemoryStore) Save(record Record) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records[record.ID] = record
	return nil
}

func (s *MemoryStore) Get(id string) (Record, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record, ok := s.records[id]
	return record, ok, nil
}

func (s *MemoryStore) List() ([]Record, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	records := make([]Record, 0, len(s.records))
	for _, record := range s.records {
		records = append(records, record)
	}
	return records, nil
}

func (s *MemoryStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.records, id)
	return nil
}
