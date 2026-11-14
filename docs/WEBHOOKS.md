# Outgoing reading webhooks

Kumiho can send an app-neutral `chapter.completed` event to one configured HTTP endpoint. Set `WEBHOOK_URL` to enable delivery and `WEBHOOK_SECRET` to sign requests. If the URL is empty, delivery is disabled.

The event is sent after a chapter is newly marked complete. Repeated progress updates for a chapter that is already complete do not emit another event. The sender retries a failed delivery up to three times and logs a final failure without logging the signing secret.

Each request uses `Content-Type: application/json` and includes:

- `X-Kumiho-Event`: event type (`chapter.completed`)
- `X-Kumiho-Delivery`: unique delivery ID; the same ID is used for retries
- `X-Kumiho-Timestamp`: UTC timestamp in RFC3339Nano format
- `X-Kumiho-Signature`: `sha256=<hex HMAC>` when `WEBHOOK_SECRET` is set

To verify the signature, calculate HMAC-SHA256 with the configured secret over the UTF-8 bytes of `<timestamp>.<raw request body>`, then compare the lowercase hex digest with the value after `sha256=` using a constant-time comparison. Reject timestamps outside the receiver's replay window.

Example body:

```json
{
  "id": "delivery-uuid",
  "version": 1,
  "type": "chapter.completed",
  "occurred_at": "2026-11-14T12:00:00Z",
  "user_id": "kumiho-user-id",
  "series": {
    "id": "series-uuid",
    "title": "Series title",
    "metadata": {
      "original_title": "Original title",
      "publication_year": "2024"
    }
  },
  "chapter": {
    "id": "chapter-uuid",
    "number": 12,
    "title": "Chapter 12",
    "volume_id": "volume-uuid",
    "volume_number": 1
  }
}
```

The `metadata` object and `identifiers` object are optional and can contain catalog values supported by a consumer. Consumers should use `id` for idempotency and must not assume every metadata key is present.
