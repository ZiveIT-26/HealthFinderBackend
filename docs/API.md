[← Back to README](../README.md)

# HealthFinder API

Base URL: `http://localhost:3000`

`GET /` is public. Chat endpoints require a backend JWT in the
`Authorization: Bearer <token>` header.

## Google authentication

The Flutter app must obtain a Google ID token and exchange it with the backend:

```http
POST /auth/google
Content-Type: application/json

{
  "idToken": "google-id-token"
}
```

The backend verifies the token audience and signature, creates or updates the
local user, and returns a backend JWT:

```json
{
  "accessToken": "backend-jwt",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "displayName": "User",
    "avatarUrl": "https://..."
  }
}
```

### Development test authentication

For local API testing without a Google ID token, set
`TEST_AUTH_ENABLED=true` in the backend environment and call:

```http
POST /auth/test-login
```

This creates or reuses a deterministic test user and returns the same
`{ accessToken, user }` response shape. The endpoint returns `403` unless test
authentication is enabled, and is always blocked when `NODE_ENV=production`.

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
Authorization: Bearer <backend-jwt>
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

`location` is optional. When it is sent, it becomes the chat's location, as if
the user had answered a `location_request` with their current position (see
[Location requests](#location-requests)). Invalid coordinates are ignored.
Valid ranges are latitude `-90..90` and longitude `-180..180`.

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
Authorization: Bearer <backend-jwt>
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
| Session title | `{ "type": "title", "sessionId": "uuid", "title": "..." }` |
| Location request | `{ "type": "location_request", "requestId": "uuid", "reason": "optional text" }` |
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

## Location requests

The assistant may need to know where to search for doctors. It then pauses the
response and asks the app: the stream sends

```text
data: {"type":"location_request","requestId":"uuid","reason":"To find doctors near you"}

```

`reason` is optional. `"change": true` is added when the user asked to search
somewhere else: the app should then show the choice again, even if it
remembers one for this chat.

The app asks the user whether to use their current position or their home
address, and answers with `POST /chat/location`. The stream stays open and
continues after the answer. Without an answer within 2 minutes, the assistant
continues without a location.

`POST /chat/location`

Headers:

```http
Content-Type: application/json
Authorization: Bearer <backend-jwt>
```

Request, the user shared a location:

```json
{
  "requestId": "uuid from the event",
  "source": "current",
  "location": { "lat": 48.7164, "lon": 21.2611, "label": "Košice - Staré Mesto" }
}
```

`source` is `"current"` (the device's position) or `"home"` (the home address
saved in the app). `label` is optional: a place name for the assistant, for
example from reverse geocoding on the device.

Request, the user declined:

```json
{ "requestId": "uuid from the event", "source": "declined" }
```

Responses:

- `204`: the stream continues.
- `400`: invalid `source` or coordinates.
- `404`: no such request for this user (already answered or timed out).

The location is kept in the server's memory for the current response only and
is not saved to the database. The model only sees the label, never the
coordinates; facility searches use the coordinates to sort by distance. Every
new message asks again, so a moving user is not searched from an old point.
Asking the user once per chat is the app's job: it may remember the user's
choice and answer the next requests by itself with a fresh position.
The assistant does not ask in an emergency.

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
  // chunk.type === "location_request": ask the user, then POST /chat/location
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

## Chat history

`GET /chat/history/:sessionId`

Returns the saved messages in chronological order. Assistant messages that
contain doctor results include a `payload` object:

```json
[
  {
    "role": "user",
    "content": "Find me a neurologist.",
    "payload": null
  },
  {
    "role": "assistant",
    "content": "I found neurologists near you.",
    "payload": {
      "type": "doctors_list",
      "doctors": [
        {
          "name": "Doctor name",
          "speciality": "Speciality",
          "address": "Address",
          "url": "https://...",
          "phone": null,
          "email": null,
          "additionalInfo": null
        }
      ]
    }
  }
]
```

The session must belong to the authenticated user.

## Chat sessions

`GET /chat/sessions`

Returns all sessions belonging to the authenticated user, newest first,
without chat histories:

```json
[
  {
    "id": "uuid",
    "title": "Headache consultation",
    "createdAt": "2026-11-23T18:30:00.000Z"
  }
]
```
