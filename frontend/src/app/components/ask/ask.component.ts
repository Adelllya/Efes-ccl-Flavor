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
    { icon: '📊', title: 'Data', text: 'Access to the flavor profiles of Efes products' },
    { icon: '🏛️', title: 'Pilot', text: 'A sommelier school at one Efes event' },
    { icon: '🤝', title: 'Mentorship', text: 'Support from the Efes marketing team' },
  ];
}
