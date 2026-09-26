export interface DemoAccount {
  username: string;
  password: string;
  role: string;
  hint: string;
}

/** Production-сборка: тестовых аккаунтов с паролями в бандле нет (см. demo-accounts.ts). */
export const DEMO_ACCOUNTS: DemoAccount[] = [];
