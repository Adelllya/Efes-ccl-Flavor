import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './hero.component.html',
  styleUrl: './hero.component.css'
})
export class HeroComponent {
  team = [
    { name: 'Ералы', role: 'Co-founder', initials: 'ЕА' },
    { name: 'Аделия', role: 'Co-founder', initials: 'АА' },
  ];
}
