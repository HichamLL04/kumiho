package queue

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestEnqueueSetsEnqueuedAtAndReturnsQueueFull(t *testing.T) {
	q := New(1)

	first := Job{ID: "job-1", Type: JobTypeSearch}
	if err := q.Enqueue(first); err != nil {
		t.Fatalf("Enqueue(first) error = %v", err)
	}
	if err := q.Enqueue(Job{ID: "job-2", Type: JobTypeFetch}); !errors.Is(err, ErrQueueFull) {
		t.Fatalf("Enqueue(second) error = %v, want ErrQueueFull", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan Job, 1)
	go func() {
		_ = q.Run(ctx, func(_ context.Context, job Job) error {
			done <- job
			return nil
		})
	}()

	var handled Job
	select {
	case handled = <-done:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for queued job")
	}

	if handled.EnqueuedAt.IsZero() {
		t.Fatal("EnqueuedAt = zero, want timestamp")
	}
}

func TestRunReturnsContextCancellation(t *testing.T) {
	q := New(1)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := q.Run(ctx, func(context.Context, Job) error { return nil })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Run() error = %v, want %v", err, context.Canceled)
	}
}
