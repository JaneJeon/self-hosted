FROM cr.agentgateway.dev/agentgateway:v1.5.0

COPY --chown=65532:65532 config.yaml /config.yaml
EXPOSE 8080
CMD ["-f", "/config.yaml"]
