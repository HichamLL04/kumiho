package queue

import (
	"context"
	"errors"
	"time"
)

var ErrQueueFull = errors.New("queue is full")

type JobType string

const (
	JobTypeSearch JobType = "metadata_search"
	JobTypeFetch  JobType = "metadata_fetch"
)

// Job is a minimal metadata work item.
type Job struct {
	ID         string
	PluginID   string
	Type       JobType
	Payload    any
	EnqueuedAt time.Time
}

type Handler func(context.Context, Job) error

// Queue is a minimal in-memory FIFO queue for plugin work.
type Queue struct {
	jobs chan Job
}

func New(capacity int) *Queue {
	if capacity <= 0 {
		capacity = 1
	}
	return &Queue{jobs: make(chan Job, capacity)}
}

func (q *Queue) Enqueue(job Job) error {
	if job.EnqueuedAt.IsZero() {
		job.EnqueuedAt = time.Now()
	}

	select {
	case q.jobs <- job:
		return nil
	default:
		return ErrQueueFull
	}
}

func (q *Queue) Run(ctx context.Context, handler Handler) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case job := <-q.jobs:
			if err := handler(ctx, job); err != nil {
				return err
			}
		}
	}
}

func (q *Queue) Len() int {
	return len(q.jobs)
}
