import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-impact',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './impact.component.html',
  styleUrl: './impact.component.css'
})
export class ImpactComponent {
  impacts = [
    {
      icon: '👤',
      title: 'Для потребителя',
      text: 'Осознанный выбор вместо привычки. Новые вкусы. Сертификат сомелье. Понимание «почему мне это нравится».'
    },
    {
      icon: '🏢',
      title: 'Для Efes / Anadolu',
      text: 'Новый канал связи через образование. Data asset для R&D, B2B обучение. Лояльность. Масштаб на Турцию.'
    },
    {
      icon: '🌍',
      title: 'Для рынка',
      text: 'Новая категория — сенсорное образование. Культурный сдвиг: от «пить больше» к «пить лучше».'
    }
  ];
}
