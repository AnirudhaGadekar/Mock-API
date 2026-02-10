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
      
      RATE_LIMIT_MAX: string;
      RATE_LIMIT_WINDOW: string;
      
      CORS_ORIGIN: string;
      
      API_VERSION: string;
      BASE_ENDPOINT_URL: string;
    }
  }
}

export {};
