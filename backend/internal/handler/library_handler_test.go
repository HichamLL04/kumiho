package handler

import (
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

func TestValidateNoNestedLibraryPaths(t *testing.T) {
	tests := []struct {
		name      string
		paths     []string
		libraries []model.Library
		excludeID string
		wantErr   bool
	}{
		{
			name:    "sibling paths are allowed",
			paths:   []string{"/data/comics", "/data/novels"},
			wantErr: false,
		},
		{
			name:    "request nested paths are rejected",
			paths:   []string{"/data", "/data/comics"},
			wantErr: true,
		},
		{
			name:  "nested against existing library is rejected",
			paths: []string{"/data/comics"},
			libraries: []model.Library{
				{ID: "existing", Paths: []string{"/data"}},
			},
			wantErr: true,
		},
		{
			name:  "excluded library paths are ignored",
			paths: []string{"/data/comics"},
			libraries: []model.Library{
				{ID: "same-lib", Paths: []string{"/data"}},
			},
			excludeID: "same-lib",
			wantErr:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateNoNestedLibraryPaths(tt.paths, tt.libraries, tt.excludeID)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateNoNestedLibraryPaths() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
