package handler

import (
	"testing"
)

func TestParseNumberFromString(t *testing.T) {
	tests := []struct {
		input    string
		expected float64
		hasValue bool
	}{
		{"29", 29, true},
		{"Chapter 29.5", 29.5, true},
		{"Vol 1 Ch 29", 29, true},
		{"Vol 29", 29, true},
		{"Torre de Dios : Urek Mazino 29", 29, true},
		{"100 Things to Do - Chapter 29", 29, true},
		{"100 Things to Do - 29", 29, true},
		{"29.cbz", 29, true},
		{"no numbers here", 0, false},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			val, ok := parseNumberFromString(tt.input)
			if ok != tt.hasValue {
				t.Fatalf("expected hasValue=%v, got=%v", tt.hasValue, ok)
			}
			if ok && val != tt.expected {
				t.Fatalf("expected %f, got %f", tt.expected, val)
			}
		})
	}
}
