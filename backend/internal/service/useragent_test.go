package service

import "testing"

func TestShouldUsePdfImageFallback(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		ua   string
		want bool
	}{
		{
			name: "iPad Safari 15.6",
			ua:   "Mozilla/5.0 (iPad; CPU OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
			want: true,
		},
		{
			name: "iPad Safari 16.0",
			ua:   "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
			want: false,
		},
		{
			name: "iPhone Safari 15.6",
			ua:   "Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
			want: false,
		},
		{
			name: "macOS Safari 15.6",
			ua:   "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15",
			want: false,
		},
		{
			name: "iPad Chrome",
			ua:   "Mozilla/5.0 (iPad; CPU OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/117.0.0.0 Mobile/15E148 Safari/604.1",
			want: false,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := ShouldUsePdfImageFallback(tt.ua)
			if got != tt.want {
				t.Fatalf("ShouldUsePdfImageFallback() = %v, want %v", got, tt.want)
			}
		})
	}
}
