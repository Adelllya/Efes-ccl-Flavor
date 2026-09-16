import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-education',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './education.component.html',
  styleUrl: './education.component.css'
})
export class EducationComponent {
  levels = [
    { level: 1, color: '#22C55E', name: 'Новичок', description: 'Базовые вкусы, как правильно пробовать пиво' },
    { level: 2, color: '#3B82F6', name: 'Исследователь', description: 'Ароматические ноты, стили пива (лагер vs эль)' },
    { level: 3, color: '#8B5CF6', name: 'Знаток', description: 'Food pairing, влияние ингредиентов на вкус' },
    { level: 4, color: '#F59E0B', name: 'Сомелье', description: 'Слепая дегустация + цифровой сертификат Efes' },
  ];

  features = ['XP', 'стрики', 'лидерборд', 'AI-наставник', 'AR-уроки'];
}
