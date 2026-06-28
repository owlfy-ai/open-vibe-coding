use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::LazyLock;
use std::time::Duration;

use tauri::http::{Request as TauriRequest, Response as TauriResponse};

/// Shared reqwest client with 5-minute timeout (for long LLM responses).
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("failed to create HTTP client")
});

/// Determine the target scheme based on the host.
/// - `localhost` or any IP address → HTTP
/// - Domain names → HTTPS
fn infer_scheme(host: &str) -> &'static str {
    let normalized = host.trim_start_matches('[').trim_end_matches(']');
    if normalized.eq_ignore_ascii_case("localhost") {
        return "http";
    }

    if normalized.parse::<IpAddr>().is_ok() {
        return "http";
    }
    "https"
}

fn host_with_optional_port(host: &str, port: Option<u16>) -> String {
    let printable_host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    match port {
        Some(value) => format!("{printable_host}:{value}"),
        None => printable_host,
    }
}

/// Parse the proxy URL to extract the real target URL.
///
/// Input:  `proxy://api.openai.com/v1/chat/completions?stream=true`
/// Output: `https://api.openai.com/v1/chat/completions?stream=true`
///
/// Input:  `proxy://localhost:11434/v1/chat/completions`
/// Output: `http://localhost:11434/v1/chat/completions`
fn parse_proxy_url(uri: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(uri).map_err(|error| format!("Invalid proxy URI: {error}"))?;
    if parsed.scheme() != "proxy" {
        return Err(format!("Invalid proxy scheme: {}", parsed.scheme()));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Proxy target credentials are not allowed".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "Proxy target host is required".to_string())?;
    let scheme = infer_scheme(host);
    let host_port = host_with_optional_port(host, parsed.port());
    let path = if parsed.path().is_empty() {
        "/"
    } else {
        parsed.path()
    };
    let query = parsed
        .query()
        .map(|value| format!("?{value}"))
        .unwrap_or_default();
    Ok(format!("{scheme}://{host_port}{path}{query}"))
}

fn should_forward_request_header(name: &str) -> bool {
    !matches!(
        name.to_ascii_lowercase().as_str(),
        "host"
            | "origin"
            | "connection"
            | "content-length"
            | "transfer-encoding"
            | "upgrade"
            | "proxy-authorization"
            | "proxy-authenticate"
            | "sec-fetch-dest"
            | "sec-fetch-mode"
            | "sec-fetch-site"
            | "sec-fetch-user"
    )
}

fn should_forward_response_header(name: &str) -> bool {
    !matches!(
        name.to_ascii_lowercase().as_str(),
        "access-control-allow-origin"
            | "access-control-allow-methods"
            | "access-control-allow-headers"
            | "access-control-expose-headers"
            | "access-control-max-age"
            | "connection"
            | "content-length"
            | "transfer-encoding"
    )
}

/// Build an HTTP response with CORS headers injected.
fn build_cors_response(
    status: u16,
    body: Vec<u8>,
    extra_headers: HashMap<String, String>,
) -> TauriResponse<Vec<u8>> {
    let mut builder = TauriResponse::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .header(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
        )
        .header("Access-Control-Allow-Headers", "*")
        .header("Access-Control-Expose-Headers", "*")
        .header("Access-Control-Max-Age", "86400");

    for (k, v) in &extra_headers {
        builder = builder.header(k.as_str(), v.as_str());
    }

    builder.body(body).unwrap()
}

/// Build a JSON error response with CORS headers.
fn error_response(status: u16, error: &str, detail: &str) -> TauriResponse<Vec<u8>> {
    let body = format!(r#"{{"error":"{error}","detail":"{detail}"}}"#).into_bytes();
    let mut headers = HashMap::new();
    headers.insert("content-type".to_string(), "application/json".to_string());
    build_cors_response(status, body, headers)
}

/// Handle a single proxy request.
async fn handle_proxy(request: TauriRequest<Vec<u8>>) -> TauriResponse<Vec<u8>> {
    // 1. Parse the target URL
    let uri = request.uri().to_string();
    let target_url = match parse_proxy_url(&uri) {
        Ok(url) => url,
        Err(e) => return error_response(400, "Invalid proxy URL", &e),
    };

    // 2. Handle CORS preflight
    if request.method() == "OPTIONS" {
        return build_cors_response(204, Vec::new(), HashMap::new());
    }

    // 3. Build the reqwest request
    let method: reqwest::Method = request
        .method()
        .as_str()
        .parse()
        .unwrap_or(reqwest::Method::GET);

    let mut builder = HTTP_CLIENT.request(method, &target_url);

    // Forward request headers, filtering out browser-internal ones
    for (key, value) in request.headers() {
        if should_forward_request_header(key.as_str()) {
            if let Ok(v) = value.to_str() {
                builder = builder.header(key.as_str(), v);
            }
        }
    }

    // Forward request body
    let body = request.body().clone();
    if !body.is_empty() {
        builder = builder.body(body);
    }

    // 4. Send the request and build the response
    match builder.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();

            // Collect response headers (skip original CORS headers, we inject our own)
            let mut headers = HashMap::new();
            for (key, value) in resp.headers().iter() {
                if should_forward_response_header(key.as_str()) {
                    if let Ok(v) = value.to_str() {
                        headers.insert(key.as_str().to_ascii_lowercase(), v.to_string());
                    }
                }
            }

            let body_bytes = resp.bytes().await.unwrap_or_default().to_vec();
            build_cors_response(status, body_bytes, headers)
        }
        Err(e) => {
            if e.is_timeout() {
                error_response(504, "Proxy request timed out", &e.to_string())
            } else {
                error_response(502, "Proxy connection failed", &e.to_string())
            }
        }
    }
}

