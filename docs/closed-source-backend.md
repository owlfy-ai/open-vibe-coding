# Closed-Source Operations Backend

This branch is a backend-managed commercial build. Login is always handled in the current Web app with Clerk:

- Gmail / Google OAuth
- Email verification code

There is no browser-language split and no China/global login mode switch.

## Environment

```env
VITE_OVC_BACKEND_URL=https://api.owlfy.ai
VITE_OVC_APP_NAME=Open Vibe Coding
VITE_CLERK_PUBLISHABLE_KEY=pk_live_or_test_...
```

`VITE_OVC_BACKEND_URL` defaults to `https://api.owlfy.ai` when omitted.

## Auth Flow

The current Web app performs Google OAuth and email-code auth directly with Clerk.

Clerk redirect URL:

```text
/auth/clerk-callback
```

After Clerk completes authentication, the client obtains a Clerk session token and exchanges it with the backend through Owlfy-style unified login.

`POST /api/base/unified-login`

Google OAuth:

```json
{ "provider": "oauth_google", "sessionToken": "<clerk-session-token>" }
```

Email verification code:

```json
{ "provider": "email", "sessionToken": "<clerk-session-token>" }
```

The client expects Owlfy-style envelopes:

```json
{ "code": 0, "data": {}, "message": "ok" }
```

Successful login response:

```json
{
  "code": 0,
  "data": {
    "token": "jwt-or-session-token",
    "user": {
      "ID": 1,
      "email": "user@example.com",
      "nickName": "User",
      "points": 100,
      "freePoints": 20,
      "vipPoints": 300,
      "vip_level": 1
    }
  }
}
```

The client refreshes user state with `GET /api/user/getUserInfo` using `Authorization: Bearer <token>`.

Billing opens the configured website URL from `GET /api/sysConfig/getByKey?key=website` and appends `?page=pricing&token=<token>`.

## Agent Stream API

`POST /api/agent/stream`

Requires `Authorization: Bearer <token>`.

The request body contains:

```json
{
  "systemPrompt": "optional system prompt",
  "messages": [],
  "tools": []
}
```

The response body is newline-delimited JSON. Each line must be one event:

```json
{ "type": "text-delta", "delta": "Hello" }
{ "type": "reasoning-delta", "delta": "Thinking..." }
{ "type": "tool-call", "callId": "tool_1", "toolName": "write_file", "input": {} }
{ "type": "finish", "reason": "tool-calls" }
```

Allowed finish reasons are `stop`, `tool-calls`, and `length`.

The backend owns provider API keys, subscription checks, credit metering, and rate limits.
