import {
  defineRailway,
  github,
  preserve,
  project,
  service,
  volume
} from 'railway/iac'

// Manage only the MCP services. Existing Railway services still use their own
// deployment configuration and are deliberately outside this partial.
export const partial = 'mcp'

export default defineRailway(() => {
  const telegramData = volume('telegram-mcp-volume', {
    alerts: { usage: { '100': {}, '80': {}, '95': {} } },
    allowOnlineResize: true,
    region: 'us-west2',
    sizeMB: 5000
  })
  const whatsappData = volume('whatsapp-mcp-volume', {
    alerts: { usage: { '100': {}, '80': {}, '95': {} } },
    allowOnlineResize: true,
    region: 'us-west2',
    sizeMB: 5000
  })

  const telegram = service('telegram-mcp', {
    build: {
      builder: 'DOCKERFILE',
      watchPatterns: ['/services/telegram-mcp/**']
    },
    deploy: { restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 3 },
    healthcheck: '/ping',
    healthcheckTimeout: 180,
    replicas: { 'us-west2': 1 },
    volumeMounts: { '/data': telegramData },
    env: {
      TELEGRAM_API_ID: preserve(),
      TELEGRAM_API_HASH: preserve(),
      TELEGRAM_SESSION_STRING: preserve()
    }
  })

  const whatsapp = service('whatsapp-mcp', {
    build: {
      builder: 'DOCKERFILE',
      watchPatterns: ['/services/whatsapp-mcp/**']
    },
    deploy: { restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 3 },
    source: github('JaneJeon/self-hosted', {
      branch: 'codex/railway-mcp',
      rootDirectory: '/services/whatsapp-mcp'
    }),
    replicas: { 'us-west2': 1 },
    volumeMounts: { '/app/data': whatsappData },
    env: {
      B2_ACCOUNT_ID: preserve(),
      B2_ACCOUNT_KEY: preserve(),
      RESTIC_REPOSITORY: preserve(),
      RESTIC_PASSWORD: preserve(),
      HEARTBEAT_URL: preserve()
    }
  })

  const gateway = service('agentgateway', {
    build: {
      builder: 'DOCKERFILE',
      watchPatterns: ['/services/agentgateway/**']
    },
    deploy: { restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 3 },
    source: github('JaneJeon/self-hosted', {
      branch: 'codex/railway-mcp',
      rootDirectory: '/services/agentgateway'
    }),
    domains: [{ domain: 'mcp.janejeon.dev', port: 8080 }],
    replicas: { 'us-west2': 1 },
    env: {
      TELEGRAM_MCP_URL: preserve(),
      WHATSAPP_MCP_HOST: preserve(),
      AUTH0_ISSUER: preserve(),
      AUTH0_JWKS_URL: preserve(),
      AUTH0_AUDIENCE: preserve(),
      JANE_SUB: preserve()
    }
  })

  return project('Personal Project', {
    resources: [telegram, whatsapp, gateway, telegramData, whatsappData]
  })
})