/// Register the `proxy://` custom protocol on the Tauri builder.
pub fn register_proxy_protocol(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.register_asynchronous_uri_scheme_protocol("proxy", |_app, request, responder| {
        tauri::async_runtime::spawn(async move {
            let response = handle_proxy(request).await;
            responder.respond(response);
        });
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infers_https_for_domain_targets() {
        assert_eq!(
            parse_proxy_url("proxy://api.openai.com/v1/chat/completions?stream=true"),
            Ok("https://api.openai.com/v1/chat/completions?stream=true".to_string())
        );
    }

    #[test]
    fn infers_http_for_local_and_ip_targets() {
        assert_eq!(
            parse_proxy_url("proxy://localhost:11434/v1/chat/completions"),
            Ok("http://localhost:11434/v1/chat/completions".to_string())
        );
        assert_eq!(
            parse_proxy_url("proxy://127.0.0.1:11434/v1/chat/completions"),
            Ok("http://127.0.0.1:11434/v1/chat/completions".to_string())
        );
        assert_eq!(
            parse_proxy_url("proxy://[::1]:11434/v1/chat/completions"),
            Ok("http://[::1]:11434/v1/chat/completions".to_string())
        );
    }

    #[test]
    fn rejects_invalid_proxy_targets() {
        assert!(parse_proxy_url("https://api.openai.com/v1").is_err());
        assert!(parse_proxy_url("proxy://user:pass@example.com/v1").is_err());
        assert!(parse_proxy_url("proxy:///missing-host").is_err());
    }

    #[test]
    fn filters_browser_and_hop_by_hop_request_headers() {
        assert!(!should_forward_request_header("Host"));
        assert!(!should_forward_request_header("Origin"));
        assert!(!should_forward_request_header("Connection"));
        assert!(!should_forward_request_header("Content-Length"));
        assert!(!should_forward_request_header("Proxy-Authorization"));
        assert!(!should_forward_request_header("Sec-Fetch-Site"));
        assert!(should_forward_request_header("Authorization"));
        assert!(should_forward_request_header("Content-Type"));
    }

    #[test]
    fn filters_cors_and_hop_by_hop_response_headers() {
        assert!(!should_forward_response_header(
            "Access-Control-Allow-Origin"
        ));
        assert!(!should_forward_response_header("Connection"));
        assert!(!should_forward_response_header("Transfer-Encoding"));
        assert!(should_forward_response_header("Content-Type"));
        assert!(should_forward_response_header("X-Request-Id"));
    }
}
