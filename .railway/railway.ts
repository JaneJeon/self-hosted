import {
  defineRailway,
  github,
  preserve,
  project,
  service,
  volume
} from 'railway/iac'

// Railway stores Railpack/V3 and automatically detects the standard Dockerfiles.
// Match those stored defaults so adding one MCP does not update every service.
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
  const whatsappTrialData = volume('whatsapp-trial-volume', {
    alerts: { usage: { '100': {}, '80': {}, '95': {} } },
    allowOnlineResize: true,
    region: 'us-west2',
    sizeMB: 5000
  })

  const telegram = service('Telegram MCP', {
    build: {
      builder: 'RAILPACK',
      buildEnvironment: 'V3',
      watchPatterns: ['/services/telegram-mcp/**']
    },
    deploy: {
      runtime: 'V2',
      useLegacyStacker: false,
      ipv6EgressEnabled: false,
      restartPolicyMaxRetries: 3
    },
    source: github('JaneJeon/self-hosted', {
      branch: 'master',
      rootDirectory: '/services/telegram-mcp'
    }),
    healthcheck: '/ping',
    healthcheckTimeout: 180,
    replicas: { 'us-west2': 1 },
    volumeMounts: { '/data': telegramData },
    env: {
      MCP_URL: 'http://${{RAILWAY_PRIVATE_DOMAIN}}:8080/mcp',
      TELEGRAM_API_ID: preserve(),
      TELEGRAM_API_HASH: preserve(),
      TELEGRAM_SESSION_STRING: preserve()
    }
  })

  const whatsapp = service('Whatsapp MCP', {
    build: {
      builder: 'RAILPACK',
      buildEnvironment: 'V3',
      watchPatterns: ['/services/whatsapp-mcp/**']
    },
    deploy: {
      runtime: 'V2',
      useLegacyStacker: false,
      ipv6EgressEnabled: false,
      restartPolicyMaxRetries: 3
    },
    source: github('JaneJeon/self-hosted', {
      branch: 'master',
      rootDirectory: '/services/whatsapp-mcp'
    }),
    replicas: { 'us-west2': 1 },
    volumeMounts: { '/app/data': whatsappData },
    env: {
      B2_ACCOUNT_ID: preserve(),
      B2_ACCOUNT_KEY: preserve(),
      RESTIC_REPOSITORY: preserve(),
      RESTIC_PASSWORD: preserve(),
      KUMA_PUSH_PATH: preserve(),
      HEARTBEAT_URL:
        'http://${{"Uptime Kuma".RAILWAY_PRIVATE_DOMAIN}}:${{"Uptime Kuma".PORT}}${{KUMA_PUSH_PATH}}'
    }
  })

  const whatsappTrial = service('Whatsapp Trial', {
    build: {
      builder: 'RAILPACK',
      buildEnvironment: 'V3',
      watchPatterns: ['/services/whatsapp-trial/**']
    },
    deploy: {
      runtime: 'V2',
      useLegacyStacker: false,
      ipv6EgressEnabled: false,
      restartPolicyMaxRetries: 3
    },
    source: github('JaneJeon/self-hosted', {
      branch: 'master',
      rootDirectory: '/services/whatsapp-trial'
    }),
    // Bootstrap the empty volume while the entrypoint waits for its marker.
    // Enable /health after the reviewed seed is installed, before publication.
    replicas: { 'us-west2': 1 },
    volumeMounts: { '/app/data': whatsappTrialData },
    env: {
      MCP_URL: 'http://${{RAILWAY_PRIVATE_DOMAIN}}:8080/mcp',
      WHATSAPP_CANDIDATE_READ_ONLY: '1',
      WHATSAPP_TRIAL_SNAPSHOT: '530656a0'
    }
  })

  const identity = service('Keycloak', {
    build: {
      builder: 'RAILPACK',
      buildEnvironment: 'V3',
      watchPatterns: ['/services/keycloak/**']
    },
    deploy: { restartPolicyType: 'ALWAYS' },
    source: github('JaneJeon/self-hosted', {
      branch: 'master',
      rootDirectory: '/services/keycloak'
    }),
    replicas: { 'us-west2': 1 },
    env: {
      KC_DB_URL:
        'jdbc:mysql://${{MySQL.RAILWAY_PRIVATE_DOMAIN}}:3306/${{MySQL.KEYCLOAK_MYSQL_DATABASE}}?sslMode=DISABLED&allowPublicKeyRetrieval=true',
      KC_DB_USERNAME: '${{MySQL.KEYCLOAK_MYSQL_USERNAME}}',
      KC_DB_PASSWORD: '${{MySQL.KEYCLOAK_MYSQL_PASSWORD}}',
      PRIVATE_URL: 'http://${{RAILWAY_PRIVATE_DOMAIN}}:8080/auth',
      PRIVATE_HOST: '${{RAILWAY_PRIVATE_DOMAIN}}:8080',
      ISSUER: 'https://mcp.janejeon.dev/auth/realms/personal',
      JWKS_URL:
        'http://${{RAILWAY_PRIVATE_DOMAIN}}:8080/auth/realms/personal/protocol/openid-connect/certs'
    }
  })

  const identityMcp = service('Keycloak MCP', {
    build: {
      builder: 'RAILPACK',
      buildEnvironment: 'V3',
      watchPatterns: ['/services/keycloak-mcp/**']
    },
    deploy: { restartPolicyType: 'ALWAYS' },
    source: github('JaneJeon/self-hosted', {
      branch: 'master',
      rootDirectory: '/services/keycloak-mcp'
    }),
    replicas: { 'us-west2': 1 },
    env: {
      KC_URL: identity.env.PRIVATE_URL,
      KC_REALM: 'personal',
      OIDC_CLIENT_ID: 'codex',
      QUARKUS_OIDC_TOKEN_ISSUER: identity.env.ISSUER,
      MCP_URL: 'http://${{RAILWAY_PRIVATE_DOMAIN}}:8080/mcp'
    }
  })

  const gateway = service('agentgateway', {
    build: {
      builder: 'RAILPACK',
      buildEnvironment: 'V3',
      watchPatterns: ['/services/agentgateway/**']
    },
    deploy: { restartPolicyType: 'ALWAYS' },
    source: github('JaneJeon/self-hosted', {
      branch: 'master',
      rootDirectory: '/services/agentgateway'
    }),
    replicas: { 'us-west2': 1 },
    env: {
      TELEGRAM_MCP_URL: telegram.env.MCP_URL,
      WHATSAPP_MCP_HOST: whatsapp.env.RAILWAY_PRIVATE_DOMAIN,
      WHATSAPP_TRIAL_MCP_URL: whatsappTrial.env.MCP_URL,
      OIDC_ISSUER: identity.env.ISSUER,
      OIDC_JWKS_URL: identity.env.JWKS_URL,
      KEYCLOAK_HOST: identity.env.PRIVATE_HOST,
      KEYCLOAK_MCP_URL: identityMcp.env.MCP_URL,
      MCP_ALLOWED_SUB: preserve(),
      AUTH0_ISSUER: preserve(),
      AUTH0_JWKS_URL: preserve(),
      AUTH0_AUDIENCE: preserve(),
      JANE_SUB: preserve()
    }
  })

  return project('Personal Project', {
    resources: [
      telegram,
      whatsapp,
      whatsappTrial,
      gateway,
      identity,
      identityMcp,
      telegramData,
      whatsappData,
      whatsappTrialData
    ]
  })
})
