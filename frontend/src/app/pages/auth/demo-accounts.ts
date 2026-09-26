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
  { username: 'moderator', password: 'moderator12345', role: 'Модератор', hint: 'все вкладки панели' },
  { username: 'sommelier', password: 'sommelier12345', role: 'Сомелье', hint: 'сочетания и пирамида' },
  { username: 'restaurant', password: 'restaurant12345', role: 'Администратор заведения', hint: 'меню и блюда' },
  { username: 'guest', password: 'guest12345', role: 'Пользователь', hint: 'только сайт и профиль' }
];
