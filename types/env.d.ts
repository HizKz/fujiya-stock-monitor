interface Env {
  DISCORD_BOT_TOKEN: string;
  DISCORD_CHANNEL_ID: string;
  DISCORD_PUBLIC_KEY: string;
  GITHUB_TOKEN: string;
  NOTIFIER_API_TOKEN: string;
}

declare namespace NodeJS {
  interface ProcessEnv {
    NOTIFIER_API_URL?: string;
    NOTIFIER_API_TOKEN?: string;
    DISCORD_WEBHOOK_URL?: string;
  }
}
