# Closed-Source Operations Backend

This branch is a backend-managed commercial build. Login is always handled in the current Web app with Clerk:

- Gmail / Google OAuth
- Email verification code

There is no browser-language split and no China/global login mode switch.

## Environment

```env
VITE_OVC_APP_ID=qidea.ai
VITE_OVC_BACKEND_URL=https://api.owlfy.ai
VITE_OVC_LITELLM_BASE_URL=https://api.owlfy.ai/litellm/v1
VITE_OVC_LITELLM_MODEL=backup_glm5.3
VITE_OVC_APP_NAME=Open Vibe Coding
VITE_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsucWlkZWEuYWkk
```

`VITE_OVC_BACKEND_URL` defaults to `https://api.owlfy.ai` when omitted. `VITE_OVC_LITELLM_BASE_URL` defaults to `<backend>/litellm/v1`, and `VITE_OVC_LITELLM_MODEL` defaults to `backup_glm5.3`.

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
{ "app_id": "qidea.ai", "provider": "oauth_google", "sessionToken": "<clerk-session-token>" }
```

Email verification code:

```json
{ "app_id": "qidea.ai", "provider": "email", "sessionToken": "<clerk-session-token>" }
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

The client refreshes user state with `GET /api/user/getUserInfo` using `X-Token` and `Authorization: Bearer <token>`. All business requests include `X-App-ID: qidea.ai`. Stored sessions are isolated by app ID, backend URL, and Clerk Publishable Key; old Owlfy sessions are not restored.

Billing calls `POST /api/stripe/create-portal-session` with `returnUrl: https://qidea.ai/`. The backend must have a qidea.ai-specific Stripe Portal configuration and customer/subscription before this can be used; this is subscription management, not a checkout screen.

## Backend setup and current limits

The shared Go backend declares `applications.qidea.id: qidea.ai`. The map key deliberately has no dot because Viper interprets dots as nested configuration keys. Clerk Frontend API is `https://clerk.qidea.ai`; Secret Key is blank and must be filled on the server before startup. Never put a Secret Key in browser environment variables.

Production accepts Clerk tokens from `https://qidea.ai` and requires the `azp` claim. The default/local backend configurations also allow `http://localhost:5174` and `http://127.0.0.1:5174`, matching Vite. Enable email-code / Google login and register the application callback in the new Clerk instance. Production Clerk domain restrictions still apply; server origin allowlists do not configure Clerk itself.

`.env.production` points to `https://api.owlfy.ai`. Existing `.env.local` keeps `http://localhost:8083` for local backend development; both select `qidea.ai` and the provided public key. Configure a separate Clerk development instance if needed for local development.

Multi-product accounts do not receive Owlfy balances, membership, or automatic LiteLLM keys. The current Go allowlist does not expose `/api/publish/*` to qidea.ai. Official model access, image search, publishing/gallery and credit billing need a separate product-aware integration; this login configuration does not enable those business features. Real login remains unverified until the new server Secret Key and Clerk setup are complete and the backend is deployed.

## Model API

The default setting is the official model. Official model calls use the same OWLfy LiteLLM OpenAI-compatible interface, not a custom agent stream endpoint, and they are billed against the signed-in account's Credits.

`POST /litellm/v1/chat/completions`

Requires `Authorization: Bearer <liteLlmKey>`, where `liteLlmKey` comes from the login response or `GET /api/user/getUserInfo`.

The request body is the standard OpenAI Chat Completions streaming shape:

```json
{
  "model": "backup_glm5.3",
  "stream": true,
  "messages": [],
  "tools": []
}
```

The LiteLLM backend owns provider routing, subscription checks, credit metering, and rate limits.

Users can still switch the model provider in Settings to OpenAI-compatible, OpenAI, Anthropic, or Google. Those third-party providers use the user's own API key and base URL directly from the browser, bypass the backend model path, and do not consume backend Credits.

When the official model provider is selected, requests use the backend-managed `backup_glm5.3` model alias.
