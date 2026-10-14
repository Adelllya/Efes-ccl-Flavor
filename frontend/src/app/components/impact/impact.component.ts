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
      title: 'For consumers',
      text: 'Mindful choices instead of habit. New flavors. A sommelier certificate. Knowing "why I like this".'
    },
    {
      icon: '🏢',
      title: 'For Efes / Anadolu',
      text: 'A new channel through education. A data asset for R&D, B2B training. Loyalty. Scaling to Türkiye.'
    },
    {
      icon: '🌍',
      title: 'For the market',
      text: 'A new category: sensory education. A cultural shift from "drink more" to "drink better".'
    }
  ];
}
