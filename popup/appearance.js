document.documentElement.classList.toggle("sidebar", new URLSearchParams(location.search).has("sidebar"));
document.documentElement.classList.toggle("embedded", new URLSearchParams(location.search).has("embedded"));
// Apply the last popup theme before either view paints.
try {
  const theme = sessionStorage.getItem("tuneshift-theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch (_) { /* Storage may be unavailable in standalone previews. */ }
