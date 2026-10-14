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
      label: 'Emotions',
      notes: 'freedom, nostalgia, summer',
      icon: '☀️',
      color: '#F7941D',
      bgColor: '#FFF3E0'
    },
    {
      level: 'HEART',
      label: 'Aroma notes',
      notes: 'citrus, bread, caraway, honey',
      icon: '🌿',
      color: '#E87D10',
      bgColor: '#FFE8CC'
    },
    {
      level: 'BASE',
      label: 'Basic tastes',
      notes: 'bitterness, sweetness, acidity',
      icon: '🏔️',
      color: '#C0610B',
      bgColor: '#FFDDB3'
    }
  ];
}
