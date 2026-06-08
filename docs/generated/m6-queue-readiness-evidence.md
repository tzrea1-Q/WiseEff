## M6.4 Durable Queue Readiness Evidence

- Date: 2026-06-04T02:31:41.496Z
- Status: `passed`
- Base URL: `http://127.0.0.1:8788`
- Authorization: `<unset>`

### Result

- Detail: Durable queue transport and PostgreSQL job state are ready.

### Ready Body Summary

```json
{
  "ok": true,
  "service": "wiseeff-api",
  "status": "ready",
  "dependencies": {
    "database": {
      "ok": true,
      "status": "ready"
    },
    "objectStore": {
      "ok": true,
      "status": "ready"
    },
    "workerQueue": {
      "ok": true,
      "status": "ready",
      "queued": 0,
      "processing": 0,
      "deadLettered": 0,
      "oldestQueuedAgeMs": null
    },
    "durableQueue": {
      "ok": true,
      "status": "ready",
      "transport": {
        "waiting": 0,
        "active": 0,
        "completed": 0,
        "failed": 0,
        "delayed": 0,
        "paused": false,
        "ok": true,
        "status": "ready"
      },
      "database": {
        "ok": true,
        "status": "ready",
        "queued": 0,
        "processing": 0,
        "deadLettered": 0,
        "oldestQueuedAgeMs": null
      }
    }
  }
}
```
