declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test';
      PORT: string;
      HOST: string;
      LOG_LEVEL: 'error' | 'warn' | 'info' | 'debug';
      
      DATABASE_URL: string;
      DIRECT_DATABASE_URL: string;
      
      REDIS_HOST: string;
      REDIS_PORT: string;
      REDIS_PASSWORD?: string;
      REDIS_DB: string;
      
      JWT_SECRET: string;
      JWT_EXPIRES_IN: string;
      JWT_EXPIRY?: string;
      EXPOSE_STACK_TRACE?: 'true' | 'false';
      AUTH_MODE?: 'otp' | 'dev-bypass';
      ALLOW_OTP_FOR_PASSWORD_USERS?: 'true' | 'false';
      API_KEY_COOKIE_MAX_AGE_SECONDS?: string;
      OTP_SECRET: string;
      API_KEY_SECRET: string;
      
      RATE_LIMIT_MAX: string;
      RATE_LIMIT_WINDOW: string;
      REQUEST_LOG_RETENTION_DAYS?: string;
      ENDPOINT_INACTIVITY_DAYS?: string;
      
      CORS_ORIGIN: string;
      
      API_VERSION: string;
      BASE_ENDPOINT_URL: string;
      BASE_MOCK_DOMAIN?: string;
      FRONTEND_URL?: string;
      GOOGLE_REDIRECT_URI?: string;
      GITHUB_REDIRECT_URI?: string;
      RENDER?: string;
      RENDER_EXTERNAL_URL?: string;
      ADMIN_SECRET?: string;
      DIAGNOSTIC_MODE?: 'true' | 'false';
    }
  }
}

export {};
