/**
 * Ответ на вопрос о возрасте. Отдельно от AgeGateComponent, чтобы AppComponent
 * мог проверить его без загрузки чанка с окном: тем, кто уже ответил, окно не нужно.
 */
export const AGE_OK_KEY = 'ft_age_ok';

/** Гость уже подтвердил, что ему есть 21. Без localStorage спрашиваем при каждой загрузке. */
export function ageConfirmed(): boolean {
  try {
    return localStorage.getItem(AGE_OK_KEY) === '1';
  } catch {
    return false;
  }
}
