import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-problem',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './problem.component.html',
  styleUrl: './problem.component.css'
})
export class ProblemComponent {
  problems = [
    {
      icon: '🎯',
      title: '72% выбирают по цене',
      text: 'Потребители не умеют объяснить, почему им нравится конкретное пиво. Выбор — привычка, не вкус.'
    },
    {
      icon: '🍺',
      title: '15+ брендов — 0 различий',
      text: 'Efes KZ имеет более 15 уникальных брендов, но потребитель не видит разницы между ними.'
    },
    {
      icon: '📊',
      title: 'Нет платформ в СНГ',
      text: 'RateBeer закрылся в 2025. Untappd — просто рейтинги. Ноль сенсорного образования.'
    }
  ];
}
