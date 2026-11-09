# HealthFinder API

Base URL: `http://localhost:3000`

No authentication is required by the current API.

## Health check

`GET /`

Returns:

```text
Hello World!
```

## Start or continue a chat

`POST /chat`

Headers:

```http
Content-Type: application/json
```

Request:

```json
{
  "prompt": "I have had a headache for three days. Find me a doctor.",
  "sessionId": "optional-existing-session-id",
  "location": {
    "lat": 48.7164,
    "lon": 21.2611
  }
}
```

`location` is optional and is used to improve nearby facility searches. Invalid
coordinates are ignored. Valid ranges are latitude `-90..90` and longitude
`-180..180`.

Response `200`:

```json
{
  "streamId": "uuid",
  "sessionId": "uuid"
}
```

Use the returned `streamId` to open the response stream. Keep `sessionId` for
follow-up messages.

If `prompt` is missing or empty, the API returns `400`.

## Stream the assistant response

`GET /chat/stream/:streamId`

Headers:

```http
Accept: text/event-stream
```

The response is **Server-Sent Events (SSE)**. Each event is a JSON object in a
`data:` line:

```text
data: {"type":"token","text":"Hello"}

```

Possible payloads:

| Payload | Fields |
| --- | --- |
| Token message | `{ "type": "token", "text": "..." }` |
| Doctors list | `{ "type": "doctors_list", "doctors": [...] }` |
| Heartbeat | `{ "type": "heartbeat", "timestamp": "ISO-8601" }` |
| Error | `{ "type": "error", "message": "..." }` |

Doctor objects contain:

```json
{
  "name": "Doctor name",
  "speciality": "Speciality",
  "address": "Address",
  "url": "https://...",
  "phone": "optional string or null",
  "email": "optional string or null",
  "additionalInfo": "optional string or null"
}
```

The stream closes when the response is complete. A stream ID is consumed after
the first request; do not retry the same stream ID.

The HTTP stream does not emit debug events. Assistant text is delivered as
multiple `token` events; doctor results, when available, are delivered in a
separate `doctors_list` event.

## Frontend example

```js
const start = await fetch(`${API_URL}/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt }),
});

const { streamId, sessionId } = await start.json();
const events = new EventSource(`${API_URL}/chat/stream/${streamId}`);

events.onmessage = ({ data }) => {
  const chunk = JSON.parse(data);
  // chunk.type === "token": append chunk.text
  // chunk.type === "doctors_list": render chunk.doctors
  // chunk.type === "heartbeat": ignore
  // chunk.type === "error": show an error
};

events.onerror = () => events.close();
```

For a follow-up message, send the returned `sessionId`:

```js
await fetch(`${API_URL}/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "What about cardiology?", sessionId }),
});
```

The current backend does not expose a history HTTP endpoint. The
`/chat/history/:sessionId` example in `test.http` is not an implemented route.
