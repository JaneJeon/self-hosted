RIP, can't use this because it requires a callback URL, and my Grafana instance for Home Assistant is behind a subnet router (so I would need to hook in Tailscale into this container specifically).

> The callback URL isn't about the renderer calling back to Grafana after rendering; it's the base URL that gets embedded in the render request so the renderer's Chromium instance knows where to load the Grafana dashboard page from.
