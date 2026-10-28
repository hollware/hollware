---
'@hollware/server': minor
'@hollware/core': minor
'@hollware/admin': minor
---

An event no receiver took is no longer lost. When the Queue gives up on an event after five tries, its dead-letter queue, which the Worker now consumes too, marks it as given up on, and the activity log says so (`event.abandon`). Webhooks, in the admin, lists the deliveries that failed, with their last error and whether the Queue still tries, and sends an event again (`GET /v1/admin/deliveries`, `POST /v1/admin/events/:id/retry`). The activity log records that as `event.retry`, and names `move_entry`, `schedule_unpublish`, `app.refresh_reused` and `schedule.unpublish`, which its filter showed blank.
