import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-features',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './features.component.html',
  styleUrl: './features.component.css'
})
export class FeaturesComponent {
  features = [
    {
      icon: '🧬',
      title: 'Flavor DNA',
      text: 'Персональный вкусовой профиль — как Spotify Wrapped. «Ты 70% цитрусовый».'
    },
    {
      icon: '🍖',
      title: 'Казахская кухня + Пиво',
      text: 'Бешбармак → Карагандинское Тёмное. Шашлык → Efes Pilsener. Уникальная локализация.'
    },
    {
      icon: '📱',
      title: 'Scan этикетки',
      text: 'Наводишь камеру → мгновенная вкусовая пирамида + рекомендация к еде.'
    }
  ];

  comparison = [
    { name: 'Untappd', desc: '«8 лет, ставки 4/5»', side: 'left' },
    { name: 'Flavor Tree', desc: '«Я знаю это пиво»', side: 'right' }
  ];
}
