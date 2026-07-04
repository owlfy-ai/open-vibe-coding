# Closed-Source Operations Backend

This branch is a backend-managed commercial build. Login is always handled in the current Web app with Clerk:

- Gmail / Google OAuth
- Email verification code

There is no browser-language split and no China/global login mode switch.

## Environment

```env
VITE_OVC_BACKEND_URL=https://api.owlfy.ai
VITE_OVC_LITELLM_BASE_URL=https://api.owlfy.ai/litellm/v1
VITE_OVC_LITELLM_MODEL=Standard
VITE_OVC_APP_NAME=Open Vibe Coding
VITE_CLERK_PUBLISHABLE_KEY=pk_live_or_test_...
```

`VITE_OVC_BACKEND_URL` defaults to `https://api.owlfy.ai` when omitted. `VITE_OVC_LITELLM_BASE_URL` defaults to `<backend>/litellm/v1`, and `VITE_OVC_LITELLM_MODEL` defaults to `Standard`, matching OWLfy's default LiteLLM runtime.

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
      "vip_level": 1,
      "liteLlmKey": "sk-..."
    }
  }
}
```

The client refreshes user state with `GET /api/user/getUserInfo` using `Authorization: Bearer <token>`.

Billing opens the configured website URL from `GET /api/sysConfig/getByKey?key=website` and appends `?page=pricing&token=<token>`.

## Model API

The default setting is the official model. Official model calls use the same OWLfy LiteLLM OpenAI-compatible interface, not a custom agent stream endpoint, and they are billed against the signed-in account's Credits.

`POST /litellm/v1/chat/completions`

Requires `Authorization: Bearer <liteLlmKey>`, where `liteLlmKey` comes from the login response or `GET /api/user/getUserInfo`.

The request body is the standard OpenAI Chat Completions streaming shape:

```json
{
  "model": "Standard",
  "stream": true,
  "messages": [],
  "tools": []
}
```

The LiteLLM backend owns provider routing, subscription checks, credit metering, and rate limits.

Users can still switch the model provider in Settings to OpenAI-compatible, OpenAI, Anthropic, or Google. Those third-party providers use the user's own API key and base URL directly from the browser, bypass the backend model path, and do not consume backend Credits.

When the official model provider is selected, the chat composer shows a model selector. `Standard` is available to every signed-in user and is the default. `Ultra` is only selectable for VIP users; non-VIP users remain on `Standard`.
