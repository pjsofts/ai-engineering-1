const LINKS = [
  { href: "/", label: "Shop" },
  { href: "/cart", label: "Cart" },
  { href: "/account", label: "Account" },
];

export function renderNavbar(user) {
  const items = LINKS.map((link) => `<a href="${link.href}">${link.label}</a>`);
  const greeting = user ? `Hi, ${user.name}` : `<a href="/login">Log in</a>`;
  return `<nav>${items.join("")}<span>${greeting}</span></nav>`;
}

export function toggleMenu(nav) {
  nav.classList.toggle("open");
}
