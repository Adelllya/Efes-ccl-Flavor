import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-ask',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ask.component.html',
  styleUrl: './ask.component.css'
})
export class AskComponent {
  asks = [
    { icon: '📊', title: 'Данные', text: 'Доступ к вкусовым профилям продуктов Efes' },
    { icon: '🏛️', title: 'Пилот', text: 'Школа сомелье на одном мероприятии Efes' },
    { icon: '🤝', title: 'Менторство', text: 'Поддержка маркетинг-команды Efes' },
  ];
}
