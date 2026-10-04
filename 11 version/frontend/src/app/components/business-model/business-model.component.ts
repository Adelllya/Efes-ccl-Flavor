import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-business-model',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './business-model.component.html',
  styleUrl: './business-model.component.css'
})
export class BusinessModelComponent {
  streams = [
    { icon: '📊', name: 'B2B Data', model: 'Вкусовая аналитика для R&D', target: 'Efes' },
    { icon: '🎓', name: 'B2B Education', model: 'Обучение персонала HoReCa', target: 'Бары, рестораны' },
    { icon: '📢', name: 'Promoted', model: 'Нативные рекомендации брендов', target: 'Бренды Efes KZ' },
    { icon: '💎', name: 'Freemium', model: 'Бесплатно + Premium AI-сомелье', target: 'Потребители' },
  ];

  stats = [
    { value: '690 млн л', label: 'пива продано в Казахстане в 2025 году' },
    { value: '15+', label: 'брендов Efes KZ' },
    { value: '∞', label: 'масштаб: кофе, вино, Турция' },
  ];
}
