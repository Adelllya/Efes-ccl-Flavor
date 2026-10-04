import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-solution',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './solution.component.html',
  styleUrl: './solution.component.css'
})
export class SolutionComponent {
  pyramidLayers = [
    {
      level: 'TOP',
      label: 'Эмоции',
      notes: 'свобода, ностальгия, лето',
      icon: '☀️',
      color: '#F7941D',
      bgColor: '#FFF3E0'
    },
    {
      level: 'HEART',
      label: 'Ароматические ноты',
      notes: 'цитрус, хлеб, тмин, мёд',
      icon: '🌿',
      color: '#E87D10',
      bgColor: '#FFE8CC'
    },
    {
      level: 'BASE',
      label: 'Базовые вкусы',
      notes: 'горечь, сладость, кислота',
      icon: '🏔️',
      color: '#C0610B',
      bgColor: '#FFDDB3'
    }
  ];
}
