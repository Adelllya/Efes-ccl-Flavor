import { Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.css'
})
export class NavbarComponent {
  isScrolled = false;
  isMobileMenuOpen = false;

  navLinks = [
    { label: 'Проблема', href: '#problem' },
    { label: 'Решение', href: '#solution' },
    { label: 'Обучение', href: '#education' },
    { label: 'Бизнес', href: '#business' },
    { label: 'Команда', href: '#hero' },
  ];

  @HostListener('window:scroll')
  onScroll() {
    this.isScrolled = window.scrollY > 50;
  }

  toggleMobileMenu() {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
  }

  scrollTo(href: string) {
    this.isMobileMenuOpen = false;
    const el = document.querySelector(href);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }
}
