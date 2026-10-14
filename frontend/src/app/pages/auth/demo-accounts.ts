export interface DemoAccount {
  username: string;
  password: string;
  role: string;
  hint: string;
}

/**
 * Аккаунты из команды seed_roles для локальной разработки: команда пробует роли без регистрации.
 * Эти пароли работают только на своей машине. В production-сборке файл заменяется
 * на demo-accounts.prod.ts (fileReplacements в angular.json), и паролей в бандле нет.
 */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  { username: 'moderator', password: 'moderator12345', role: 'Moderator', hint: 'all dashboard tabs' },
  { username: 'sommelier', password: 'sommelier12345', role: 'Sommelier', hint: 'pairings and the pyramid' },
  { username: 'restaurant', password: 'restaurant12345', role: 'Venue admin', hint: 'menu and dishes' },
  { username: 'guest', password: 'guest12345', role: 'User', hint: 'site and profile only' },
  { username: 'waiter', password: 'waiter12345', role: 'Waiter', hint: 'staff track in the profile' }
];
