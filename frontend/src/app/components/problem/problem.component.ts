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
      title: 'Chosen by habit and price',
      text: 'Consumers can\'t explain why they like a particular beer. The choice is habit, not taste.'
    },
    {
      icon: '🍺',
      title: '15+ brands, 0 differences',
      text: 'Efes KZ has more than 15 distinct brands, but consumers can\'t tell them apart.'
    },
    {
      icon: '📊',
      title: 'No platforms in the CIS',
      text: 'RateBeer shut down in 2025. Untappd is just ratings. Zero sensory education.'
    }
  ];
}
